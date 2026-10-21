const PUNC_RE = /[，。！？；：、]/

export function splitByPunctuation(text) {
  const s = String(text || '')
  const out = []
  let buf = ''
  for (const ch of s) {
    buf += ch
    if (PUNC_RE.test(ch)) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out.length ? out : [s]
}
