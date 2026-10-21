// 用户私有数据：收藏（favorites）与学习记录（study_records）。
// 写入时由数据库 DEFAULT auth.uid() 与 RLS 强制所属人，前端绝不发送 owner_id。
import { ref } from 'vue'
import { cloud } from '../cloud.js'
import { useAuth } from './useAuth.js'

const favIds = ref(new Set()) // 已收藏的 poem_id 集合（用于卡片/详情快速判断）
const favList = ref([]) // [{ poem_id, created_at }] 按收藏时间倒序
const stats = ref({ favorites_count: 0, study_count: 0, distinct_poems: 0, study_dates: [] })
const studyFeed = ref([]) // get_study_feed 返回：带诗词标题的学习流水
const loadingFav = ref(false)
const loadingStudy = ref(false)

const { isLoggedIn } = useAuth()

async function loadFavorites() {
  if (!isLoggedIn.value) {
    favIds.value = new Set()
    favList.value = []
    return
  }
  loadingFav.value = true
  try {
    const { data, error } = await cloud.database
      .from('favorites')
      .select('poem_id, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    favList.value = data || []
    favIds.value = new Set((data || []).map((r) => r.poem_id))
  } catch (e) {
    console.warn('loadFavorites failed', e)
  } finally {
    loadingFav.value = false
  }
}

function isFavorite(poemId) {
  return favIds.value.has(poemId)
}

async function toggleFavorite(poemId) {
  if (!isLoggedIn.value) return { ok: false, needLogin: true }
  if (favIds.value.has(poemId)) {
    const { error } = await cloud.database
      .from('favorites')
      .delete()
      .eq('poem_id', poemId)
    if (error) return { ok: false, error: error.message }
    const next = new Set(favIds.value)
    next.delete(poemId)
    favIds.value = next
    favList.value = favList.value.filter((r) => r.poem_id !== poemId)
    return { ok: true, favorited: false }
  }
  const { data, error } = await cloud.database
    .from('favorites')
    .insert({ poem_id: poemId })
    .select()
  if (error) {
    if (error.code === '23505') {
      const next = new Set(favIds.value)
      next.add(poemId)
      favIds.value = next
      return { ok: true, favorited: true }
    }
    return { ok: false, error: error.message }
  }
  if (data && data[0]) favList.value = [data[0], ...favList.value]
  const next = new Set(favIds.value)
  next.add(poemId)
  favIds.value = next
  return { ok: true, favorited: true }
}

// 记录学习行为（view=浏览, read=朗读）。未登录直接返回 needLogin，不产生记录。
async function recordStudy(poemId, action = 'view') {
  if (!isLoggedIn.value) return { ok: false, needLogin: true }
  const { error } = await cloud.database
    .from('study_records')
    .insert({ poem_id: poemId, action })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

async function loadStats() {
  if (!isLoggedIn.value) {
    stats.value = { favorites_count: 0, study_count: 0, distinct_poems: 0, study_dates: [] }
    return
  }
  try {
    const { data, error } = await cloud.database.rpc('get_user_stats')
    if (!error && data && data.length) {
      const r = data[0]
      stats.value = {
        favorites_count: Number(r.favorites_count) || 0,
        study_count: Number(r.study_count) || 0,
        distinct_poems: Number(r.distinct_poems) || 0,
        study_dates: r.study_dates || []
      }
    }
  } catch (e) {
    console.warn('loadStats failed', e)
  }
}

async function loadStudyFeed(limit = 50) {
  if (!isLoggedIn.value) {
    studyFeed.value = []
    return
  }
  loadingStudy.value = true
  try {
    const { data, error } = await cloud.database.rpc('get_study_feed', { limit_n: limit })
    if (error) throw error
    studyFeed.value = data || []
  } catch (e) {
    console.warn('loadStudyFeed failed', e)
  } finally {
    loadingStudy.value = false
  }
}

export function useUserStore() {
  return {
    favIds,
    favList,
    stats,
    studyFeed,
    loadingFav,
    loadingStudy,
    isFavorite,
    loadFavorites,
    toggleFavorite,
    recordStudy,
    loadStats,
    loadStudyFeed
  }
}
