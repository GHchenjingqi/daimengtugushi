<script setup>
import { ref, computed, watch } from 'vue'
import { ElIcon, ElMessage } from 'element-plus'
import { ArrowLeft, ArrowDown, ArrowUp, Close, DeleteFilled, StarFilled, Search } from '@element-plus/icons-vue'
import { IconMicFilled, IconLangFilled, IconEditFilled } from './Icons.js'
import { useSpeech } from '../composables/useSpeech.js'
import { useUserStore } from '../composables/useUserStore.js'
import { cloud } from '../cloud.js'
import { pinyinTokens } from '../composables/usePinyin.js'
import { splitByPunctuation } from '../utils/poemFormat.js'

const props = defineProps({
  poem: { type: Object, required: true },
  showPinyin: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  favorited: { type: Boolean, default: false },
  scriptMode: { type: String, default: 'cn' },
  // 全库已有标签 [{ name, count }]，用于检索避免重复造词
  tagOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['back', 'edit', 'delete', 'add-tag', 'remove-tag', 'toggle-pinyin', 'toggle-favorite', 'toggle-script'])

function onToggleFav() { emit('toggle-favorite', props.poem) }
function onToggleScript() { emit('toggle-script') }

const tagInput = ref('')
const showNotes = ref(false) // 注解默认隐藏
const showTranslation = ref(true) // 译文默认展开

// 标签检索：优先匹配前缀，其次包含；排除当前诗词已有的标签；按数量降序
const tagSearchOpen = ref(false)
const matchedTags = computed(() => {
  const kw = (tagInput.value || '').trim().toLowerCase()
  const owned = new Set(props.poem.tags || [])
  let list = props.tagOptions || []
  if (kw) {
    list = list.filter((t) => t.name.toLowerCase().includes(kw))
  }
  return list
    .filter((t) => !owned.has(t.name)) // 已有的不再提示
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
})

// 精确已存在时提示，避免重复添加
const exactExists = computed(() =>
  (props.poem.tags || []).includes((tagInput.value || '').trim())
)

const titlePy = computed(() => pinyinTokens(props.poem.title))
const displayLines = computed(() =>
  (props.poem.content || []).flatMap((line) => splitByPunctuation(line))
)
const contentPy = computed(() =>
  displayLines.value.map((line) => pinyinTokens(line))
)

// 绑定当前诗词 id：详情页与列表共享同一播放态，切页后状态仍正确
const { isSpeaking, isReady, hasAnyVoice, speak, stop } = useSpeech(
  computed(() => props.poem?.id ?? null)
)
const speakText = computed(() => {
  const p = props.poem
  return `${p.title}。${p.dynasty ? p.dynasty + '。' : ''}${p.author}。${p.content.join('')}`
})

// 云端音频优先（不依赖设备 TTS，国产浏览器可用）；无音频时回退 Web Speech API。
// 两者都不可用时给出明确指引，而不是让用户对着无声按钮困惑。
const speechHint = ref('')
function toggleSpeak() {
  if (isSpeaking.value) {
    stop()
    return
  }
  speechHint.value = ''
  const p = props.poem
  const id = p.id
  if (p.audioUrl) {
    speak(speakText.value, p.audioUrl, id)
    return
  }
  setTimeout(() => {
    if (!hasAnyVoice.value) {
      speechHint.value = '本机未检测到语音引擎，该诗朗读音频尚未生成；可换用系统浏览器，或等待音频补齐'
    } else if (!isReady.value) {
      speechHint.value = '本机暂无中文语音，请在系统设置中启用中文（普通话）语音包'
    }
  }, 400)
  speak(speakText.value, '', id)
}

function onBack() { emit('back') }
function onEdit() { emit('edit', props.poem) }
function onDelete() { emit('delete', props.poem) }
function onTogglePinyin() { emit('toggle-pinyin') }
function onAddTag(existing) {
  const t = String(existing != null ? existing : tagInput.value || '').trim()
  if (!t) return
  emit('add-tag', t)
  tagInput.value = ''
  tagSearchOpen.value = false
}
// 输入框聚焦时展开候选；失焦延迟关闭以便点击生效
function onTagFocus() {
  tagSearchOpen.value = true
}
function onTagBlur() {
  setTimeout(() => (tagSearchOpen.value = false), 160)
}
function onRemoveTag(tag) { emit('remove-tag', tag) }

// ---- 背诵打卡：完成背诵点一下，当日学习日历打 ✓ ----
const { recordStudy } = useUserStore()
const memoDone = ref(false) // 今天这首是否已打卡
const memoBusy = ref(false)
async function checkMemoToday() {
  memoDone.value = false
  const id = props.poem?.id
  if (id == null) return
  try {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const { data } = await cloud.database
      .from('study_records')
      .select('id')
      .eq('poem_id', id)
      .eq('action', 'memorize')
      .gte('studied_at', start.toISOString())
      .limit(1)
    memoDone.value = !!(data && data.length)
  } catch {
    /* 查询失败不阻塞页面，视为未打卡 */
  }
}
async function onMemorize() {
  if (memoDone.value || memoBusy.value) return
  memoBusy.value = true
  try {
    const r = await recordStudy(props.poem.id, 'memorize')
    if (r.ok) {
      memoDone.value = true
      ElMessage.success('背诵打卡成功，太棒啦！')
    } else if (r.needLogin) {
      ElMessage.warning('登录后才能打卡哦')
    } else {
      ElMessage.error(r.error || '打卡失败，稍后再试')
    }
  } finally {
    memoBusy.value = false
  }
}
watch(() => props.poem?.id, checkMemoToday, { immediate: true })
</script>

<template>
  <div class="detail-view">
    <header class="detail-toolbar">
      <el-button circle text size="large" @click="onBack" title="返回">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="toolbar-title">{{ poem.title }}</div>
      <!-- 与左侧返回按钮对称的透明占位，保证标题视觉居中 -->
      <div class="toolbar-spacer" aria-hidden="true"></div>
      <div v-if="speechHint" class="speech-hint">{{ speechHint }}</div>
    </header>

    <!-- 右下角悬浮工具条：收藏 / 拼音 / 朗读 / 简繁（超管另加删除/编辑） -->
    <div class="fab-tools">
      <el-button circle text size="large" @click="onToggleFav" :class="{ active: props.favorited }" :title="props.favorited ? '取消收藏' : '收藏'">
        <el-icon><StarFilled :class="{ dim: !props.favorited }" /></el-icon>
      </el-button>
      <el-button circle text size="large" @click="onTogglePinyin" :class="{ active: showPinyin }" title="拼音">
        <el-icon><IconLangFilled /></el-icon>
      </el-button>
      <el-button circle text size="large" @click="toggleSpeak" :class="{ active: isSpeaking }" title="朗读">
        <el-icon><IconMicFilled v-if="!isSpeaking" /><Close v-else /></el-icon>
      </el-button>
      <el-button
        circle
        text
        size="large"
        @click="onToggleScript"
        :title="scriptMode === 'cn' ? '切换繁体' : '切换简体'"
      >
        <span class="script-toggle-text">{{ scriptMode === 'cn' ? '繁' : '简' }}</span>
      </el-button>
      <template v-if="isAdmin">
        <el-button circle text size="large" type="danger" @click="onDelete" title="删除">
          <el-icon><DeleteFilled /></el-icon>
        </el-button>
        <el-button circle text size="large" type="primary" @click="onEdit" title="编辑">
          <el-icon><IconEditFilled /></el-icon>
        </el-button>
      </template>
    </div>

    <main class="detail-body">
      <div class="poem-stage">
        <div class="poem-title-block">
          <div v-if="showPinyin" class="title-pinyin-line">
            <span v-for="(t, i) in titlePy" :key="i" class="title-pinyin-char">{{ t.py || '\u00A0' }}</span>
          </div>
          <h1 class="poem-title">{{ poem.title }}</h1>
          <div class="poem-author">
            <template v-if="poem.dynasty">{{ poem.dynasty }} · </template>{{ poem.author }}
          </div>
        </div>

        <div class="poem-content poem-font">
          <template v-if="showPinyin">
            <div v-for="(line, i) in contentPy" :key="i" class="py-line">
              <span v-for="(t, j) in line" :key="j" class="py-token">
                <span class="py">{{ t.py }}</span><span class="ch">{{ t.ch }}</span>
              </span>
            </div>
          </template>
          <template v-else>
            <div v-for="(line, i) in displayLines" :key="i" class="poem-line">{{ line }}</div>
          </template>
        </div>
      </div>

      <div class="detail-extras">
        <template v-if="poem.translation">
          <div class="extra-section">
            <div class="extra-title" @click="showTranslation = !showTranslation">
              译文
              <el-icon class="extra-icon"><ArrowDown v-if="!showTranslation" /><ArrowUp v-else /></el-icon>
            </div>
            <div v-if="showTranslation" class="extra-body">{{ poem.translation }}</div>
          </div>
        </template>

        <template v-if="poem.notes">
          <div class="extra-section">
            <div class="extra-title" @click="showNotes = !showNotes">
              注解
              <el-icon class="extra-icon"><ArrowDown v-if="!showNotes" /><ArrowUp v-else /></el-icon>
            </div>
            <div v-if="showNotes" class="extra-body">{{ poem.notes }}</div>
          </div>
        </template>

        <button
          class="memo-btn"
          :class="{ done: memoDone }"
          :disabled="memoDone || memoBusy"
          @click="onMemorize"
        >
          <span class="memo-check">{{ memoDone ? '✓' : '' }}</span>
          {{ memoDone ? '今日已打卡' : '我背会了 · 打卡' }}
        </button>

        <div class="detail-tags-block">
          <div class="tags-row">
            <span
              v-for="tag in poem.tags"
              :key="tag"
              class="tag-pill"
              :class="{ removable: isAdmin }"
            >
              {{ tag }}
              <el-icon v-if="isAdmin" class="tag-x" @click="onRemoveTag(tag)"><Close /></el-icon>
            </span>
          </div>
          <div class="tag-add">
            <el-input
              v-model="tagInput"
              size="large"
              placeholder="检索或输入标签，回车添加"
              @focus="onTagFocus"
              @blur="onTagBlur"
              @keyup.enter="onAddTag()"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button size="large" type="primary" @click="onAddTag()">添加</el-button>

            <!-- 已有标签候选：显示数量，避免重复造词 -->
            <transition name="tag-pop">
              <div v-if="tagSearchOpen && matchedTags.length" class="tag-suggest">
                <div class="tag-suggest-hint">
                  {{ tagInput.trim() ? `匹配「${tagInput.trim()}」` : '常用标签' }}
                  <span v-if="exactExists" class="tag-dup-flag">该标签已存在</span>
                </div>
                <ul class="tag-suggest-list">
                  <li
                    v-for="t in matchedTags"
                    :key="t.name"
                    class="tag-suggest-item"
                    @mousedown.prevent="onAddTag(t.name)"
                  >
                    <span class="ts-name">{{ t.name }}</span>
                    <span class="ts-count">{{ t.count }} 首</span>
                  </li>
                </ul>
              </div>
            </transition>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
