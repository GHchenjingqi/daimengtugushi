<script setup>
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuth } from '../composables/useAuth.js'

const {
  loginWithWechat,
  sendEmailCode,
  signUpWithEmail,
  signInWithEmailPassword,
  resetPassword,
  updatePassword
} = useAuth()

const mode = ref('login') // login | register | reset
const email = ref('')
const password = ref('')
const code = ref('')

const sending = ref(false)
const submitting = ref(false)
const countdown = ref(0)
let timer = null

const error = ref('')
const existingHint = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validEmail() {
  if (!EMAIL_RE.test(email.value.trim())) {
    error.value = '请输入正确的邮箱地址'
    return false
  }
  return true
}

function startCountdown() {
  countdown.value = 60
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function sendCode() {
  error.value = ''
  existingHint.value = false
  if (!validEmail()) return
  sending.value = true
  const res = await sendEmailCode(email.value.trim())
  sending.value = false
  if (!res.ok) {
    error.value = res.error
    return
  }
  ElMessage.success('验证码已发送到你的邮箱')
  startCountdown()
  // 注册模式下若邮箱已存在，引导用户去登录
  if (mode.value === 'register' && res.isExistingUser) {
    existingHint.value = true
  }
}

async function submit() {
  error.value = ''
  if (!validEmail()) return
  if (mode.value !== 'reset' && password.value.length < 6) {
    error.value = '密码至少 6 位'
    return
  }

  submitting.value = true
  let res
  if (mode.value === 'login') {
    res = await signInWithEmailPassword(email.value.trim(), password.value)
  } else if (mode.value === 'register') {
    if (!code.value.trim()) {
      submitting.value = false
      error.value = '请输入邮箱验证码'
      return
    }
    res = await signUpWithEmail(email.value.trim(), code.value.trim(), password.value)
  } else {
    // reset
    if (!code.value.trim()) {
      submitting.value = false
      error.value = '请输入邮件中的验证码'
      return
    }
    res = await updatePassword(code.value.trim(), password.value)
  }
  submitting.value = false

  if (!res.ok) {
    error.value = res.error
    return
  }
  if (mode.value === 'reset') {
    ElMessage.success('密码已重置，请用新密码登录')
    mode.value = 'login'
    code.value = ''
    password.value = ''
  } else {
    ElMessage.success('登录成功')
  }
}

async function wechatLogin() {
  const res = await loginWithWechat()
  if (!res.ok) ElMessage.error(res.error || '微信登录失败')
}

function switchMode(m) {
  mode.value = m
  error.value = ''
  existingHint.value = false
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="login-panel">
    <!-- 模式切换 -->
    <div class="lp-tabs">
      <button
        class="lp-tab"
        :class="{ active: mode === 'login' }"
        type="button"
        @click="switchMode('login')"
      >登录</button>
      <button
        class="lp-tab"
        :class="{ active: mode === 'register' }"
        type="button"
        @click="switchMode('register')"
      >注册</button>
    </div>

    <!-- 邮箱 -->
    <div class="lp-field">
      <el-input
        v-model="email"
        class="lp-input"
        type="email"
        placeholder="邮箱"
        @input="error = ''"
      >
        <template #prefix><el-icon><Message /></el-icon></template>
      </el-input>
    </div>

    <!-- 密码（登录/注册/重置都用到） -->
    <div class="lp-field">
      <el-input
        v-model="password"
        class="lp-input"
        type="password"
        show-password
        :placeholder="mode === 'reset' ? '设置新密码（至少 6 位）' : '密码（至少 6 位）'"
        @input="error = ''"
      >
        <template #prefix><el-icon><Lock /></el-icon></template>
      </el-input>
    </div>

    <!-- 验证码（注册/重置） -->
    <div v-if="mode !== 'login'" class="lp-field lp-code-row">
      <el-input
        v-model="code"
        class="lp-input"
        placeholder="邮箱验证码"
        @input="error = ''"
      >
        <template #prefix><el-icon><Key /></el-icon></template>
      </el-input>
      <button
        class="lp-code-btn"
        type="button"
        :disabled="sending || countdown > 0"
        @click="sendCode"
      >
        {{ countdown > 0 ? countdown + 's' : (sending ? '发送中…' : '获取验证码') }}
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="lp-error">{{ error }}</div>
    <div v-if="existingHint" class="lp-hint">
      该邮箱已注册，请切换到「登录」用密码进入
    </div>

    <!-- 主按钮 -->
    <button
      class="kid-btn-primary lp-submit"
      type="button"
      :disabled="submitting"
      @click="submit"
    >
      {{ submitting ? '处理中…' : (mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '重置密码') }}
    </button>

    <!-- 找回密码 -->
    <div v-if="mode === 'login'" class="lp-foot">
      <button class="lp-link" type="button" @click="switchMode('reset')">忘记密码？</button>
    </div>
    <div v-else class="lp-foot">
      <button class="lp-link" type="button" @click="switchMode('login')">
        {{ mode === 'reset' ? '想起密码了？去登录' : '已有账号？去登录' }}
      </button>
    </div>

    <!-- 微信登录（桌面浏览器可用；APK 内走扫码） -->
    <button class="kid-btn-outline lp-wechat" type="button" @click="wechatLogin">
      <el-icon><ChatDotRound /></el-icon>
      微信登录
    </button>
  </div>
</template>

<style scoped>
.login-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 320px;
  margin: 4px auto 0;
}

.lp-tabs {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.lp-tab {
  flex: 1;
  padding: 8px 0;
  border: 1px solid var(--accent-soft);
  background: #fff;
  color: var(--accent);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.lp-tab.active {
  background: linear-gradient(135deg, #7ab8f9 0%, #4a9df6 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 12px rgba(74, 157, 246, 0.28);
}

.lp-field :deep(.el-input__wrapper) {
  border-radius: 14px;
  background: #f7fbff;
  box-shadow: 0 0 0 1px rgba(122, 184, 249, 0.25) inset;
}
.lp-field :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1.5px var(--accent) inset;
}

.lp-code-row {
  display: flex;
  gap: 8px;
}
.lp-code-row .lp-input {
  flex: 1;
}
.lp-code-btn {
  flex: 0 0 auto;
  padding: 0 14px;
  border: 1px solid var(--accent-soft);
  background: #fff;
  color: var(--accent);
  border-radius: 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s ease;
}
.lp-code-btn:hover:not(:disabled) {
  background: var(--accent-tint);
}
.lp-code-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.lp-error {
  color: #e74c3c;
  font-size: 13px;
  text-align: center;
}
.lp-hint {
  color: var(--accent);
  font-size: 12.5px;
  text-align: center;
  background: var(--accent-tint);
  padding: 6px 10px;
  border-radius: 10px;
}

.lp-submit {
  width: 100%;
  padding: 12px 0;
  font-size: 16px;
}

.lp-foot {
  text-align: center;
}
.lp-link {
  background: none;
  border: none;
  color: var(--text-soft);
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.lp-link:hover {
  color: var(--accent);
}

.lp-wechat {
  width: 100%;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
</style>
