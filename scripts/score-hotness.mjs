// 采集 chinese-poetry 的「名篇」元数据（宋词三百首 + 蒙学启蒙读物），
// 写入 tmp_famous 表，供 rank_poems_hotness 打分使用（名篇 +1000）。
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const cloud = createWorkBuddyCloud({
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
})

const RAW = 'https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/'
const clean = (v) => String(v == null ? '' : v).trim()
const lines = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : [])

async function fetchJson(p) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(RAW + encodeURI(p))
      if (!r.ok) return null
      return await r.json()
    } catch {
      if (i === 3) return null
      await new Promise((r) => setTimeout(r, i * 1000))
    }
  }
  return null
}

const famous = new Set()
const add = (title, author) => {
  const t = clean(title)
  if (!t) return
  famous.add(`${t}|${clean(author)}`)
  famous.add(`${t}|`) // 作者不一致时用空作者兜底
}

async function collectFamous() {
  // 宋词三百首（词牌+标题）
  const ci300 = await fetchJson('宋词/宋词三百首.json')
  if (Array.isArray(ci300)) {
    for (const e of ci300) {
      const rhythmic = clean(e.rhythmic)
      let title = clean(e.title) || rhythmic
      if (rhythmic && title && !title.startsWith(rhythmic)) title = `${rhythmic}·${title}`
      add(title, e.author)
      add(rhythmic, e.author)
    }
    console.log(`宋词三百首：${ci300.length} 首`)
  }

  // 蒙学启蒙（适合小朋友）
  const mengFiles = [
    'sanzijing-new.json', 'sanzijing-traditional.json', 'baijiaxing.json', 'qianziwen.json',
    'dizigui.json', 'shenglvqimeng.json', 'liwengduiyun.json', 'youxueqionglin.json',
    'zengguangxianwen.json', 'wenzimengqiu.json', 'zhuzijiaxun.json', 'guwenguanzhi.json'
  ]
  for (const f of mengFiles) {
    const data = await fetchJson('蒙学/' + f)
    if (!data) { console.log(`蒙学/${f}：不可用`); continue }
    add(data.title, data.author)
    if (Array.isArray(data.content)) {
      for (const c of data.content) {
        const inner = Array.isArray(c.content) ? c.content : []
        for (const x of inner) add(x.chapter || c.chapter || data.title, x.author || data.author)
        if (!inner.length && c.chapter) add(c.chapter, data.author)
      }
    }
    console.log(`蒙学/${f}：已收录`)
  }

  // 千家诗：名篇集，其内单篇按 chapter+author 标记
  const qjs = await fetchJson('蒙学/qianjiashi.json')
  if (qjs && Array.isArray(qjs.content)) {
    for (const c of qjs.content) {
      const inner = Array.isArray(c.content) ? c.content : []
      for (const x of inner) {
        const ch = clean(x.chapter)
        // 千家诗按体裁分组，chapter 才是诗题（如「春眠」）
        add(ch, x.author)
        add(ch, '')
      }
    }
    add(qjs.title, qjs.author)
    console.log(`千家诗：已收录`)
  }

  console.log(`名篇 key 总数：${famous.size}`)
  return famous
}

async function main() {
  const famous = await collectFamous()
  // 清空旧数据
  await cloud.database.from('tmp_famous').delete().neq('k', '__never__')

  const rows = [...famous].map((k) => ({ k }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await cloud.database.from('tmp_famous').upsert(rows.slice(i, i + 500))
    if (error) { console.error('写入失败：', error.message); process.exit(1) }
  }
  console.log(`tmp_famous 写入完成：${rows.length} 条`)
}

main().catch((e) => { console.error('失败：', e); process.exit(1) })