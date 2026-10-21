// 云端数据层：所有诗词读写都走 cloud-service 数据库（postgres）。
// 诗词唯一性由数据库 UNIQUE(title, author) 保证；标签以 TEXT[] 存储，可重复用于分类。
import { ref } from 'vue'
import { cloud } from '../cloud.js'
import { seedPoems } from '../data/seed.js'
import { searchVariants, convert, flipScript, ensureTrad } from '../utils/chineseScript.js'

const PAGE = 50

const poems = ref([]) // 当前视图诗词（content 为句数组，便于组件渲染）
const tagCounts = ref([]) // [{ name, count }] 来自服务端 RPC
const totalCount = ref(0) // 全部诗词总数（侧栏「全部」用）
const viewCount = ref(0) // 当前筛选结果数（状态栏用）
const loading = ref(false) // 列表加载中（加载更多）
const booting = ref(true) // 首屏初始化中（显示全屏 loading）
const hasMore = ref(false)
const error = ref('')

let loadedCount = 0
let currentTag = '__all__'
let currentQuery = ''

// DB 行(TEXT content) -> 组件友好对象(数组 content)
// 注意：标题/作者/正文/注解在此统一按当前简繁模式转换，切换时需重新加载视图。
function normalize(row) {
  return {
    id: row.id,
    title: convert(row.title),
    author: convert(row.author || ''),
    dynasty: row.dynasty || '',
    content: row.content ? row.content.split('\n').map(convert) : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    translation: convert(row.translation || ''),
    notes: convert(row.notes || ''),
    audioUrl: row.audio_url || '',
    source: row.source || '',
    createdAt: row.created_at
  }
}

// 注意：不要加 count:'exact' —— 31.5 万行全表精确计数会让首屏查询从 ~0.2s 退化到 ~25s。
// 总数改由 get_tag_counts（分类聚合）与 get_total_count（轻量 RPC）提供。
function buildQuery(tag, q) {
  let qb = cloud.database.from('poems').select('*')
  const kw = q && q.trim() ? q.trim().replace(/[%,]/g, ' ') : ''
  if (kw) {
    // 输入搜索词时全局搜索（忽略标签）。库中混有简繁两种字形，
    // 因此对关键词做简繁双向展开，保证「输入简体也能搜到繁体原文」。
    const variants = searchVariants(kw)
    const ors = []
    for (const v of variants) {
      ors.push(`title.ilike.%${v}%`)
      ors.push(`author.ilike.%${v}%`)
      ors.push(`content.ilike.%${v}%`)
    }
    qb = qb.or(ors.join(','))
  } else if (tag && tag !== '__all__') {
    qb = qb.contains('tags', [tag])
  }
  return qb
}

// 首页默认按热门度降序（新用户先看到耳熟能详的名篇）；搜索时按 id 稳定排序。
function applyOrder(qb, q) {
  const kw = q && q.trim()
  if (kw) return qb.order('id', { ascending: true })
  return qb.order('hot_rank', { ascending: false }).order('id', { ascending: true })
}

// 视图总数：优先用分类计数（已有缓存），搜索时先置 0 由实际结果回填
function estimateViewCount(tag, q) {
  const kw = q && q.trim()
  if (kw) return null // 搜索场景未知总数，加载后按实际推断
  if (!tag || tag === '__all__') return totalCount.value
  const hit = tagCounts.value.find((t) => t.name === tag)
  return hit ? hit.count : null
}

async function loadView(tag, q, replace = true) {
  currentTag = tag
  currentQuery = q || ''
  if (replace) loading.value = true
  error.value = ''
  try {
    // 库中多为繁体原文：搜索前确保简->繁词典就绪，让「枫桥夜泊」能命中「楓橋夜泊」。
    // 后台已预加载，通常瞬间返回；极端情况下（用户秒搜）会等一次字典下载。
    if (currentQuery && currentQuery.trim()) {
      try {
        await ensureTrad()
      } catch {
        /* 字典不可用时退化为仅简体匹配 */
      }
    }
    const { data, error: err } = await applyOrder(buildQuery(tag, q), q).range(0, PAGE - 1)
    if (err) throw err
    poems.value = (data || []).map(normalize)
    loadedCount = poems.value.length
    // 无搜索词时用分类计数作为总数；否则以「是否满页」判断还有更多
    const est = estimateViewCount(tag, q)
    // est 为 0/未就绪时表示计数请求还在路上（首屏不阻塞计数），
    // 此时退回「是否满页」判断，避免误判成「共 0 首 / 没有更多」
    if (est != null && est > 0) {
      viewCount.value = est
      hasMore.value = loadedCount < est
    } else {
      viewCount.value = loadedCount
      hasMore.value = poems.value.length === PAGE
    }
  } catch (e) {
    error.value = e?.message || '加载失败'
    poems.value = []
    loadedCount = 0
    viewCount.value = 0
    hasMore.value = false
  } finally {
    if (replace) loading.value = false
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  error.value = ''
  try {
    const from = loadedCount
    const to = from + PAGE - 1
    const { data, error: err } = await applyOrder(buildQuery(currentTag, currentQuery), currentQuery).range(from, to)
    if (err) throw err
    const more = (data || []).map(normalize)
    poems.value.push(...more)
    loadedCount = poems.value.length
    // 分类视图总数固定，按需显示已加载多少；搜索场景按是否满页判断
    if (estimateViewCount(currentTag, currentQuery) == null) {
      hasMore.value = more.length === PAGE
    } else {
      hasMore.value = more.length > 0 && loadedCount < viewCount.value
    }
  } catch (e) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// 简繁切换：把当前已加载列表按新模式就地重转（无需重新查库、避免闪烁与多余请求）
function reconvertCurrent() {
  poems.value = poems.value.map((p) => ({
    ...p,
    title: flipScript(p.title),
    author: flipScript(p.author),
    content: p.content.map(flipScript),
    translation: flipScript(p.translation),
    notes: flipScript(p.notes)
  }))
}

async function refreshCounts() {
  try {
    const { data, error: err } = await cloud.database.rpc('get_tag_counts')
    if (err) throw err
    tagCounts.value = (data || []).map((r) => ({ name: r.tag, count: Number(r.cnt) }))
  } catch (e) {
    console.warn('tag counts failed', e)
  }
}

async function fetchTotal() {
  try {
    const { data, error: err } = await cloud.database.rpc('get_total_count')
    if (err) return
    // 网关对标量函数可能直接返回 number，也可能返回 [{...}]，两种都兼容
    const n = Array.isArray(data) ? Number(data[0]?.total ?? data[0]?.get_total_count ?? 0) : Number(data ?? 0)
    if (n > 0) totalCount.value = n
  } catch (e) {
    console.warn('total count failed', e)
  }
}

// 分类聚合 RPC（get_tag_counts）在 31.5 万行上可能较慢，因此放到首屏之后后台拉取。
// 拿到计数后用它重算「共 N 首」与 hasMore —— 只基于已加载数据，不重新查询列表。
function recalcViewCount() {
  const est = estimateViewCount(currentTag, currentQuery)
  if (est != null && est > 0) {
    viewCount.value = est
    hasMore.value = loadedCount < est
  }
}

// 表为空时植入示例诗词（幂等：唯一约束 + ignoreDuplicates）
async function seedIfEmpty() {
  const { count, error: e } = await cloud.database
    .from('poems')
    .select('*', { count: 'exact', head: true })
  if (e || (count && count > 0)) return
  const rows = seedPoems.map((p) => ({
    title: p.title,
    author: p.author,
    dynasty: p.dynasty || '',
    content: (p.content || []).join('\n'),
    tags: p.tags || [],
    translation: p.translation || '',
    notes: p.notes || '',
    source: 'seed'
  }))
  const { error: ie } = await cloud.database
    .from('poems')
    .upsert(rows, { onConflict: 'title,author', ignoreDuplicates: true })
  if (ie) console.warn('seed failed', ie)
}

async function afterWrite() {
  await Promise.all([refreshCounts(), fetchTotal()])
  await loadView(currentTag, currentQuery, true)
}

async function addPoem(payload) {
  const t = payload.title.trim()
  const a = payload.author.trim()
  const { data: exist } = await cloud.database
    .from('poems')
    .select('id')
    .eq('title', t)
    .eq('author', a)
    .maybeSingle()
  if (exist) {
    return { ok: false, error: `《${t}》（${a}）已存在，诗词不允许重复。` }
  }
  const row = {
    title: t,
    author: a,
    dynasty: payload.dynasty || '',
    content: payload.content.join('\n'),
    tags: payload.tags || [],
    translation: payload.translation || '',
    notes: payload.notes || ''
  }
  const { data, error: err } = await cloud.database.from('poems').insert(row).select()
  if (err) {
    if (err.code === '23505') return { ok: false, error: '该诗词已存在。' }
    return { ok: false, error: err.message }
  }
  await afterWrite()
  return { ok: true, poem: data?.[0] ? normalize(data[0]) : null }
}

async function updatePoem(id, payload) {
  const t = payload.title.trim()
  const a = payload.author.trim()
  const { data: exist } = await cloud.database
    .from('poems')
    .select('id')
    .eq('title', t)
    .eq('author', a)
    .neq('id', id)
    .maybeSingle()
  if (exist) {
    return { ok: false, error: `《${t}》（${a}）已存在，诗词不允许重复。` }
  }
  const row = {
    title: t,
    author: a,
    dynasty: payload.dynasty || '',
    content: payload.content.join('\n'),
    tags: payload.tags || [],
    translation: payload.translation || '',
    notes: payload.notes || ''
  }
  const { data, error: err } = await cloud.database
    .from('poems')
    .update(row)
    .eq('id', id)
    .select()
  if (err) return { ok: false, error: err.message }
  if (!data || data.length === 0) return { ok: false, error: '未找到该诗词或无权修改。' }
  await afterWrite()
  return { ok: true, poem: normalize(data[0]) }
}

async function removePoem(id) {
  const { data, error: err } = await cloud.database
    .from('poems')
    .delete()
    .eq('id', id)
    .select()
  if (err) return { ok: false, error: err.message }
  if (!data || data.length === 0) return { ok: false, error: '未找到该诗词或无权删除。' }
  await afterWrite()
  return { ok: true }
}

// 任何人可给诗词打标签（社区共建）：读取当前标签后追加，遇重复标签则忽略
async function addTag(id, tag) {
  const t = String(tag || '').trim()
  if (!t) return { ok: false, error: '标签不能为空' }
  const { data, error: re } = await cloud.database
    .from('poems')
    .select('tags')
    .eq('id', id)
    .maybeSingle()
  if (re) return { ok: false, error: re.message }
  const tags = Array.isArray(data?.tags) ? data.tags : []
  if (tags.includes(t)) return { ok: false, exists: true }
  const { data: ud, error: ue } = await cloud.database
    .from('poems')
    .update({ tags: [...tags, t] })
    .eq('id', id)
    .select()
  if (ue) return { ok: false, error: ue.message }
  await afterWrite()
  return { ok: true, poem: ud?.[0] ? normalize(ud[0]) : null }
}

// 移除标签（仅超管）：读取当前标签后剔除
async function removeTag(id, tag) {
  const { data, error: re } = await cloud.database
    .from('poems')
    .select('tags')
    .eq('id', id)
    .maybeSingle()
  if (re) return { ok: false, error: re.message }
  const tags = Array.isArray(data?.tags) ? data.tags : []
  const newTags = tags.filter((x) => x !== tag)
  if (newTags.length === tags.length) return { ok: false, error: '标签不存在' }
  const { data: ud, error: ue } = await cloud.database
    .from('poems')
    .update({ tags: newTags })
    .eq('id', id)
    .select()
  if (ue) return { ok: false, error: ue.message }
  await afterWrite()
  return { ok: true, poem: ud?.[0] ? normalize(ud[0]) : null }
}

// 本地 JSON -> 云端（去重写入）
async function importPoems(list) {
  const rows = (list || [])
    .filter((p) => p && p.title && p.author)
    .map((p) => ({
      title: String(p.title).trim(),
      author: String(p.author).trim(),
      dynasty: String(p.dynasty || '').trim(),
      content: Array.isArray(p.content) ? p.content.join('\n') : String(p.content || ''),
      tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
      translation: String(p.translation || '').trim(),
      notes: String(p.notes || '').trim(),
      source: 'import'
    }))
  if (!rows.length) return { added: 0, skipped: 0 }
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    const { error: err } = await cloud.database
      .from('poems')
      .upsert(batch, { onConflict: 'title,author', ignoreDuplicates: true })
    if (err) throw err
  }
  await afterWrite()
  return { added: rows.length, skipped: 0 }
}

// 云端 -> 本地 JSON（全量分页导出）
async function exportPoems() {
  const out = []
  const size = 1000
  let from = 0
  while (true) {
    const { data, error: err } = await cloud.database
      .from('poems')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + size - 1)
    if (err) throw err
    if (!data || !data.length) break
    for (const r of data) {
      out.push({
        title: r.title,
        author: r.author,
        dynasty: r.dynasty,
        content: r.content ? r.content.split('\n') : [],
        tags: r.tags || [],
        translation: r.translation || '',
        notes: r.notes || ''
      })
    }
    if (data.length < size) break
    from += size
  }
  return out
}

export function normalizePoem(row) {
  return normalize(row)
}

export function usePoems() {
  return {
    poems,
    tagCounts,
    totalCount,
    viewCount,
    loading,
    booting,
    hasMore,
    error,
    loadView,
    loadMore,
    reconvertCurrent,
    refreshCounts,
    fetchTotal,
    recalcViewCount,
    seedIfEmpty,
    addPoem,
    updatePoem,
    removePoem,
    addTag,
    removeTag,
    importPoems,
    exportPoems,
    afterWrite
  }
}
