// 从 GitHub 开源仓库 chinese-poetry 拉取整库古诗词，批量写入云端数据库。
// 浏览器直连 jsDelivr CDN（支持 CORS），无需本地脚本；按合集可选、分批 upsert（唯一约束去重）。
// 注意：仓库使用中文目录名（master 分支），例如 全唐诗/poet.tang.0.json、宋词/ci.song.0.json。
import { cloud } from './cloud.js'

const RAW = 'https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/'
const SOURCE = 'github:chinese-poetry'
const BATCH = 200

const clean = (v) => String(v == null ? '' : v).trim()
const lines = (arr) => (Array.isArray(arr) ? arr.map(clean).filter(Boolean) : [])

// files(i) 返回第 i 批文件的仓库路径数组；返回空数组表示结束。
const COLLECTIONS = {
  tang: {
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
  songshi: {
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
  ci: {
    label: '宋词',
    shards: '宋词/ci.song',
    map: (e) => {
      const rhythmic = clean(e.rhythmic)
      let title = clean(e.title) || rhythmic
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
  huajianji: {
    label: '花间集',
    files: () => [[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `五代诗词/huajianji/huajianji-${i}-juan.json`)],
    map: (e) => {
      const rhythmic = clean(e.rhythmic)
      let title = clean(e.title) || rhythmic
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
  shijing: {
    label: '诗经',
    files: () => [['诗经/shijing.json']],
    map: (e) => ({
      title: clean(e.title),
      author: `${clean(e.chapter)}·${clean(e.section)}`.replace(/^·|·$/g, ''),
      dynasty: '先秦',
      content: lines(e.content).join('\n'),
      tags: ['诗经']
    })
  },
  lunyu: {
    label: '论语',
    files: () => [['论语/lunyu.json']],
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
  youmengying: {
    label: '幽梦影',
    files: () => [['幽梦影/youmengying.json']],
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
}

export const GITHUB_COLLECTIONS = Object.entries(COLLECTIONS).map(([key, c]) => ({
  key,
  label: c.label
}))

async function fetchJson(path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(RAW + encodeURI(path))
      if (!res.ok) return null
      return await res.json()
    } catch {
      if (attempt === 3) return null
      await new Promise((r) => setTimeout(r, attempt * 1200))
    }
  }
  return null
}

async function importCollection(key, onProgress) {
  const col = COLLECTIONS[key]
  const mapRows = (arr) => (col.merge ? col.merge(arr) : arr.map(col.map))
  const finalize = (rows) => rows.filter((r) => r && clean(r.title) && clean(r.content))

  const writeRows = async (rows) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, source: SOURCE }))
      const { error } = await cloud.database
        .from('poems')
        .upsert(batch, { onConflict: 'title,author', ignoreDuplicates: true })
      if (error) return error.message
    }
    return null
  }

  let fetched = 0
  const handle = async (name, arr) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return { stop: false, error: null }
    const rows = finalize(mapRows(arr))
    const error = await writeRows(rows)
    fetched += rows.length
    onProgress && onProgress({ key, label: col.label, file: name, count: rows.length, fetched })
    return { stop: !!error, error }
  }

  if (col.shards) {
    // 分片命名：每 1000 条一片，序号=起始条数；遇 404/空终止
    for (let off = 0; off <= 400000; off += 1000) {
      const name = `${col.shards}.${off}.json`
      const arr = await fetchJson(name)
      const r = await handle(name, arr)
      if (r.stop) return { fetched, error: r.error, stopped: true }
      if (!arr || !Array.isArray(arr) || arr.length === 0) break
    }
  } else {
    for (const name of col.files()) {
      const arr = await fetchJson(name)
      const r = await handle(name, arr)
      if (r.stop) return { fetched, error: r.error, stopped: true }
    }
  }
  return { fetched, error: null }
}

export async function importFromGitHub({ collections, onProgress } = {}) {
  const keys = collections && collections.length ? collections : Object.keys(COLLECTIONS)
  let total = 0
  let firstError = null
  let stoppedAt = null
  for (const k of keys) {
    const r = await importCollection(k, onProgress)
    total += r.fetched
    onProgress && onProgress({ collectionDone: k, label: COLLECTIONS[k].label, totalInserted: total })
    if (r.stopped) {
      firstError = r.error
      stoppedAt = k
      break
    }
  }
  return { inserted: total, error: firstError, stoppedAt }
}
