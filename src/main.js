import { createApp } from 'vue'
// element-plus 改为按需引入（见 vite.config.js 的 Components + ElementPlus 插件）：
// 不再 import 全量 ElementPlus 与全量 CSS，首屏主包显著变小。
// 函数式组件（ElMessage/ElMessageBox）不走组件解析，这里补其样式。
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChatDotRound,
  Close,
  Cloudy,
  DeleteFilled,
  Download,
  HomeFilled,
  Key,
  Lock,
  Message,
  More,
  Plus,
  Search,
  StarFilled,
  Top,
  Unlock,
  Upload,
  UserFilled
} from '@element-plus/icons-vue'
import App from './App.vue'
import './styles.css'
import { useBridge } from './composables/useBridge.js'

function splashErr(msg) {
  const splash = document.getElementById('boot-splash')
  const tip = splash && splash.querySelector('.bs-tip')
  if (tip) {
    tip.textContent = '启动失败：' + msg + '（请刷新重试）'
    tip.style.color = '#b9701a'
  }
  const bar = splash && splash.querySelector('.bs-bar')
  if (bar) bar.style.display = 'none'
}

try {
  const app = createApp(App)

  // 只注册实际用到的图标：全量注册会把上千个 SVG 组件打进首屏包
  const icons = {
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    ChatDotRound,
    Close,
    Cloudy,
    DeleteFilled,
    Download,
    HomeFilled,
    Key,
    Lock,
    Message,
    More,
    Plus,
    Search,
    StarFilled,
    Top,
    Unlock,
    Upload,
    UserFilled
  }
  for (const [key, component] of Object.entries(icons)) {
    app.component(key, component)
  }

  app.mount('#app')

  // Bridge 适配：把基座注入的安全区写进 CSS 变量留白；本地 h5 模式下与基座握手，
  // 远程站点/浏览器下 useBridge 内部自动降级为 no-op，不会报错。
  const bridge = useBridge()
  bridge.applySafeArea()
  bridge.ready()

  // 首屏占位页已完成使命：Vue 接管后移除，避免遮挡内容
  const bs = document.getElementById('boot-splash')
  if (bs) bs.remove()
} catch (e) {
  console.error('[main] 启动失败', e)
  splashErr(e && e.message ? e.message : String(e))
}
