<script setup>
import { computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuth } from '../composables/useAuth.js'
import { useUserStore } from '../composables/useUserStore.js'
import LoginView from './LoginView.vue'
import { IconBookFilled, IconDocFilled, IconSunFilled, IconEditFilled } from './Icons.js'

const { user, isLoggedIn, logout, displayName, loadProfile, saveName } = useAuth()
const { stats, loadStats } = useUserStore()

const streak = computed(() => {
  const dates = (stats.value.study_dates || []).map((d) => {
    const dt = d instanceof Date ? d : new Date(String(d) + 'T00:00:00')
    return dt.toISOString().slice(0, 10)
  })
  if (!dates.length) return 0
  const set = new Set(dates)
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const yest = new Date(today)
  yest.setDate(yest.getDate() - 1)
  const yestStr = yest.toISOString().slice(0, 10)
  if (!set.has(todayStr) && !set.has(yestStr)) return 0
  let cursor = set.has(todayStr) ? new Date(todayStr) : new Date(yestStr)
  let count = 0
  while (set.has(cursor.toISOString().slice(0, 10))) {
    count++
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
})

async function onEditName() {
  let value = ''
  try {
    const res = await ElMessageBox.prompt('给自己起个名字吧（1-20 个字）', '修改昵称', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: displayName(),
      inputPattern: /^\S.{0,18}\S$|^\S$/,
      inputErrorMessage: '昵称需 1-20 个字符'
    })
    value = res.value
  } catch {
    return
  }
  const r = await saveName(value)
  if (r.ok) ElMessage.success('昵称已更新')
  else ElMessage.error(r.error || '保存失败')
}

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '退出登录', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  const res = await logout()
  if (res.ok) ElMessage.success('已退出登录')
  else ElMessage.error(res.error || '退出失败')
}

async function refresh() {
  await loadStats()
}

onMounted(() => {
  refresh()
  loadProfile()
})
watch(isLoggedIn, (v) => {
  if (v) {
    refresh()
    loadProfile()
  }
})
</script>

<template>
  <div class="sub-view me-view">
    <div class="sub-hero sub-hero--me"></div>

    <!-- 未登录 -->
    <LoginView v-if="!isLoggedIn" title="登录后就能保存你的收藏和学习记录啦" />

    <!-- 已登录：无白卡，头像悬浮在插画上 -->
    <template v-else>
      <div class="me-profile">
        <div class="me-avatar">
          <el-icon><UserFilled /></el-icon>
        </div>
        <button class="me-name-row" @click="onEditName" title="点击修改昵称">
          <span class="me-name">{{ displayName() }}</span>
          <el-icon class="me-edit-icon"><IconEditFilled /></el-icon>
        </button>
        <div class="me-sub">已登录 · 数据已云端同步</div>
      </div>

      <div class="stat-cards">
        <div class="stat-card kid-stat c-fav">
          <div class="stat-icon"><el-icon><StarFilled /></el-icon></div>
          <div class="stat-num">{{ stats.favorites_count }}</div>
          <div class="stat-label">收藏</div>
        </div>
        <div class="stat-card kid-stat c-study">
          <div class="stat-icon"><el-icon><IconBookFilled /></el-icon></div>
          <div class="stat-num">{{ stats.study_count }}</div>
          <div class="stat-label">学习次数</div>
        </div>
        <div class="stat-card kid-stat c-poem">
          <div class="stat-icon"><el-icon><IconDocFilled /></el-icon></div>
          <div class="stat-num">{{ stats.distinct_poems }}</div>
          <div class="stat-label">已学诗词</div>
        </div>
        <div class="stat-card kid-stat c-streak">
          <div class="stat-icon"><el-icon><IconSunFilled /></el-icon></div>
          <div class="stat-num">{{ streak }}</div>
          <div class="stat-label">连续天数</div>
        </div>
      </div>

      <button class="kid-btn-outline" @click="onLogout">退出登录</button>
    </template>
  </div>
</template>
