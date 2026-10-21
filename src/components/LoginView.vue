<script setup>
import { ref } from 'vue'
import LoginPanel from './LoginPanel.vue'
import { IconBookFilled } from './Icons.js'

defineProps({
  title: { type: String, default: '登录后就能记录你的学习足迹啦' }
})

const showForm = ref(false)
</script>

<template>
  <div class="login-view">
    <!-- 登录卡片 -->
    <div class="login-card kid-card">
      <div class="login-icon">
        <el-icon><IconBookFilled /></el-icon>
      </div>
      <h2 class="login-title">{{ title }}</h2>

      <!-- 第一步：轻量提示，点击后才展开表单 -->
      <template v-if="!showForm">
        <button class="login-btn-primary" type="button" @click="showForm = true">登 录</button>
        <p class="login-tip">登录即表示同意在本应用内保存你的收藏与学习数据</p>
      </template>

      <!-- 第二步：完整登录/注册/重置表单 -->
      <template v-else>
        <LoginPanel />
        <button class="login-btn-text" type="button" @click="showForm = false">返回</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 8px;
  padding-bottom: 24px;
}

.login-card {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 420px;
  padding: 28px 22px 32px;
  text-align: center;
  background: rgba(255, 255, 255, 0.96);
}

.login-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(135deg, #7ab8f9 0%, #4a9df6 100%);
  color: #fff;
  font-size: 28px;
  box-shadow: 0 8px 20px rgba(74, 157, 246, 0.28);
}

.login-title {
  margin: 0 0 22px;
  font-size: var(--fs-subhead);
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}

.login-btn-primary {
  width: 100%;
  max-width: 280px;
  padding: 12px 0;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #7ab8f9 0%, #4a9df6 100%);
  color: #fff;
  font-size: var(--fs-body);
  font-weight: 600;
  letter-spacing: 2px;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(74, 157, 246, 0.32);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.login-btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(74, 157, 246, 0.38);
}

.login-btn-text {
  margin-top: 14px;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-soft);
  font-size: var(--fs-caption);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.login-btn-text:hover {
  color: var(--accent-text);
}

.login-tip {
  margin: 16px 0 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.5;
}

@media (min-width: 768px) {
  .login-card {
    padding: 34px 26px 38px;
  }
}
</style>
