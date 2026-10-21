#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量为名篇生成朗读音频（免费 TTS，无需任何密钥）。

方案：edge-tts（微软 Edge 同款神经网络语音）→ MP3 存入 public/audio/poems/
      → 把公开地址回写到数据库 poems.audio_url 字段
      → 前端优先播放云端音频，无音频时回退 Web Speech API

为什么不用 Web Speech API：vivo/OPPO/小米等国产浏览器的 WebView 往往不暴露任何
TTS 引擎（speechSynthesis.getVoices() 返回空数组），导致「朗读无声」。云端预生成
音频不依赖设备能力，所有手机都能正常发声。

用法：
  # 先生成前 100 首（试跑）
  python gen_audio.py --limit 100

  # 批量生成 1000 首（并发 8）
  python gen_audio.py --limit 1000 --concurrency 8

  # 指定音色：xiaoxiao(女声) / yunxi(男声) / yunxia(儿童音，适合小朋友)
  python gen_audio.py --limit 1000 --voice yunxia

  # 只补生成缺失音频的（已生成自动跳过）
  python gen_audio.py --fill-missing
"""
import argparse
import asyncio
import json
import os
import sys
import unicodedata

# ---- 配置 ----
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(APP_DIR, "public", "audio", "poems")
DB_FILE = os.path.join(APP_DIR, "scripts", "audio_manifest.json")
CLOUD_FILE = os.path.join(APP_DIR, "src", "cloud.js")
BASE_URL = "https://gushici.app.workbuddy.host/audio/poems"

VOICES = {
    "xiaoxiao": "zh-CN-XiaoxiaoNeural",   # 女声，温和，适合睡前朗读
    "yunxi":    "zh-CN-YunxiNeural",      # 男声，清朗
    "yunxia":   "zh-CN-YunxiaNeural",     # 儿童音，最适合小朋友跟读
    "xiaoyi":   "zh-CN-XiaoyiNeural",     # 女声，偏活泼
}

# 朗读文本模板
def build_text(poem: dict) -> str:
    parts = [poem.get("title", "")]
    if poem.get("dynasty"):
        parts.append(poem["dynasty"])
    if poem.get("author"):
        parts.append(poem["author"])
    body = (poem.get("content") or "").replace("\n", "")
    if body:
        parts.append(body)
    return "。".join(p for p in parts if p) + "。"


def safe_filename(poem: dict) -> str:
    """用 标题_作者 生成安全且唯一的文件名（不含易冲突字符）。"""
    raw = f"{poem.get('title','')}_{poem.get('author','')}"
    raw = unicodedata.normalize("NFKC", raw)
    keep = []
    for ch in raw:
        if ch.isalnum() or ord(ch) > 127:
            keep.append(ch)
        elif ch in "-_":
            keep.append(ch)
    name = "".join(keep).strip("_")
    return (name or str(poem.get("id", "unknown")))[:80] + ".mp3"


def load_manifest() -> dict:
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(m: dict) -> None:
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)


async def synth_one(edge_tts, text: str, path: str, voice: str, retries: int = 3) -> bool:
    for attempt in range(1, retries + 1):
        try:
            comm = edge_tts.Communicate(text, voice)
            await comm.save(path)
            if os.path.exists(path) and os.path.getsize(path) > 512:
                return True
        except Exception as e:
            if attempt == retries:
                print(f"      失败({attempt}): {type(e).__name__} {str(e)[:80]}")
            else:
                await asyncio.sleep(1.5 * attempt)
    return False


async def worker(edge_tts, items, voice, sem, stats):
    for poem in items:
        fn = safe_filename(poem)
        path = os.path.join(OUT_DIR, fn)
        if os.path.exists(path) and os.path.getsize(path) > 512:
            stats["skip"] += 1
            continue
        async with sem:
            ok = await synth_one(edge_tts, build_text(poem), path, voice)
        if ok:
            stats["ok"] += 1
        else:
            stats["fail"] += 1
        total = stats["ok"] + stats["fail"] + stats["skip"]
        if total % 10 == 0 or ok is False:
            print(f"  进度 {total}/{stats['total']}  成功={stats['ok']} 失败={stats['fail']} 跳过={stats['skip']}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--voice", default="xiaoxiao", choices=list(VOICES.keys()))
    ap.add_argument("--fill-missing", action="store_true", help="为所有已有名篇补齐缺失音频")
    args = ap.parse_args()

    try:
        import edge_tts
    except ImportError:
        print("缺少依赖，请先执行：pip install edge-tts")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    # 从云库按 hot_rank 降序取名篇（名篇已在数据库中标记好热度）
    print("正在从云库获取名篇列表…")
    poems = await fetch_poems(args.limit, args.fill_missing)
    if not poems:
        print("未获取到诗词，请检查云端连接")
        return
    print(f"待处理 {len(poems)} 首，音色={VOICES[args.voice]}，并发={args.concurrency}")

    manifest = load_manifest()
    stats = {"ok": 0, "fail": 0, "skip": 0, "total": len(poems)}

    sem = asyncio.Semaphore(args.concurrency)
    chunks = [poems[i:i + args.concurrency] for i in range(0, len(poems), args.concurrency)]
    await asyncio.gather(*(worker(edge_tts, c, VOICES[args.voice], sem, stats) for c in chunks))

    # 记录清单：poem_id -> 公开URL
    for p in poems:
        fn = safe_filename(p)
        if os.path.exists(os.path.join(OUT_DIR, fn)):
            manifest[str(p["id"])] = f"{BASE_URL}/{fn}"
    save_manifest(manifest)
    print(f"\n完成：成功={stats['ok']} 失败={stats['fail']} 跳过={stats['skip']}")
    print(f"清单已写入 {DB_FILE}（{len(manifest)} 条）")
    print("下一步：执行 node scripts/sync-audio-url.mjs 把 URL 写入数据库")


async def fetch_poems(limit: int, fill_missing: bool):
    """通过本地 Node 桥接读取云库（避免在 Python 里重复实现云 SDK 鉴权）。"""
    import subprocess
    root = os.path.dirname(APP_DIR)
    helper = os.path.join(APP_DIR, "scripts", "fetch-famous.mjs")
    n = 100000 if fill_missing else limit
    proc = subprocess.run(
        ["node", helper, str(n)],
        capture_output=True, text=True, cwd=APP_DIR,
        timeout=600,
    )
    if proc.returncode != 0:
        print("读取云库失败:", proc.stderr[-300:])
        return []
    try:
        return json.loads(proc.stdout)
    except Exception:
        print("解析失败:", proc.stdout[:200])
        return []


if __name__ == "__main__":
    asyncio.run(main())