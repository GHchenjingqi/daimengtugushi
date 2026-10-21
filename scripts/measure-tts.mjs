import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})
// 统计 top N 名篇的字数总量 —— 用于估算 TTS 音频总时长/体积
for (const N of [500, 1000, 3000]) {
  const rows = []
  for (let from = 0; from < N; from += 1000) {
    const { data } = await cloud.database.from('poems')
      .select('title,content')
      .order('hot_rank', { ascending: false })
      .range(from, from + 999)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  const chars = rows.reduce((s, r) => s + (r.title||'').length + (r.content||'').replace(/\n/g,'').length, 0)
  // 中文语速约 4.5 字/秒；MP3 单声道 32kbps ≈ 4KB/s
  const seconds = Math.round(chars / 4.5)
  console.log(`${String(rows.length).padStart(5)} 首 | ${String(chars).padStart(7)} 字 | 朗读时长约 ${Math.round(seconds/60)} 分钟 | MP3@32k 约 ${(seconds*4/1024).toFixed(0)} MB`)
}
