<script setup>
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { cloud } from '../cloud.js'
import { useUserStore } from '../composables/useUserStore.js'
import { useAuth } from '../composables/useAuth.js'
import { normalizePoem } from '../composables/usePoems.js'
import PoemCard from './PoemCard.vue'
import LoginView from './LoginView.vue'

const emit = defineEmits(['open'])
const { favList, loadFavorites, isFavorite, toggleFavorite, loadingFav } = useUserStore()
const { isLoggedIn } = useAuth()
const poems = ref([])

async function buildPoems() {
  const ids = favList.value.map((r) => r.poem_id)
  if (!ids.length) {
    poems.value = []
    return
  }
  const { data, error } = await cloud.database.from('poems').select('*').in('id', ids)
  if (error) {
    ElMessage.error('收藏加载失败')
    return
  }
  const byId = {}
  for (const row of data || []) byId[row.id] = normalizePoem(row)
  poems.value = favList.value.map((r) => byId[r.poem_id]).filter(Boolean)
}

async function refresh() {
  await loadFavorites()
  await buildPoems()
}

onMounted(refresh)
watch(isLoggedIn, (v) => {
  if (v) refresh()
})

async function onToggleFav(poem) {
  const res = await toggleFavorite(poem.id)
  if (res.needLogin) {
    ElMessage.info('请先登录后再收藏')
    return
  }
  if (res.ok) {
    ElMessage.success(res.favorited ? '已收藏' : '已取消收藏')
    await buildPoems()
  } else if (res.error) {
    ElMessage.error(res.error)
  }
}
</script>

<template>
  <div class="sub-view">
    <div class="sub-hero sub-hero--fav"></div>

    <LoginView v-if="!isLoggedIn" title="登录后就能看到你收藏的诗词啦" />

    <div v-else-if="loadingFav && !poems.length" class="loading-wrap">加载中…</div>
    <div v-else-if="!poems.length" class="empty-tip kid-empty">
      <div class="empty-icon"><el-icon><StarFilled /></el-icon></div>
      <p>还没有收藏的诗词哦</p>
      <p class="empty-sub">在诗词卡片或详情页点亮星标，就能收藏啦</p>
    </div>

    <div v-else class="poem-grid">
      <PoemCard
        v-for="p in poems"
        :key="p.id"
        :poem="p"
        :favorited="isFavorite(p.id)"
        @open="emit('open', $event)"
        @toggle-favorite="onToggleFav"
      />
    </div>
  </div>
</template>
