// 把名篇 key 批量写入 tmp_famous（供 hot_rank 打分使用）。
// 用 insert + ON CONFLICT DO NOTHING 语义（先查已存在再插入，避免依赖 upsert）。
import { readFileSync } from 'node:fs'
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})

async function main() {
  const sql = readFileSync('scripts/famous_insert.sql', 'utf8')
  const tuples = sql.match(/\('(?:[^']|'')*?'\)/g) || []
  const keys = tuples.map((t) => t.slice(1, -1).replace(/''/g, "'"))

  // 已存在的 key（跳过，避免唯一键冲突）
  const { data: existRows, error: exErr } = await cloud.database.from('tmp_famous').select('k')
  if (exErr) { console.error('读取已有名篇失败：', exErr.message); process.exit(1) }
  const exist = new Set((existRows || []).map((r) => r.k))
  const todo = keys.filter((k) => !exist.has(k))
  console.log(`名篇总数 ${keys.length}，已存在 ${keys.length - todo.length}，待插入 ${todo.length}`)

  let done = 0
  for (let i = 0; i < todo.length; i += 200) {
    const batch = todo.slice(i, i + 200).map((k) => ({ k }))
    const { error } = await cloud.database.from('tmp_famous').insert(batch)
    if (error) { console.error(`插入失败(第${i}批)：`, error.message); process.exit(1) }
    done += batch.length
    process.stdout.write(`\r  已插入 ${done}/${todo.length}`)
  }
  console.log('\n写入完成')
}
main().catch((e) => { console.error('失败：', e); process.exit(1) })