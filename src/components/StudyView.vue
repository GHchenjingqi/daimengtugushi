<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { cloud } from '../cloud.js'
import { useUserStore } from '../composables/useUserStore.js'
import { useAuth } from '../composables/useAuth.js'
import { normalizePoem } from '../composables/usePoems.js'
import LoginView from './LoginView.vue'
import { IconBookFilled, IconDocFilled, IconSunFilled } from './Icons.js'

const emit = defineEmits(['open'])
const { studyFeed, loadStudyFeed, stats, loadStats, loadingStudy } = useUserStore()
const { isLoggedIn } = useAuth()

const ACTION_LABEL = { view: '浏览', read: '朗读', memorize: '背诵' }

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

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((today - day) / 86400000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (diff === 0) return `今天 ${hh}:${mm}`
  if (diff === 1) return `昨天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

async function refresh() {
  await Promise.all([loadStudyFeed(200), loadStats(), loadMemorizeDates()])
}

// ---- 打卡日历：✓ = 当天完成背诵打卡，· = 当天有学习记录 ----
const DOW = ['一', '二', '三', '四', '五', '六', '日']
const now = new Date()
const calYear = ref(now.getFullYear())
const calMonth = ref(now.getMonth()) // 0-based
const memorizeDates = ref(new Set())

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadMemorizeDates() {
  if (!isLoggedIn.value) {
    memorizeDates.value = new Set()
    return
  }
  try {
    const { data, error } = await cloud.database
      .from('study_records')
      .select('studied_at')
      .eq('action', 'memorize')
      .order('studied_at', { ascending: false })
      .limit(500)
    if (error) throw error
    const set = new Set()
    for (const r of data || []) {
      set.add(localDateStr(new Date(r.studied_at)))
    }
    memorizeDates.value = set
  } catch (e) {
    console.warn('loadMemorizeDates failed', e)
  }
}

// 有任意学习行为的日期集合（get_user_stats 返回的 'YYYY-MM-DD' 字符串直接使用）
const allStudySet = computed(() => {
  const set = new Set()
  for (const d of stats.value.study_dates || []) {
    if (typeof d === 'string' && d.length <= 10) set.add(d)
    else if (d) set.add(localDateStr(d instanceof Date ? d : new Date(String(d))))
  }
  return set
})

// 日历格子（周一开头），含打卡/学习标记
const calCells = computed(() => {
  const y = calYear.value
  const m = calMonth.value
  const lead = (new Date(y, m, 1).getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const todayStr = localDateStr(new Date())
  const cells = []
  for (let i = 0; i < lead; i++) cells.push({ blank: true, key: `b${i}` })
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({
      blank: false,
      key: ds,
      day: d,
      memo: memorizeDates.value.has(ds),
      study: allStudySet.value.has(ds),
      today: ds === todayStr
    })
  }
  return cells
})

const monthMemoCount = computed(() => calCells.value.filter((c) => !c.blank && c.memo).length)
const canNext = computed(() => {
  const t = new Date()
  return calYear.value * 12 + calMonth.value < t.getFullYear() * 12 + t.getMonth()
})
function prevMonth() {
  if (calMonth.value === 0) {
    calYear.value--
    calMonth.value = 11
  } else calMonth.value--
}
function nextMonth() {
  if (!canNext.value) return
  if (calMonth.value === 11) {
    calYear.value++
    calMonth.value = 0
  } else calMonth.value++
}

// ---- 学习记录页：浏览 / 背诵 tab 切换 ----
const showRecords = ref(false)
const recTab = ref('view') // 'view' | 'memorize'
const viewRecords = computed(() => studyFeed.value.filter((r) => r.action === 'view' || r.action === 'read'))
const memoRecords = computed(() => studyFeed.value.filter((r) => r.action === 'memorize'))
const shownRecords = computed(() => (recTab.value === 'memorize' ? memoRecords.value : viewRecords.value))

onMounted(refresh)
watch(isLoggedIn, (v) => {
  if (v) refresh()
})

async function openFromFeed(row) {
  const { data, error } = await cloud.database
    .from('poems')
    .select('*')
    .eq('id', row.poem_id)
    .maybeSingle()
  if (error || !data) {
    ElMessage.error('诗词不存在或已被移除')
    return
  }
  emit('open', normalizePoem(data))
}
</script>

<template>
  <div class="sub-view">
    <div class="sub-hero sub-hero--study"></div>

    <LoginView v-if="!isLoggedIn" title="登录后就能记录你的学习足迹啦" />

    <template v-else>
      <!-- ================= 学习记录页 ================= -->
      <template v-if="showRecords">
        <header class="rec-topbar">
          <button class="cal-nav" @click="showRecords = false" title="返回">‹</button>
          <div class="rec-topbar-title">学习记录</div>
        </header>

        <div class="rec-tabs">
          <button class="rec-tab" :class="{ active: recTab === 'view' }" @click="recTab = 'view'">
            浏览 · {{ viewRecords.length }}
          </button>
          <button class="rec-tab" :class="{ active: recTab === 'memorize' }" @click="recTab = 'memorize'">
            背诵 · {{ memoRecords.length }}
          </button>
        </div>

        <div v-if="loadingStudy && !studyFeed.length" class="loading-wrap">加载中…</div>
        <div v-else-if="!shownRecords.length" class="empty-tip kid-empty">
          <div class="empty-icon"><el-icon><IconDocFilled /></el-icon></div>
          <p>{{ recTab === 'memorize' ? '还没有背诵记录哦' : '还没有浏览记录哦' }}</p>
          <p class="empty-sub">
            {{ recTab === 'memorize' ? '打开诗词详情，点「我背会了 · 打卡」就会出现在这里' : '打开任意诗词读一读，它就会出现在这里啦' }}
          </p>
        </div>

        <div v-else class="feed-list">
          <div
            v-for="row in shownRecords"
            :key="row.study_id"
            class="feed-item"
            @click="openFromFeed(row)"
          >
            <div class="feed-main">
              <div class="feed-title">{{ row.title }}</div>
              <div class="feed-meta">
                <span class="feed-action" :class="{ 'act-memo': row.action === 'memorize' }">{{ ACTION_LABEL[row.action] || '学习' }}</span>
                <span class="feed-author">
                  <template v-if="row.dynasty">{{ row.dynasty }}·</template>{{ row.author }}
                </span>
              </div>
            </div>
            <div class="feed-time">{{ formatTime(row.studied_at) }}</div>
          </div>
        </div>
      </template>

      <!-- ================= 学习主页（统计 + 打卡日历 + 入口） ================= -->
      <template v-else>
        <div class="stat-cards">
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

        <!-- 打卡日历：完成背诵 = 打卡成功，日历上显示 ✓ -->
        <div class="checkin-card kid-card">
          <div class="cal-head">
            <button class="cal-nav" :disabled="false" @click="prevMonth" title="上个月">‹</button>
            <div class="cal-title">
              {{ calYear }}年{{ calMonth + 1 }}月 · 背诵打卡 <b>{{ monthMemoCount }}</b> 天
            </div>
            <button class="cal-nav" :disabled="!canNext" @click="nextMonth" title="下个月">›</button>
          </div>
          <div class="cal-grid">
            <span v-for="w in DOW" :key="w" class="cal-dow">{{ w }}</span>
            <span
              v-for="c in calCells"
              :key="c.key"
              class="cal-cell"
              :class="{ 'is-blank': c.blank, 'is-today': c.today, 'has-memo': c.memo, 'has-study': c.study }"
            >
              <template v-if="!c.blank">
                <span class="cal-day">{{ c.day }}</span>
                <span v-if="c.memo" class="cal-mark">✓</span>
                <span v-else-if="c.study" class="cal-dot"></span>
              </template>
            </span>
          </div>
          <div class="cal-legend">
            <span><i class="lg-check">✓</i> 完成背诵</span>
            <span><i class="lg-dot"></i> 有学习记录</span>
          </div>
          <p v-if="!memorizeDates.size" class="cal-hint">
            还没有背诵打卡：打开诗词详情，点「我背会了 · 打卡」即可点亮 ✓
          </p>
        </div>

        <!-- 学习记录入口 -->
        <div class="records-entry kid-card" @click="showRecords = true">
          <div class="re-icon"><el-icon><IconDocFilled /></el-icon></div>
          <div class="re-main">
            <div class="re-title">学习记录</div>
            <div class="re-sub">浏览 {{ viewRecords.length }} 条 · 背诵 {{ memoRecords.length }} 条</div>
          </div>
          <span class="re-arrow">›</span>
        </div>
      </template>
    </template>
  </div>
</template>
