// 简繁转换：基于 opencc-js（词组级转换，准确处理「頭髮→头发」等多义字）。
// 数据源 chinese-poetry 原始为繁体，这里默认展示简体，并支持一键切回繁体。
//
// 体积优化：繁->简词典仅 ~109KB，首屏静态引入；
// 简->繁词典 ~1.1MB，改成动态 import，仅在用户点击切换时才按需下载。
import { ref, watch } from 'vue'
import * as OpenCC from 'opencc-js/t2cn'

// 繁体 -> 简体（大陆简体），首屏必需
const toSimp = OpenCC.Converter({ from: 'tw', to: 'cn' })

// 简体 -> 繁体（台湾正体）：懒加载
let toTradFn = null
export async function ensureTrad() {
  if (toTradFn) return toTradFn
  const mod = await import('opencc-js/cn2t')
  const OpenCC2 = mod.default || mod
  toTradFn = OpenCC2.Converter({ from: 'cn', to: 'tw' })
  return toTradFn
}

/**
 * 后台预加载简->繁词典（不阻塞首屏）。
 * 库中数据多为繁体原文，搜索需要「简体输入也能命中繁体」，必须提前备好该词典；
 * 首屏不静态引入是为了省掉 ~448KB 的字典包，这里在空闲时补齐。
 */
export function preloadTrad() {
  ensureTrad().catch(() => {
    /* 加载失败不影响功能，只是简繁双向搜索退化为单向 */
  })
}

/** 简->繁词典是否已就绪 */
export function tradReadyFn() {
  return !!toTradFn
}

const STORAGE_KEY = 'gushici.chineseScript'
// 默认简体：面向大陆小朋友。仅当用户主动点过切换（localStorage 记为 tw）才显示繁体；
// 任何非法/异常存储值都安全回落到简体。
function initialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'cn' || saved === 'tw') return saved
    if (saved) {
      // 脏值（例如早期版本可能写入其它内容）→ 清理并回落简体
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* 隐私模式等 localStorage 不可用时，直接简体 */
  }
  return 'cn'
}

const mode = ref(initialMode())
// 繁体词典是否已加载完成（未加载完成前，内容保持简体，避免闪烁）
const tradReady = ref(mode.value !== 'tw')

watch(mode, async (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* 隐私模式下无法持久化，本次会话内仍然生效 */
  }
  if (v === 'tw') {
    await ensureTrad()
    tradReady.value = true
  }
})

export function useChineseScript() {
  async function toggleScript() {
    // 切到繁体：先确保词典就绪，再翻模式（避免内容还没转就已显示）
    if (mode.value === 'cn') await ensureTrad()
    mode.value = mode.value === 'cn' ? 'tw' : 'cn'
    tradReady.value = true
  }
  return { mode, toggleScript }
}

/**
 * 按当前模式转换文本。
 * 简体模式：繁体->简体；繁体模式：简体->繁体（词典未就绪时先保持简体）。
 */
export function convert(text) {
  if (text == null || text === '') return ''
  const s = String(text)
  if (mode.value === 'tw' && toTradFn) return toTradFn(s)
  return toSimp(s)
}

/**
 * 无视当前模式，始终转成简体（用于搜索匹配，确保输入简体能命中库中繁体）。
 */
export function toSimplified(text) {
  if (!text) return ''
  return toSimp(String(text))
}

/**
 * 生成搜索用的候选词：原词 + 简体 + 繁体（去重）。
 * 繁体候选需词典就绪，否则仅返回原词+简体。
 * 例如输入「叶声」→ ['叶声', '葉聲']，从而同时命中简繁两种库存。
 */
export function searchVariants(text) {
  const s = String(text || '').trim()
  if (!s) return []
  const list = [s, toSimp(s)]
  if (toTradFn) list.push(toTradFn(s))
  return [...new Set(list)]
}

/**
 * 「反向」转换：把已经是当前模式的文本翻转到另一模式。
 * 用于简繁切换时对已渲染内容就地重转（避免重新请求）。
 */
export function flipScript(text) {
  if (!text) return ''
  if (mode.value === 'tw' && toTradFn) return toSimp(String(text))
  if (mode.value === 'cn' && toTradFn) return toTradFn(String(text))
  return toSimp(String(text))
}