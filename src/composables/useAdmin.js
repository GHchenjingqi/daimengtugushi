import { ref } from 'vue'
import { ADMIN_PASSPHRASE } from '../config.js'

const STORAGE_KEY = 'gushici_admin_session'

// 模块级单例：跨组件共享同一份超管状态
const isAdmin = ref(localStorage.getItem(STORAGE_KEY) === '1')
const showLogin = ref(false)
const passInput = ref('')
const errorMsg = ref('')

function openLogin() {
  showLogin.value = true
  passInput.value = ''
  errorMsg.value = ''
}

function login() {
  if (passInput.value === ADMIN_PASSPHRASE) {
    isAdmin.value = true
    localStorage.setItem(STORAGE_KEY, '1')
    showLogin.value = false
    errorMsg.value = ''
  } else {
    errorMsg.value = '口令错误，请重试'
  }
}

function logout() {
  isAdmin.value = false
  localStorage.removeItem(STORAGE_KEY)
}

export function useAdmin() {
  return { isAdmin, showLogin, passInput, errorMsg, openLogin, login, logout }
}
