import { writeFileSync, mkdirSync } from 'node:fs'
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})
mkdirSync('scripts/dump', { recursive: true })
const SIZE = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024 / 1024).toFixed(2)

// 方案A：名篇精选（hot_rank 高分）分片导出 —— 小程序内置数据
let all = []
const PAGE = 1000
for (let from = 0; from < 5000; from += PAGE) {
  const { data, error } = await cloud.database
    .from('poems').select('id,title,author,dynasty,content,tags,notes')
    .order('hot_rank', { ascending: false }).order('id', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) { console.log('ERR', error.message); break }
  if (!data || !data.length) break
  all = all.concat(data)
  if (data.length < PAGE) break
}
console.log('抓取名篇:', all.length, '首')
const slim = all.map(r => ({
  t: r.title, a: r.author, d: r.dynasty,
  c: (r.content || '').replace(/\n/g, ''),
  n: (r.notes || '').replace(/\n/g, ' ').slice(0, 200),
  g: (r.tags || []).filter(x => !['唐诗','宋诗','宋词'].includes(x))
}))
writeFileSync('scripts/dump/poems-famous.json', JSON.stringify(slim))
console.log('  完整JSON:', SIZE(slim), 'MB')
