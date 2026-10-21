import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import ElementPlus from 'unplugin-element-plus/vite'

export default defineConfig({
  plugins: [
    vue(),
    // element-plus 按需引入：只打包实际用到的组件及其样式，
    // 避免全量引入把大量组件塞进首屏主包（首屏 JS 显著下降）
    Components({ resolvers: [ElementPlusResolver()] }),
    ElementPlus()
  ],
  build: {
    // 把稳定的大依赖拆成独立 chunk，便于浏览器 / WebView 长期缓存，二次启动更快
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue'],
          pinyin: ['pinyin-pro']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    strictPort: true,
    allowedHosts: true
  }
})
