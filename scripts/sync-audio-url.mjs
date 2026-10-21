// 把 audio_manifest.json 中的 poem_id -> 音频URL 回写到数据库 poems.audio_url。
// 用法：node scripts/sync-audio-url.mjs
import { readFileSync } from 'node:fs'
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})

const manifest = JSON.parse(readFileSync('scripts/audio_manifest.json', 'utf8'))
const entries = Object.entries(manifest)
console.log(`待同步 ${entries.length} 条`)

let ok = 0
let fail = 0
for (let i = 0; i < entries.length; i++) {
  const [id, url] = entries[i]
  const { error } = await cloud.database
    .from('poems')
    .update({ audio_url: url })
    .eq('id', Number(id))
  if (error) {
    fail++
    if (fail <= 3) console.error(`  同步失败 id=${id}: ${error.message}`)
  } else {
    ok++
  }
  if ((i + 1) % 100 === 0) console.log(`  进度 ${i + 1}/${entries.length}`)
}
console.log(`\n同步完成：成功=${ok} 失败=${fail}`)