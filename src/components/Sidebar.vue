<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

defineProps({
  tags: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  activeTag: { type: String, default: '__all__' }
})
const emit = defineEmits(['select'])

// 只在分类条「吸附悬浮」时补状态栏高度：正常位置不加 padding，吸顶后才有，避免一直占位
const barEl = ref(null)
const stuck = ref(false)
let ticking = false
function checkStuck() {
  const el = barEl.value
  if (!el) return
  // sticky top:0 生效后元素顶边贴住视口顶部（top 约等于 0）
  stuck.value = el.getBoundingClientRect().top <= 1
}
function onScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    ticking = false
    checkStuck()
  })
}
onMounted(() => {
  checkStuck()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <nav ref="barEl" class="cat-bar" :class="{ 'is-stuck': stuck }">
    <button
      class="cat-chip"
      :class="{ active: activeTag === '__all__' }"
      @click="emit('select', '__all__')"
    >
      全部 <span class="cat-count">{{ total }}</span>
    </button>
    <button
      v-for="t in tags"
      :key="t.name"
      class="cat-chip"
      :class="{ active: activeTag === t.name }"
      @click="emit('select', t.name)"
    >
      # {{ t.name }} <span class="cat-count">{{ t.count }}</span>
    </button>
  </nav>
</template>
