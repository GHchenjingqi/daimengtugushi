// 读取云库名篇（按 hot_rank 降序），输出 JSON 供 gen_audio.py 使用。
// 用法：node scripts/fetch-famous.mjs [limit]
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})

const limit = Number(process.argv[2] || 100)
const PAGE = 1000
const out = []

for (let from = 0; from < limit; from += PAGE) {
  const size = Math.min(PAGE, limit - from)
  const { data, error } = await cloud.database
    .from('poems')
    .select('id,title,author,dynasty,content')
    .order('hot_rank', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + size - 1)
  if (error) {
    console.error('query error:', error.message)
    process.exit(1)
  }
  if (!data || !data.length) break
  out.push(...data)
  if (data.length < size) break
}

process.stdout.write(JSON.stringify(out))