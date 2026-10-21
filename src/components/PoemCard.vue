<script setup>
import { computed, ref } from 'vue'
import { ElIcon, ElMessage } from 'element-plus'
import { Close, StarFilled } from '@element-plus/icons-vue'
import { IconMicFilled } from './Icons.js'
import { useSpeech } from '../composables/useSpeech.js'
import { useBridge } from '../composables/useBridge.js'

const props = defineProps({
  poem: { type: Object, required: true },
  favorited: { type: Boolean, default: false }
})
const emit = defineEmits(['open', 'toggle-favorite'])
const bridge = useBridge()

function onToggleFav() {
  // 轻触反馈：本地容器下短振，远程/浏览器静默降级（HIG：交互要有可感知反馈）
  bridge.vibrate(10)
  emit('toggle-favorite', props.poem)
}

const thumbChar = computed(() => (props.poem.title || '').charAt(0) || '诗')
const thumbStyle = computed(() => {
  const title = props.poem.title || ''
  const code = title.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  const hue = (code % 360)
  return {
    background: `linear-gradient(135deg, hsl(${hue} 78% 76%) 0%, hsl(${(hue + 35) % 360} 72% 86%) 100%)`
  }
})

// 传入 poem.id：只有当前正在朗读的这张卡片才显示"停止"态
const { isSpeaking, isReady, hasAnyVoice, speak, stop } = useSpeech(props.poem.id)
function onSpeak() {
  if (isSpeaking.value) {
    stop()
    return
  }
  const p = props.poem
  const text = `${p.title}。${p.author}。${p.content.join('')}`
  // 有云端音频时直接播放（不依赖设备 TTS）；否则回退系统语音
  if (p.audioUrl) {
    speak(text, p.audioUrl, p.id)
    return
  }
  // 无音频且系统无 TTS 引擎时给出明确提示（vivo 等国产浏览器常见）
  setTimeout(() => {
    if (!hasAnyVoice.value) {
      ElMessage.warning('本机无语音引擎，该诗朗读音频尚未生成')
    } else if (!isReady.value) {
      ElMessage.warning('本机暂无中文语音，请在系统设置中启用中文语音包')
    }
  }, 400)
  speak(text, '', p.id)
}
</script>

<template>
  <div class="poem-card" @click="emit('open', poem)">
    <div class="poem-thumb" :style="thumbStyle" aria-hidden="true">
      {{ thumbChar }}
    </div>

    <div class="poem-card-body">
      <div class="poem-card-head">
        <span class="poem-card-title">{{ poem.title }}</span>
        <span class="poem-card-meta">
          <template v-if="poem.dynasty">{{ poem.dynasty }}·</template>{{ poem.author }}
        </span>
      </div>

      <div v-if="poem.tags && poem.tags.length" class="poem-card-tags-line">
        <span v-for="tag in poem.tags.slice(0, 3)" :key="tag">#{{ tag }}</span>
      </div>
    </div>

    <div class="poem-card-actions">
      <button
        class="fav-btn tap-target"
        :class="{ active: props.favorited }"
        @click.stop="onToggleFav"
        :title="props.favorited ? '取消收藏' : '收藏'"
        :aria-label="props.favorited ? '取消收藏' : '收藏'"
        :aria-pressed="props.favorited"
      >
        <el-icon><StarFilled :class="{ dim: !props.favorited }" /></el-icon>
      </button>
      <button
        class="speak-btn tap-target"
        :class="{ active: isSpeaking }"
        @click.stop="onSpeak"
        :title="isSpeaking ? '停止朗读' : '朗读'"
        :aria-label="isSpeaking ? '停止朗读' : '朗读'"
      >
        <el-icon><IconMicFilled v-if="!isSpeaking" /><Close v-else /></el-icon>
      </button>
    </div>
  </div>
</template>
