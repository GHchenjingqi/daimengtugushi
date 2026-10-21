import { pinyin } from 'pinyin-pro'

// 把一行文字拆成 [{ ch, py }]，py 为带声调拼音（非汉字的 py 为空字符串，仅保留原字符）
export function pinyinTokens(line) {
  const arr = pinyin(line || '', { type: 'all', toneType: 'symbol' })
  return arr.map((t) => ({
    ch: t.origin,
    py: t.isZh ? t.pinyin : ''
  }))
}

// 多行：返回 [[{ch,py}...], ...]
export function pinyinLines(lines) {
  return (lines || []).map((line) => pinyinTokens(line))
}
