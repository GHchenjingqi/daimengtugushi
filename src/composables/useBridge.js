/**
 * Bridge 统一入口（H5 ↔ RN 唯一通道）
 *
 * 设计原则（来自 RNbase README / apple-design 规范）：
 *  - H5 只经 window.RN 调原生能力，**禁止**直接触碰 window.ReactNativeWebView；
 *  - 远程站点模式 / 普通浏览器下 window.RN 不存在 → 全部能力 mock 降级，
 *    业务代码永远不报错、不阻断；
 *  - 本地 h5 模式下 window.RN_SAFE_AREA 由基座注入，H5 据此自行留白。
 *
 * 用法：
 *  const bridge = useBridge()
 *  bridge.vibrate(10)                       // 收藏/朗读的轻触反馈
 *  await bridge.setStatusBarStyle('dark')    // 详情页深底时改状态栏深浅
 *  if (bridge.isNative) { ... }             // 是否需要原生专属逻辑
 */

// 基座注入的安全区（本地 h5 模式有效；远程/浏览器为 undefined）
const RN = typeof window !== 'undefined' ? window.RN : null
const SAFE_AREA = typeof window !== 'undefined' ? window.RN_SAFE_AREA : undefined

let warned = false

function guard(method) {
  if (!RN) {
    if (!warned) {
      warned = true
      console.info(
        '[bridge] window.RN 不可用（远程站点 / 浏览器预览）：所有原生能力已降级为 no-op。'
      )
    }
    return false
  }
  if (typeof RN[method] !== 'function') return false
  return true
}

function safeCall(method, ...args) {
  if (!guard(method)) return undefined
  try {
    return RN[method](...args)
  } catch (e) {
    console.warn('[bridge] 调用失败：', method, e)
    return undefined
  }
}

export function useBridge() {
  return {
    /** 是否运行在 RN 原生容器（拿到真实 Bridge） */
    isNative: !!RN,

    /** 基座注入的安全区，结构 { top, bottom, left, right }（px） */
    safeArea: SAFE_AREA || null,

    /**
     * 把基座安全区写进 CSS 变量，供布局留白。
     * 远程模式基座已自动注入 <style> 补 padding，本函数不冲突（幂等）。
     */
    applySafeArea() {
      if (typeof document === 'undefined') return
      const root = document.documentElement.style
      const top = SAFE_AREA?.top ?? 0
      const bottom = SAFE_AREA?.bottom ?? 0
      if (top) root.setProperty('--status-h', `${top}px`)
      if (bottom) root.setProperty('--bottom-h', `${bottom}px`)
    },

    /** 轻触反馈：收藏/朗读等可感知交互（Android 下 10ms 短振） */
    vibrate(ms = 10) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(ms)
        } catch {
          /* 不支持则忽略 */
        }
      }
      safeCall('VIBRATE', ms)
    },

    /** 设置状态栏文字深浅：'default' | 'light-content' | 'dark-content' */
    setStatusBarStyle(style = 'dark-content') {
      return safeCall('SET_STATUS_BAR_STYLE', style)
    },

    /** 设置状态栏背景色（hex，含 #） */
    setStatusBarColor(color = '#FFFFFF') {
      return safeCall('SET_STATUS_BAR_COLOR', color)
    },

    /** 调起系统分享（文本/链接/图片） */
    share(payload = {}) {
      return safeCall('SHARE', payload)
    },

    /** 复制文本到系统剪贴板 */
    copy(text = '') {
      return safeCall('COPY', String(text))
    },

    /** 通知 RN 应用已就绪（本地 h5 模式下与基座握手，避免加载残留） */
    ready() {
      return safeCall('READY')
    },

    /**
     * 通用能力调用（兜底）：RN.<MODULE>.<METHOD>(...args)
     * 例如 bridge.invoke('APP', 'GETINFO')。
     */
    invoke(module, method, ...args) {
      const mod = RN && RN[module]
      if (!mod || typeof mod[method] !== 'function') return undefined
      try {
        return mod[method](...args)
      } catch (e) {
        console.warn('[bridge] 调用失败：', module, method, e)
        return undefined
      }
    }
  }
}
