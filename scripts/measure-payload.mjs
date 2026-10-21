import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})
const SIZE = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(0)

for (const N of [300, 500, 1000, 2000, 5000]) {
  const { data, error } = await cloud.database
    .from('poems')
    .select('id,title,author,dynasty,content,tags')
    .order('hot_rank', { ascending: false })
    .order('id', { ascending: true })
    .range(0, N - 1)
  if (error) { console.log(N, 'ERR', error.message); continue }
  const rows = data || []
  const full = rows.map(r => ({ t:r.title, a:r.author, d:r.dynasty, c:(r.content||'').replace(/\n/g,''), g:r.tags||[] }))
  const slim = rows.map(r => [r.title, r.author, (r.content||'').replace(/\n/g,'')])
  console.log(`${String(N).padStart(5)} 首 | 完整对象 ${SIZE(full).padStart(6)} KB | 极简数组 ${SIZE(slim).padStart(6)} KB | tags种类 ${new Set(rows.flatMap(r=>r.tags||[])).size}`)
}
