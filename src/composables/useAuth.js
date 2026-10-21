// 用户登录态：微信网站登录（OAuth 中继）+ 会话管理。
// 仅 web 应用使用：signInWithOAuth 获取跳转地址，handleWechatWebCallback 处理回调。
import { ref, computed } from 'vue'
import { cloud } from '../cloud.js'

const user = ref(null)
const session = ref(null)
const initializing = ref(true)
const profileName = ref('') // 云端 profiles 表里的自定义昵称，优先于账号默认名
let started = false

async function init() {
  if (started) return
  started = true
  try {
    // 1) 处理微信回调（必须在任何路由守卫之前、且需在首页根路径运行）
    const { data: cbSession } = await cloud.auth.handleWechatWebCallback()
    if (cbSession) {
      // 关键：登录成功后清除地址栏的 code/state，避免刷新重放失效 code
      history.replaceState(null, '', location.pathname)
    }
  } catch (e) {
    // 回调无 code 时会走到这里也无妨，继续正常启动
    console.warn('wechat callback handle skipped', e)
  }
  // 2) 读取当前会话
  try {
    const { data } = await cloud.auth.getSession()
    session.value = data || null
    user.value = data?.user || null
  } catch (e) {
    console.warn('getSession failed', e)
  }
  initializing.value = false
  // 3) 监听登录态变化（登录后拉取云端昵称，退出时清空）
  cloud.auth.onAuthStateChange((_event, s) => {
    session.value = s || null
    user.value = s?.user || null
    if (user.value) loadProfile()
    else profileName.value = ''
  })
  // 初次启动时已有会话也拉一次
  if (user.value) loadProfile()
}

const isLoggedIn = computed(() => !!user.value)

async function loginWithWechat() {
  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: 'wechat',
    redirectTo: location.origin
  })
  if (error) {
    return { ok: false, error: error.message || '微信登录发起失败' }
  }
  if (data && data.url) {
    location.assign(data.url)
    return { ok: true }
  }
  return { ok: false, error: '未获取到微信登录地址' }
}

async function logout() {
  const { error } = await cloud.auth.signOut()
  if (error) return { ok: false, error: error.message }
  user.value = null
  session.value = null
  profileName.value = ''
  return { ok: true }
}

// ---- 邮箱 + 密码：注册/登录/找回，全程免短信 ----
let pendingOtp = null        // 注册/登录验证码挑战
let pendingReset = null      // 找回密码挑战

// 发送邮箱验证码（注册或登录用）。isExistingUser 由上游给出，用于引导用户走登录还是注册
async function sendEmailCode(email) {
  const { data, error } = await cloud.auth.sendOtp({ email })
  if (error) return { ok: false, error: error.message || '验证码发送失败' }
  pendingOtp = {
    email,
    verificationId: data.verificationId,
    isExistingUser: data.isExistingUser
  }
  return { ok: true, isExistingUser: data.isExistingUser }
}

// 邮箱注册：用验证码 + 设置密码，建立带密码的账号并自动登录
async function signUpWithEmail(email, code, password) {
  if (!pendingOtp || pendingOtp.email !== email) {
    return { ok: false, error: '请先获取验证码' }
  }
  const { data, error } = await cloud.auth.verifyOtp({
    email,
    verificationId: pendingOtp.verificationId,
    isExistingUser: pendingOtp.isExistingUser,
    token: code,
    password
  })
  if (error) return { ok: false, error: error.message || '注册失败' }
  pendingOtp = null
  return { ok: true }
}

// 邮箱 + 密码登录（已设置过密码的账号）
async function signInWithEmailPassword(email, password) {
  const { data, error } = await cloud.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, error: error.message || '账号或密码错误' }
  return { ok: true }
}

// 找回密码：发送重置邮件（含验证码），由平台投递，不发短信
async function resetPassword(email) {
  const { data, error } = await cloud.auth.resetPasswordForEmail(email)
  if (error) return { ok: false, error: error.message || '重置邮件发送失败' }
  pendingReset = data // 含 updateUser({ nonce, password })
  return { ok: true }
}

// 用邮件里的验证码 + 新密码完成重置
async function updatePassword(nonce, password) {
  if (!pendingReset) return { ok: false, error: '请先获取重置验证码' }
  const { data, error } = await pendingReset.updateUser({ nonce, password })
  if (error) return { ok: false, error: error.message || '重置失败' }
  pendingReset = null
  return { ok: true }
}

// 显示名：自定义昵称 > 微信昵称 > 邮箱 > 默认
function displayName() {
  if (profileName.value) return profileName.value
  const u = user.value
  if (!u) return ''
  return u.name || u.nickname || u.user_metadata?.name || u.email || '小诗友'
}

// 读取云端昵称（profiles 表，owner-only）
async function loadProfile() {
  if (!user.value) {
    profileName.value = ''
    return
  }
  try {
    const { data, error } = await cloud.database.from('profiles').select('name').limit(1)
    if (!error && data && data.length) profileName.value = data[0].name || ''
  } catch (e) {
    console.warn('loadProfile failed', e)
  }
}

// 保存昵称：有记录则更新，无记录则插入（owner_id 由服务端默认填充）
async function saveName(name) {
  const trimmed = String(name || '').trim().slice(0, 20)
  if (!trimmed) return { ok: false, error: '昵称不能为空' }
  if (!user.value) return { ok: false, error: '请先登录' }
  try {
    const { data: rows } = await cloud.database.from('profiles').select('owner_id').limit(1)
    if (rows && rows.length) {
      const { error } = await cloud.database
        .from('profiles')
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq('owner_id', user.value.id)
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await cloud.database.from('profiles').insert({ name: trimmed })
      if (error) return { ok: false, error: error.message }
    }
    profileName.value = trimmed
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '保存失败' }
  }
}

export function useAuth() {
  return {
    user,
    session,
    initializing,
    isLoggedIn,
    init,
    loginWithWechat,
    logout,
    displayName,
    loadProfile,
    saveName,
    sendEmailCode,
    signUpWithEmail,
    signInWithEmailPassword,
    resetPassword,
    updatePassword
  }
}
