import { ref, computed, onUnmounted } from 'vue'

// 朗读实现（双通道）：
//   1) 云端音频（audio_url）—— 首选。不依赖设备 TTS 能力，vivo/OPPO 等国产浏览器
//      的 WebView 常不暴露任何语音引擎（getVoices() 返回空），只有这条路能保证有声音。
//   2) Web Speech API —— 兜底。音频未生成时使用（电脑端/部分手机可用）。
// 两者都不可用时，通过 canPlay 暴露原因，界面给出明确提示。
//
// 状态隔离：播放引擎是全局单例（同一时刻只能有一份声音），但「正在朗读哪一首」
// 用 currentId 记录；useSpeech(id) 返回的 isSpeaking 是 computed，只有 id 匹配的
// 组件才显示播放态 —— 否则所有卡片共用一个 isSpeaking，会同时变成"停止"。

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
const supported = ref(!!synth)
const currentId = ref(null) // 当前正在朗读的诗词 id（全局唯一播放）
const isReady = ref(false) // 找到可用中文语音（Web Speech 通道）
const hasAnyVoice = ref(false)
const channel = ref('') // 'audio' | 'tts' | ''

// ---- 朗读语速（可手动调节，持久化到本地）----
// 默认 0.8 倍：浏览器默认 1.0 对古诗朗读偏快
const RATE_KEY = 'gushici.speechRate'
const DEFAULT_RATE = 0.8
function readRate() {
  try {
    const v = parseFloat(localStorage.getItem(RATE_KEY))
    if (!Number.isNaN(v) && v >= 0.5 && v <= 2) return v
  } catch {
    /* 隐私模式下 localStorage 可能不可用，用默认值 */
  }
  return DEFAULT_RATE
}
const speechRate = ref(readRate())
function setSpeechRate(v) {
  const n = Math.min(2, Math.max(0.5, Number(v) || DEFAULT_RATE))
  speechRate.value = n
  try {
    localStorage.setItem(RATE_KEY, String(n))
  } catch {
    /* 写入失败忽略，当前会话内仍生效 */
  }
  // 云端音频正在播放时立即生效；TTS 通道在下次朗读时生效
  if (audioEl && channel.value === 'audio') {
    try {
      audioEl.playbackRate = n
    } catch {
      /* 忽略 */
    }
  }
  return n
}

let voices = []
let keepAliveTimer = null
let audioEl = null
let speakToken = 0 // 递增令牌：每次 stop()/新朗读都会作废上一批待播的 TTS 回调，避免陈旧超时误触发
let audioFallbackDone = false // 防止音频 onerror 与 promise.catch 重复触发回退

function loadVoices() {
  if (!synth) return
  try {
    voices = synth.getVoices() || []
  } catch {
    voices = []
  }
  hasAnyVoice.value = voices.length > 0
  isReady.value = !!pickChineseVoice(voices)
}

function pickChineseVoice(list) {
  if (!list || !list.length) return null
  const zh = list.filter((v) => v.lang && /^zh/i.test(v.lang))
  if (!zh.length) return null
  const score = (v) => {
    const lang = (v.lang || '').toLowerCase().replace('_', '-')
    let s = 0
    if (lang === 'zh-cn' || lang === 'zh-hans') s += 100
    else if (lang.startsWith('zh-cn')) s += 90
    else if (lang.startsWith('zh-hant') || lang.startsWith('zh-tw') || lang.startsWith('zh-hk')) s += 70
    else s += 50
    if (v.localService) s += 30
    if (v.default) s += 10
    return s
  }
  return zh.sort((a, b) => score(b) - score(a))[0]
}

function pickVoice() {
  if (!voices.length && synth) {
    try {
      voices = synth.getVoices() || []
    } catch {
      voices = []
    }
  }
  return pickChineseVoice(voices)
}

function splitText(text, maxLen = 120) {
  const s = String(text || '').trim()
  if (s.length <= maxLen) return [s]
  const parts = []
  let buf = ''
  for (const ch of s) {
    buf += ch
    if ('。！？；\n'.includes(ch) && buf.length >= maxLen * 0.5) {
      parts.push(buf)
      buf = ''
    }
    if (buf.length >= maxLen) {
      parts.push(buf)
      buf = ''
    }
  }
  if (buf.trim()) parts.push(buf)
  return parts.filter(Boolean)
}

function clearKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
}

function startKeepAlive() {
  clearKeepAlive()
  keepAliveTimer = setInterval(() => {
    if (!synth || !synth.speaking) return
    try {
      synth.pause()
      synth.resume()
    } catch {
      /* 部分实现不支持，忽略 */
    }
  }, 10000)
}

function finish() {
  currentId.value = null
  channel.value = ''
  currentUtter = null
  clearKeepAlive()
}

// ---- 通道 1：云端音频 ----
function playAudio(url) {
  if (!url) return false
  try {
    if (!audioEl) {
      audioEl = new Audio()
      audioEl.preload = 'none'
    }
    audioEl.pause()
    audioEl.src = url
    audioEl.volume = 1
    // 云端音频是 mp3，不受 TTS 的 rate 控制，必须单独设置播放速率
    audioEl.playbackRate = speechRate.value
    audioEl.onended = () => finish()
    audioEl.onerror = () => {
      if (audioFallbackDone) return
      audioFallbackDone = true
      // 音频地址失效（404/解码失败）→ 回退到 TTS
      audioEl = null
      channel.value = ''
      ElMessageLite('音频加载失败，已切换为系统语音')
      ttsSpeak(pendingText)
    }
    const p = audioEl.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        if (audioFallbackDone) return
        audioFallbackDone = true
        audioEl = null
        channel.value = ''
        ttsSpeak(pendingText)
      })
    }
    channel.value = 'audio'
    return true
  } catch {
    audioEl = null
    return false
  }
}

// ---- 通道 2：Web Speech API ----
let currentUtter = null
let pendingText = ''
let pendingId = null

function ttsSpeak(text) {
  if (!synth || !text) {
    finish()
    return
  }
  const myToken = ++speakToken
  stopTts()
  loadVoices()
  const chunks = splitText(text)
  if (!chunks.length) {
    finish()
    return
  }
  channel.value = 'tts'
  startKeepAlive()

  let idx = 0
  const next = () => {
    if (myToken !== speakToken) return // 已被新的朗读/停止打断，丢弃本次回调
    if (idx >= chunks.length) {
      finish()
      return
    }
    const u = new SpeechSynthesisUtterance(chunks[idx])
    const v = pickVoice()
    if (v) {
      u.voice = v
      u.lang = v.lang
    } else {
      u.lang = 'zh-CN'
    }
    u.rate = speechRate.value
    u.pitch = 1
    u.volume = 1
    u.onend = () => {
      idx++
      next()
    }
    u.onerror = (e) => {
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return
      finish()
    }
    currentUtter = u
    try {
      if (synth.paused) synth.resume()
      synth.speak(u)
      // 看门狗：部分设备 WebView 对 speak() 毫无反应（synth.speaking 永不为 true），
      // 既不报错也不发声，会卡在“播放中”。1.5s 内仍未进入 speaking 即判定设备不支持，优雅收尾并提示。
      const watchdog = setTimeout(() => {
        if (myToken !== speakToken) return
        if (!synth.speaking && channel.value === 'tts') {
          finish()
          ElMessageLite('本设备暂不支持语音朗读，请确认系统已启用中文语音引擎，或等待云端音频补齐')
        }
      }, 1500)
      // 真正开始发声后撤销看门狗
      u.onstart = () => clearTimeout(watchdog)
    } catch {
      finish()
    }
  }

  // 关键修复：Android WebView / Chrome 在「同一 tick 内 cancel 之后立即 speak」
  // 会导致新语句被丢弃、onend 立即触发 → 状态瞬间还原且无声音。
  // 因此把首条 speak 推迟到下一个宏任务，与上方 stopTts() 的 cancel 拉开时序。
  setTimeout(next, 150)
}

function stopTts() {
  if (!synth) return
  try {
    synth.cancel()
  } catch {
    /* 忽略 */
  }
  currentUtter = null
  clearKeepAlive()
}

// 轻提示（避免在此模块耦合 UI 组件）
let notify = null
export function setSpeechNotifier(fn) {
  notify = fn
}
function ElMessageLite(msg) {
  if (notify) notify(msg)
}

/**
 * 朗读入口。
 * @param {string} text 朗读文本
 * @param {string} audioUrl 云端音频地址（可选，存在则优先播放）
 * @param {number|string} poemId 诗词标识，用于把播放态绑定到对应卡片
 */
function speak(text, audioUrl, poemId = null) {
  pendingText = text || ''
  pendingId = poemId
  audioFallbackDone = false
  stop()
  // 先尝试云端音频（首选，真机最可靠）
  if (audioUrl && playAudio(audioUrl)) {
    currentId.value = poemId
    return
  }
  // 无音频或音频不可用 → 回退 TTS
  if (!synth) {
    // 既无音频又无设备 TTS：不进入播放态，避免点击后闪烁还原（界面另有提示）
    return
  }
  // 先记录播放对象，再启动通道，避免降级时丢失状态
  currentId.value = poemId
  ttsSpeak(pendingText)
}

function stop() {
  speakToken++ // 作废任何待播放的 TTS 回调（避免上一段被推迟的 speak 误触发）
  if (audioEl) {
    try {
      audioEl.onended = null
      audioEl.onerror = null
      audioEl.pause()
      audioEl.src = ''
    } catch {
      /* 忽略 */
    }
    audioEl = null
  }
  stopTts()
  finish()
}

// 初始化 TTS 语音列表
if (synth) {
  loadVoices()
  try {
    synth.addEventListener('voiceschanged', loadVoices)
  } catch {
    try {
      synth.onvoiceschanged = loadVoices
    } catch {
      /* 忽略 */
    }
  }
  let tries = 0
  const poll = setInterval(() => {
    loadVoices()
    if (isReady.value || ++tries > 20) clearInterval(poll)
  }, 500)
}

try {
  synth && synth.removeEventListener && synth.removeEventListener('voiceschanged', loadVoices)
} catch {
  /* 忽略 */
}

/**
 * 绑定到某个组件（通常是一首诗）的朗读状态。
 * @param {number|string|import('vue').Ref} poemId 该诗词的唯一标识（支持 ref/computed）；
 *        传入后 isSpeaking 只在「当前正在朗读的就是它」时为 true，
 *        避免所有列表卡片同时显示播放态。
 */
export function useSpeech(poemId = null) {
  const readId = () => (poemId && typeof poemId === 'object' && 'value' in poemId ? poemId.value : poemId)
  const isSpeaking = computed(() => {
    const mine = readId()
    return currentId.value != null && currentId.value === mine
  })
  try {
    onUnmounted(() => {
      // 组件卸载时若正在播放的是它，则停止
      const mine = readId()
      if (currentId.value != null && currentId.value === mine) stop()
    })
  } catch {
    /* 非组件环境（如全局调用）忽略 */
  }
  return {
    supported,
    isSpeaking,
    isReady,
    hasAnyVoice,
    channel,
    currentId,
    speechRate,
    setSpeechRate,
    speak,
    stop,
    // 模块级函数一并暴露，允许调用方从 useSpeech() 解构使用（否则解构出 undefined，
    // 调用时抛 "xxx is not a function"，曾导致 App.vue 启动即报错）
    setSpeechNotifier
  }
}
