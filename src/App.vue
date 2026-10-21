<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePoems } from './composables/usePoems.js'
import { importFromGitHub, GITHUB_COLLECTIONS } from './githubImport.js'
import { useAdmin } from './composables/useAdmin.js'
import { useAuth } from './composables/useAuth.js'
import { useUserStore } from './composables/useUserStore.js'
import { useChineseScript, flipScript, convert, preloadTrad } from './utils/chineseScript.js'
import { useSpeech } from './composables/useSpeech.js'
import Sidebar from './components/Sidebar.vue'
import PoemCard from './components/PoemCard.vue'
// 非首屏必需的组件改为异步加载：详情页 / 编辑器 / 三个子页都要等用户操作才用到，
// 拆出去后首屏只需下载首页必需的 Sidebar + PoemCard，显著加快首次打开
const PoemDetailView = defineAsyncComponent(() => import('./components/PoemDetailView.vue'))
const PoemEditorDialog = defineAsyncComponent(() => import('./components/PoemEditorDialog.vue'))
const FavoritesView = defineAsyncComponent(() => import('./components/FavoritesView.vue'))
const StudyView = defineAsyncComponent(() => import('./components/StudyView.vue'))
const MeView = defineAsyncComponent(() => import('./components/MeView.vue'))
import { IconBookFilled, IconLangFilled } from './components/Icons.js'

const {
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
  seedIfEmpty,
  addPoem,
  updatePoem,
  removePoem,
  addTag,
  removeTag,
  importPoems,
  exportPoems,
  refreshCounts,
  recalcViewCount,
  fetchTotal
} = usePoems()

const { isAdmin, showLogin, passInput, errorMsg, openLogin, login, logout } = useAdmin()
const { init: initAuth, isLoggedIn } = useAuth()
const { isFavorite, toggleFavorite, recordStudy, loadFavorites, loadStats, loadingFav, loadingStudy } = useUserStore()

const bootError = ref('') // 首屏初始化失败/超时提示
const bootStage = ref('') // auth / list / count / done
let bootWatchdog = null
let initStarted = false

// 给单个 Promise 加超时，避免移动网络下请求无声挂死
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label || '请求'}超时，请检查网络`)), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(t))
  })
}

function startBootWatchdog() {
  if (bootWatchdog) clearTimeout(bootWatchdog)
  bootWatchdog = setTimeout(() => {
    if (booting.value && !bootError.value) {
      bootError.value = '加载超时，请检查网络后点击重试'
    }
  }, 20000) // 移动网络/弱网下给足 20s
}

function clearBootWatchdog() {
  if (bootWatchdog) {
    clearTimeout(bootWatchdog)
    bootWatchdog = null
  }
}

const activeTab = ref('home')
// tab 切换时统一使用全屏「翻开诗卷」加载态（首屏 booting 之外）
const tabLoading = computed(
  () =>
    !booting.value &&
    ((activeTab.value === 'fav' && loadingFav.value) ||
      (activeTab.value === 'study' && loadingStudy.value))
)
const query = ref('')
const showPinyin = ref(false)
const detailMode = ref(false)
const detailPoem = ref(null)
const editorVisible = ref(false)
const editorPoem = ref(null)

const tagNames = computed(() => tagCounts.value.map((t) => t.name))
const currentCategoryLabel = computed(() => {
  if (query.value && query.value.trim()) return '全部诗词'
  return activeTag.value === '__all__' ? '全部诗词' : `# ${activeTag.value}`
})

const activeTag = ref('__all__')

async function init() {
  if (initStarted) return
  initStarted = true
  booting.value = true
  bootError.value = ''
  bootStage.value = 'auth'
  startBootWatchdog()

  // 登录态初始化与首屏数据并行：登录态失败不应阻塞诗词展示
  const authPromise = initAuth().catch((e) => {
    console.warn('auth init failed', e)
    return null
  })

  try {
    // 阶段 1：优先加载诗词列表（用户最关心的内容），10s 超时
    bootStage.value = 'list'
    await withTimeout(loadView('__all__', ''), 10000, '读取诗词列表')

    // 阶段 2：列表已显示，再取总数（不阻塞首屏渲染）
    bootStage.value = 'count'
    fetchTotal().catch(() => {})

    // 若库为空则自动 seeded（开发/首次部署场景）
    if (totalCount.value === 0 && poems.value.length === 0) {
      await withTimeout(seedIfEmpty(), 10000, '初始化示例数据')
      await withTimeout(loadView('__all__', ''), 10000, '读取诗词列表')
    }

    // 等登录态完成（不阻塞内容，但确保点击登录/收藏时状态已就绪）
    bootStage.value = 'auth'
    await withTimeout(authPromise, 8000, '连接用户服务')
  } catch (e) {
    console.warn('init failed', e)
    if (booting.value) bootError.value = e?.message || '初始化失败'
  } finally {
    booting.value = false
    bootStage.value = 'done'
    clearBootWatchdog()
  }

  // 首屏已渲染，再补分类计数（慢查询不阻塞界面）
  refreshCounts()
    .then(() => recalcViewCount())
    .catch(() => {})
  // 空闲时预加载简->繁词典
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => preloadTrad())
  else setTimeout(preloadTrad, 1200)
}

// 启动页「重试」：重置错误态并重新走一遍首屏初始化
function retryBoot() {
  initStarted = false
  booting.value = true
  bootError.value = ''
  init()
}
onMounted(init)

// ---- 回到顶部：列表滚动超过一屏后显示悬浮按钮 ----
const showTopBtn = ref(false)
function onScroll() {
  showTopBtn.value = window.scrollY > 320
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', onScroll))

// ---- 简繁切换：就地重转已加载内容，避免重新请求 ----
const { mode: scriptMode, toggleScript } = useChineseScript()
async function onToggleScript() {
  await toggleScript() // 内部会先确保繁体词典加载完成
  // 列表就地翻转
  reconvertCurrent()
  // 详情页当前诗词同步翻转
  if (detailPoem.value) {
    const p = detailPoem.value
    detailPoem.value = {
      ...p,
      title: flipScript(p.title),
      author: flipScript(p.author),
      content: (p.content || []).map(flipScript),
      translation: flipScript(p.translation),
      notes: flipScript(p.notes),
      audioUrl: p.audioUrl || ''
    }
  }
}

// 登录态变化：登录后拉取收藏与统计；登出后由 store 自动清空
watch(isLoggedIn, (v) => {
  if (v) {
    loadFavorites()
    loadStats()
  }
})

function onSelectTag(tag) {
  activeTag.value = tag
  query.value = ''
  loadView(tag, '')
}

let searchTimer = null
function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadView(activeTag.value, query.value), 300)
}

function openPoem(p) {
  // 收藏页/学习页的诗词来自 RPC，未经 normalize 统一转换，这里补一次字形转换
  detailPoem.value = {
    ...p,
    title: convert(p.title),
    author: convert(p.author),
    content: (p.content || []).map(convert),
    translation: convert(p.translation),
    notes: convert(p.notes),
    audioUrl: p.audioUrl || p.audio_url || ''
  }
  detailMode.value = true
  // 浏览即记录学习（未登录不会产生记录）
  recordStudy(p.id, 'view')
}
function closeDetail() {
  detailMode.value = false
}
function openAdd() {
  editorPoem.value = null
  editorVisible.value = true
}
function openEdit(poem) {
  editorPoem.value = poem
  editorVisible.value = true
}

async function handleSave({ id, payload }) {
  if (id) {
    const res = await updatePoem(id, payload)
    if (res.ok) {
      ElMessage.success('已保存修改')
      editorVisible.value = false
      if (res.poem) detailPoem.value = res.poem
    } else ElMessage.error(res.error)
  } else {
    const res = await addPoem(payload)
    if (res.ok) {
      ElMessage.success('已添加《' + payload.title + '》')
      editorVisible.value = false
    } else ElMessage.error(res.error)
  }
}

async function handleDelete(poem) {
  try {
    await ElMessageBox.confirm(
      `确定删除《${poem.title}》（${poem.author}）吗？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const res = await removePoem(poem.id)
  if (res.ok) {
    detailMode.value = false
    detailPoem.value = null
    ElMessage.success('已删除')
  } else ElMessage.error(res.error)
}

async function handleAddTag(tag) {
  if (!detailPoem.value) return
  const res = await addTag(detailPoem.value.id, tag)
  if (res.ok) {
    if (res.poem) detailPoem.value = res.poem
    ElMessage.success('已添加标签：' + tag)
  } else if (res.exists) {
    ElMessage.info('该标签已存在')
  } else ElMessage.error(res.error)
}

async function handleRemoveTag(tag) {
  if (!detailPoem.value) return
  const res = await removeTag(detailPoem.value.id, tag)
  if (res.ok) {
    if (res.poem) detailPoem.value = res.poem
    ElMessage.success('已移除标签：' + tag)
  } else ElMessage.error(res.error)
}

async function onToggleFavorite(poem) {
  const res = await toggleFavorite(poem.id)
  if (res.needLogin) {
    activeTab.value = 'me'
    ElMessage.info('请先登录后再收藏')
    return
  }
  if (res.ok) {
    ElMessage.success(res.favorited ? '已收藏' : '已取消收藏')
    await loadStats()
  } else if (res.error) {
    ElMessage.error(res.error)
  }
}

function onTab(tab) {
  activeTab.value = tab
}

const importInput = ref(null)
function triggerImport() {
  importInput.value?.click()
}
async function handleImportFile(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result)
      const { added } = await importPoems(data)
      ElMessage.success(`导入完成：新增 ${added} 首`)
    } catch (err) {
      ElMessage.error('导入失败：' + err.message)
    }
  }
  reader.readAsText(file)
  e.target.value = ''
}

async function handleExport() {
  try {
    const data = await exportPoems()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gushici-export.json'
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${data.length} 首诗词`)
  } catch (err) {
    ElMessage.error('导出失败：' + err.message)
  }
}

function onAdminClick() {
  if (isAdmin.value) {
    logout()
    ElMessage.success('已退出超管')
  } else {
    openLogin()
  }
}

function onMore(cmd) {
  if (cmd === 'export') handleExport()
  else if (cmd === 'import') triggerImport()
  else if (cmd === 'github') openImport()
  else if (cmd === 'speed') speedVisible.value = true
}

// ---- 朗读语速：全局生效并持久化，登录与否都能调整 ----
const { speechRate, setSpeechRate, setSpeechNotifier } = useSpeech()
// 把朗读模块内的轻提示接到 Element Plus 消息框（否则 notify 为空、提示静默丢失）
setSpeechNotifier((msg) => ElMessage({ message: msg, type: 'warning', duration: 2500 }))
const speedVisible = ref(false)
const rateValue = ref(speechRate.value)
const rateLabel = computed(() => String(Number(Number(rateValue.value).toFixed(2))))
function onRateInput(v) {
  rateValue.value = v
  setSpeechRate(v)
}
function onResetRate() {
  rateValue.value = setSpeechRate(0.8)
}

// ---- 从 GitHub 导入 ----
const importVisible = ref(false)
const selectedCollections = ref(GITHUB_COLLECTIONS.map((c) => c.key))
const importing = ref(false)
const importProgress = ref(null)
const importResult = ref(null)

function openImport() {
  importVisible.value = true
  importResult.value = null
  importProgress.value = null
}

async function startImport() {
  importing.value = true
  importProgress.value = null
  importResult.value = null
  try {
    const res = await importFromGitHub({
      collections: selectedCollections.value,
      onProgress: (p) => {
        importProgress.value = p
      }
    })
    importResult.value = res
    await refreshCounts()
    await fetchTotal()
    await loadView(activeTag.value, query.value)
    if (res.error) ElMessage.warning('导入中断：' + res.error)
    else ElMessage.success(`GitHub 导入完成：新增约 ${res.inserted} 首`)
  } catch (e) {
    ElMessage.error('导入失败：' + (e.message || e))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="app-shell">
    <!-- 首屏 / 刷新：全屏加载态，数据就绪后再渲染，避免空数据 -->
    <div v-if="booting" class="boot-screen">
      <div class="boot-inner">
        <!-- 翻开诗卷 Loading（纯 CSS+SVG，无依赖）：摊开书，右页绕书脊向左翻页循环 -->
        <div class="book-loading" role="img" aria-label="正在翻开诗卷…">
          <div class="bl-shadow"></div>
          <div class="bl-page bl-left">
            <svg class="bl-deco" viewBox="0 0 50 80" preserveAspectRatio="none" aria-hidden="true">
              <line x1="8" y1="16" x2="42" y2="16" />
              <line x1="8" y1="28" x2="38" y2="28" />
              <line x1="8" y1="40" x2="42" y2="40" />
              <line x1="8" y1="52" x2="30" y2="52" />
            </svg>
          </div>
          <div class="bl-page bl-right">
            <svg class="bl-deco" viewBox="0 0 50 80" preserveAspectRatio="none" aria-hidden="true">
              <line x1="8" y1="16" x2="42" y2="16" />
              <line x1="8" y1="28" x2="38" y2="28" />
              <line x1="8" y1="40" x2="42" y2="40" />
              <line x1="8" y1="52" x2="30" y2="52" />
            </svg>
          </div>
          <div class="bl-spine"></div>
        </div>
        <template v-if="!bootError">
          <div class="boot-text">{{ bootStage === 'auth' ? '正在连接…' : bootStage === 'count' ? '正在整理目录…' : '正在翻开诗卷…' }}</div>
        </template>
        <template v-else>
          <div class="boot-text boot-err">{{ bootError }}</div>
          <button class="boot-retry" @click="retryBoot">重试</button>
        </template>
      </div>
    </div>

    <template v-else>
    <!-- 列表 / 子页面 -->
    <template v-if="!detailMode">
      <!-- 首页 -->
      <template v-if="activeTab === 'home'">
        <header class="hero-header">
          <h1 class="sr-only">古诗词</h1>
          <div class="hero-mask" aria-hidden="true"></div>
          <div class="hero-actions">
            <el-button
              circle
              :type="showPinyin ? 'primary' : 'default'"
              class="hero-btn"
              @click="showPinyin = !showPinyin"
              title="拼音模式"
            >
              <el-icon><IconLangFilled /></el-icon>
            </el-button>
            <el-button
              circle
              class="hero-btn"
              :title="scriptMode === 'cn' ? '当前简体，点击切换繁体' : '当前繁体，点击切换简体'"
              @click="onToggleScript"
            >
              <span class="script-btn-text">{{ scriptMode === 'cn' ? '简' : '繁' }}</span>
            </el-button>
            <el-button
              circle
              :type="isAdmin ? 'success' : 'default'"
              class="hero-btn"
              @click="onAdminClick"
              :title="isAdmin ? '退出超管' : '超管登录'"
            >
              <el-icon><Lock v-if="!isAdmin" /><Unlock v-else /></el-icon>
            </el-button>
            <el-dropdown trigger="click" @command="onMore">
              <el-button circle class="hero-btn" title="更多">
                <el-icon><More /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="speed"><el-icon><ChatDotRound /></el-icon>&nbsp;朗读语速</el-dropdown-item>
                  <el-dropdown-item command="export" divided><el-icon><Download /></el-icon>&nbsp;导出</el-dropdown-item>
                  <el-dropdown-item v-if="isAdmin" command="import"><el-icon><Upload /></el-icon>&nbsp;导入本地 JSON</el-dropdown-item>
                  <el-dropdown-item v-if="isAdmin" command="github"><el-icon><Cloudy /></el-icon>&nbsp;从 GitHub 导入</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button v-if="isAdmin" circle type="primary" class="hero-btn" @click="openAdd" title="添加诗词">
              <el-icon><Plus /></el-icon>
            </el-button>
          </div>

          <div class="hero-search">
            <el-input
              v-model="query"
              class="hero-search-input"
              placeholder="搜索标题 / 作者 / 诗句"
              clearable
              @input="onSearchInput"
              @clear="onSearchInput"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
          </div>

          <input
            ref="importInput"
            type="file"
            accept=".json,application/json"
            style="display: none"
            @change="handleImportFile"
          />
        </header>

        <div class="home-body">
        <Sidebar
          :tags="tagCounts"
          :total="totalCount"
          :active-tag="activeTag"
          @select="onSelectTag"
        />

        <main class="app-main home-main">
          <div class="stat-bar">
            {{ currentCategoryLabel }} · 共 {{ viewCount }} 首
            <span v-if="query">（搜索“{{ query }}”）</span>
            <span v-else-if="activeTag === '__all__'" class="hot-flag">· 热门优先</span>
            <span class="script-flag">· {{ scriptMode === 'cn' ? '简体' : '繁体' }}</span>
            <span v-if="showPinyin" class="py-flag">· 拼音模式</span>
            <span v-if="isAdmin" class="admin-flag">· 超管</span>
          </div>

          <div v-if="loading && poems.length === 0" class="loading-wrap">加载中…</div>

          <div v-else-if="poems.length" class="poem-grid">
            <PoemCard
              v-for="p in poems"
              :key="p.id"
              :poem="p"
              :favorited="isFavorite(p.id)"
              @open="openPoem"
              @toggle-favorite="onToggleFavorite"
            />
            <div class="load-more-wrap">
              <button
                v-if="hasMore"
                class="load-more-btn"
                :disabled="loading"
                @click="loadMore"
              >
                <span v-if="loading" class="lm-spinner"></span>
                <span>{{ loading ? '加载中…' : '加载更多' }}</span>
                <span v-if="!loading && viewCount > 0" class="lm-count">
                  已看 {{ poems.length }} / {{ viewCount }}
                </span>
              </button>
              <div v-else class="end-tip">
                <span class="end-line"></span>
                <span>已经到底啦，去读一首喜欢的吧</span>
                <span class="end-line"></span>
              </div>
            </div>
          </div>

          <div v-else class="empty-tip">
            <template v-if="error">{{ error }}</template>
            <template v-else-if="query && query.trim()">
              没有搜索到“{{ query }}”相关的诗词，换个关键词试试。
            </template>
            <template v-else>
              还没有诗词。点右上角「从 GitHub 导入」一键载入全库，或以超管身份「添加」手动录入。
            </template>
          </div>
        </main>
        </div>
      </template>

      <!-- 收藏 -->
      <FavoritesView
        v-else-if="activeTab === 'fav'"
        @open="openPoem"
      />

      <!-- 学习 -->
      <StudyView
        v-else-if="activeTab === 'study'"
        @open="openPoem"
      />

      <!-- 我的 -->
      <MeView v-else-if="activeTab === 'me'" />

      <!-- 回到顶部 -->
      <transition name="fade-up">
        <button
          v-show="showTopBtn && activeTab === 'home' && !detailMode"
          class="back-top-btn"
          title="回到顶部"
          aria-label="回到顶部"
          @click="scrollToTop"
        >
          <el-icon><Top /></el-icon>
        </button>
      </transition>

      <nav class="bottom-tabbar" role="tablist" aria-label="主导航">
        <button
          type="button"
          class="tab-item"
          role="tab"
          :class="{ active: activeTab === 'home' }"
          :aria-selected="activeTab === 'home'"
          aria-label="首页"
          @click="onTab('home')"
        >
          <el-icon><HomeFilled /></el-icon>
          <span>首页</span>
        </button>
        <button
          type="button"
          class="tab-item"
          role="tab"
          :class="{ active: activeTab === 'fav' }"
          :aria-selected="activeTab === 'fav'"
          aria-label="收藏"
          @click="onTab('fav')"
        >
          <el-icon><StarFilled /></el-icon>
          <span>收藏</span>
        </button>
        <button
          type="button"
          class="tab-item"
          role="tab"
          :class="{ active: activeTab === 'study' }"
          :aria-selected="activeTab === 'study'"
          aria-label="学习"
          @click="onTab('study')"
        >
          <el-icon><IconBookFilled /></el-icon>
          <span>学习</span>
        </button>
        <button
          type="button"
          class="tab-item"
          role="tab"
          :class="{ active: activeTab === 'me' }"
          :aria-selected="activeTab === 'me'"
          aria-label="我的"
          @click="onTab('me')"
        >
          <el-icon><UserFilled /></el-icon>
          <span>我的</span>
        </button>
      </nav>

      <!-- tab 切换 / 子页面数据加载：轻量顶部进度条，不遮挡内容（loading.md：加载时让人能继续浏览） -->
      <div v-if="tabLoading" class="app-progress" role="progressbar" aria-label="加载中">
        <span class="app-progress-bar"></span>
      </div>
    </template>

    <!-- 详情页（整屏） -->
    <PoemDetailView
      v-else
      :poem="detailPoem"
      :show-pinyin="showPinyin"
      :is-admin="isAdmin"
      :favorited="detailPoem && isFavorite(detailPoem.id)"
      :script-mode="scriptMode"
      :tag-options="tagCounts"
      @back="closeDetail"
      @edit="openEdit"
      @delete="handleDelete"
      @add-tag="handleAddTag"
      @remove-tag="handleRemoveTag"
      @toggle-pinyin="showPinyin = !showPinyin"
      @toggle-script="onToggleScript"
      @toggle-favorite="onToggleFavorite"
    />

    <PoemEditorDialog
      v-model:visible="editorVisible"
      :poem="editorPoem"
      :tag-suggestions="tagNames"
      @save="handleSave"
    />

    <!-- 超管登录 -->
    <el-dialog v-model="showLogin" title="超管登录" width="360px" class="login-dialog">
      <p class="login-desc">
        输入管理口令以进行修改（添加 / 编辑 / 删除诗词、移除标签）。<br />
        普通用户可自由浏览、搜索与添加标签。
      </p>
      <el-input
        v-model="passInput"
        type="password"
        show-password
        placeholder="管理口令"
        @keyup.enter="login"
      />
      <div v-if="errorMsg" class="login-err">{{ errorMsg }}</div>
      <template #footer>
        <el-button @click="showLogin = false">取消</el-button>
        <el-button type="primary" @click="login">登录</el-button>
      </template>
    </el-dialog>

    <!-- GitHub 导入对话框 -->
    <el-dialog v-model="importVisible" title="从 GitHub 导入古诗词" width="520px" class="import-dialog">
      <div v-if="!importResult">
        <p class="import-desc">
          选择要从开源仓库 <code>chinese-poetry</code> 导入的合集。浏览器直连 CDN，批量写入云端数据库：
        </p>
        <el-checkbox-group v-model="selectedCollections" class="import-checks">
          <el-checkbox v-for="c in GITHUB_COLLECTIONS" :key="c.key" :value="c.key">
            {{ c.label }}
          </el-checkbox>
        </el-checkbox-group>
        <el-alert
          v-if="selectedCollections.includes('tang') || selectedCollections.includes('song')"
          type="warning"
          :closable="false"
          class="import-warn"
        >
          唐诗 + 宋词合集约 6 万首，写入量较大，可能触及云数据库配额上限；若中途停止属正常，可分次导入。
        </el-alert>
        <div v-if="importing && importProgress" class="import-progress">
          正在导入 {{ importProgress.label || '…' }} … 已写入 {{ importProgress.inserted || 0 }} 首
        </div>
      </div>
      <div v-else class="import-result">
        <el-result
          :status="importResult.error ? 'warning' : 'success'"
          :title="importResult.error ? '导入中断' : '导入完成'"
          :sub-title="importResult.error || ''"
        >
          <template #extra>
            <div>新增约 <b>{{ importResult.inserted }}</b> 首</div>
          </template>
        </el-result>
      </div>

      <template #footer>
        <el-button v-if="!importing && !importResult" type="primary" :disabled="!selectedCollections.length" @click="startImport">
          开始导入
        </el-button>
        <el-button v-if="importing" :loading="true">导入中…</el-button>
        <el-button v-if="importResult" @click="importVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 朗读语速对话框 -->
    <el-dialog v-model="speedVisible" title="朗读语速" width="320px" class="speed-dialog">
      <div class="rate-head">
        <span class="rate-title">当前倍速</span>
        <span class="rate-value">×{{ rateLabel }}</span>
      </div>
      <el-slider
        v-model="rateValue"
        :min="0.5"
        :max="1.5"
        :step="0.05"
        :show-tooltip="false"
        @input="onRateInput"
      />
      <div class="rate-tips">拖动调整朗读快慢（0.5× ~ 1.5×），默认 0.8 倍，对列表卡片与详情页朗读全局生效。</div>
      <template #footer>
        <el-button @click="onResetRate">恢复默认</el-button>
        <el-button type="primary" @click="speedVisible = false">完成</el-button>
      </template>
    </el-dialog>
    </template>
  </div>
</template>

<style scoped>
/* ---- 首屏加载遮罩 ---- */
.boot-screen {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #eaf4ff 0%, #f7fbff 100%);
}
.boot-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.boot-text {
  font-size: 15px;
  color: var(--text-soft);
  letter-spacing: 1px;
}
.boot-err {
  color: var(--warn-text, #b9701a);
  max-width: 260px;
  text-align: center;
  line-height: 1.5;
}
.boot-retry {
  margin-top: 6px;
  padding: 10px 28px;
  min-height: 44px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #7ab8f9 0%, #4a9df6 100%);
  color: #fff;
  font-size: 15px;
  letter-spacing: 2px;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(74, 157, 246, 0.35);
}
@keyframes boot-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.loading-wrap {
  text-align: center;
  color: var(--text-soft);
  padding: 50px 20px;
  font-size: 15px;
}

/* ---- 加载更多：柔和渐变胶囊按钮 ---- */
.load-more-wrap {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  padding: 18px 0 10px;
}
.load-more-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 26px;
  border: none;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, #7ab8f9 0%, #4a9df6 100%);
  box-shadow: 0 6px 16px rgba(74, 157, 246, 0.32);
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
}
.load-more-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(74, 157, 246, 0.42);
}
.load-more-btn:active:not(:disabled) {
  transform: translateY(0);
}
.load-more-btn:disabled {
  opacity: 0.7;
  cursor: default;
}
.lm-count {
  font-size: 12px;
  font-weight: 500;
  opacity: 0.9;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.4);
}
.lm-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: lm-spin 0.7s linear infinite;
}
@keyframes lm-spin {
  to { transform: rotate(360deg); }
}

/* ---- 到底提示 ---- */
.end-tip {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-soft);
  opacity: 0.75;
}
.end-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--chip-bg), transparent);
}

/* ---- 回到顶部悬浮按钮（纯图标圆形） ---- */
.back-top-btn {
  position: fixed;
  right: 16px;
  bottom: 84px;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(135deg, #7ab8f9 0%, #4a9df6 100%);
  box-shadow: 0 6px 18px rgba(74, 157, 246, 0.4);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.back-top-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 24px rgba(74, 157, 246, 0.5);
}
.back-top-btn .el-icon {
  font-size: 22px;
}

.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.hot-flag {
  color: var(--warn-text);
  font-weight: 600;
}
.script-flag {
  color: var(--text-soft);
}
.script-btn-text {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}
.py-flag {
  color: var(--accent-text);
}
.admin-flag {
  color: var(--signal-text);
}
.import-desc {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-soft);
  margin: 0 0 14px;
}
.import-desc code {
  background: var(--chip-bg);
  padding: 1px 6px;
  border-radius: 5px;
  color: var(--accent);
}
.import-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
}
.import-warn {
  margin-top: 14px;
}
.import-progress {
  margin-top: 14px;
  font-size: 13px;
  color: var(--accent-text);
}
.import-result {
  padding: 6px 0;
}
.login-desc {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-soft);
  margin: 0 0 14px;
}
.login-err {
  color: var(--accent-text);
  font-size: 13px;
  margin-top: 8px;
}
</style>
