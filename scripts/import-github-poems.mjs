// 批量导入 chinese-poetry 全库古诗词到云端数据库。
// 数据源（GitHub chinese-poetry/chinese-poetry，master 分支）经 jsDelivr CDN 拉取。
// 幂等：按 UNIQUE(title,author) upsert + ignoreDuplicates，可随时重跑续传。
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})

const RAW = 'https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/'
const SOURCE = 'github:chinese-poetry'
const BATCH = 300

const clean = (v) => String(v == null ? '' : v).trim()
const lines = (arr) => (Array.isArray(arr) ? arr.map(clean).filter(Boolean) : [])

// 分片命名：每 1000 条一个文件，序号=起始条数（如 poet.tang.0/1000/.../57000.json）。
// 逐片探测直到 404（含上限保护），自动适配仓库分片数变化。
async function* shardIter(prefix, { step = 1000, max = 400000 } = {}) {
  for (let off = 0; off <= max; off += step) {
    const path = `${prefix}.${off}.json`
    const arr = await fetchJson(path)
    if (!arr || !Array.isArray(arr) || arr.length === 0) return // 404/空 -> 结束
    yield { path, arr }
  }
}

// 各合集定义：shards 为分片前缀（步长1000自动遍历）；single 为单文件；map/merge 把原始条目映射为 poem 行。
const COLLECTIONS = [
  {
    key: 'tang',
    label: '唐诗',
    shards: '全唐诗/poet.tang',
    map: (e) => ({
      title: clean(e.title),
      author: clean(e.author) || '佚名',
      dynasty: '唐',
      content: lines(e.paragraphs).join('\n'),
      tags: ['唐诗']
    })
  },
  {
    key: 'songshi',
    label: '宋诗',
    shards: '全唐诗/poet.song',
    map: (e) => ({
      title: clean(e.title),
      author: clean(e.author) || '佚名',
      dynasty: '宋',
      content: lines(e.paragraphs).join('\n'),
      tags: ['宋诗']
    })
  },
  {
    key: 'ci',
    label: '宋词',
    shards: '宋词/ci.song',
    map: (e) => {
      const rhythmic = clean(e.rhythmic)
      let title = clean(e.title)
      if (!title) title = rhythmic
      // 词牌并入标题，便于搜索「菩萨蛮」等
      if (rhythmic && title && !title.startsWith(rhythmic)) title = `${rhythmic}·${title}`
      return {
        title,
        author: clean(e.author) || '佚名',
        dynasty: '宋',
        content: lines(e.paragraphs).join('\n'),
        tags: ['宋词']
      }
    }
  },
  {
    key: 'huajianji',
    label: '花间集',
    dynasty: '五代',
    single: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `五代诗词/huajianji/huajianji-${i}-juan.json`),
    map: (e) => {
      const rhythmic = clean(e.rhythmic)
      let title = clean(e.title)
      if (!title) title = rhythmic
      if (rhythmic && title && !title.startsWith(rhythmic)) title = `${rhythmic}·${title}`
      return {
        title,
        author: clean(e.author) || '佚名',
        dynasty: '五代',
        content: lines(e.paragraphs).join('\n'),
        notes: lines(e.notes).join('\n'),
        tags: ['花间集']
      }
    }
  },
  {
    key: 'shijing',
    label: '诗经',
    dynasty: '先秦',
    single: ['诗经/shijing.json'],
    map: (e) => ({
      title: clean(e.title),
      author: `${clean(e.chapter)}·${clean(e.section)}`.replace(/^·|·$/g, ''),
      dynasty: '先秦',
      content: lines(e.content).join('\n'),
      tags: ['诗经']
    })
  },
  {
    key: 'lunyu',
    label: '论语',
    dynasty: '先秦',
    single: ['论语/lunyu.json'],
    // 无独立标题，按 chapter 聚合并并段落
    merge: (entries) => {
      const byChapter = new Map()
      for (const e of entries) {
        const ch = clean(e.chapter)
        if (!byChapter.has(ch)) byChapter.set(ch, [])
        byChapter.get(ch).push(...lines(e.paragraphs))
      }
      return [...byChapter.entries()].map(([chapter, ps]) => ({
        title: chapter,
        author: '孔子及其弟子',
        dynasty: '先秦',
        content: ps.join('\n'),
        tags: ['论语']
      }))
    }
  },
  {
    key: 'youmengying',
    label: '幽梦影',
    dynasty: '清',
    single: ['幽梦影/youmengying.json'],
    map: (e) => {
      const content = clean(e.content)
      return {
        title: content.slice(0, 14),
        author: '张潮',
        dynasty: '清',
        content,
        notes: lines(e.comment).join('\n'),
        tags: ['幽梦影']
      }
    }
  }
]

async function fetchJson(path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(RAW + encodeURI(path))
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error(`HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      if (attempt === 4) throw err
      await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }
}

async function upsertBatch(rows) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await cloud.database
      .from('poems')
      .upsert(rows, { onConflict: 'title,author', ignoreDuplicates: true })
    if (!error) return true
    if (attempt === 4) throw new Error(error.message)
    await new Promise((r) => setTimeout(r, attempt * 2000))
  }
  return false
}

async function importCollection(col, onProgress) {
  const mapRows = (arr) => (col.merge ? col.merge(arr) : arr.map(col.map))
  const finalize = (rows) => rows.filter((r) => r && clean(r.title) && clean(r.content))

  const writeRows = async (rows) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, source: SOURCE }))
      await upsertBatch(batch)
    }
  }

  let fetched = 0
  let shards = 0

  if (col.shards) {
    for await (const { path, arr } of shardIter(col.shards)) {
      const rows = finalize(mapRows(arr))
      await writeRows(rows)
      fetched += rows.length
      shards++
      onProgress && onProgress({ key: col.key, label: col.label, shard: path, count: rows.length, fetched })
    }
  } else {
    for (const name of col.single || []) {
      const arr = await fetchJson(name)
      if (!arr || !Array.isArray(arr)) continue
      const rows = finalize(mapRows(arr))
      await writeRows(rows)
      fetched += rows.length
      shards++
      onProgress && onProgress({ key: col.key, label: col.label, shard: name, count: rows.length, fetched })
    }
  }
  return { fetched, shards }
}

async function main() {
  const only = process.argv.slice(2)
  const cols = only.length ? COLLECTIONS.filter((c) => only.includes(c.key)) : COLLECTIONS
  console.log(`开始导入合集：${cols.map((c) => c.label).join('、')}`)
  const t0 = Date.now()
  let grand = 0
  for (const col of cols) {
    console.log(`\n== ${col.label} ==`)
    const onProgress = (p) => {
      if (p.shard) console.log(`  [shard] ${p.shard}  ${p.count} 条  (累计 ${p.fetched})`)
    }
    const { fetched, shards } = await importCollection(col, onProgress)
    console.log(`  ${col.label}：${shards} 个分片，源条目 ${fetched} 条`)
    grand += fetched
  }
  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`\n全部完成：本次处理 ${grand} 条，用时 ${mins} 分钟`)
}

main().catch((e) => {
  console.error('导入失败：', e)
  process.exit(1)
})
