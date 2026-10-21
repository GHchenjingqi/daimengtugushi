#!/usr/bin/env node
/**
 * 将本工程 dist 同步为 RN 基座的 h5 代码目录（产物目录）。
 * 用法：node scripts/sync-to-base.js
 * 基座位置默认 D:/codes/RNbase，可用环境变量 BASE_H5 覆盖目标目录。
 *
 * 注意：远程站点模式（app.config.json 的 remoteUrl 非空）下通常不需要本脚本；
 * 本脚本用于「本地 h5 模式」打包——把产物拷进基座 h5/ 随 APK 发布。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const defaultBase = 'D:/codes/RNbase/h5'
const baseH5 = process.env.BASE_H5 || defaultBase
const distDir = path.join(projectRoot, 'dist')

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`[sync] 未找到 dist 目录：${distDir}`)
    console.error('[sync] 请先执行 npm run build 生成产物')
    process.exit(1)
  }
  const entry = path.join(distDir, 'index.html')
  if (!fs.existsSync(entry)) {
    console.error(`[sync] dist 缺少 index.html（${entry}），不是有效的 H5 产物`)
    process.exit(1)
  }

  console.log(`[sync] 源（dist）    ：${distDir}`)
  console.log(`[sync] 目标（基座 h5）：${baseH5}`)

  // api.js 由基座维护（与 RN Bridge 协议同版本），H5 产物不包含，sync 时需保留基座版本
  const baseApiJs = path.join(baseH5, 'js', 'api.js')
  let preservedApiJs = null
  if (fs.existsSync(baseApiJs)) {
    preservedApiJs = fs.readFileSync(baseApiJs, 'utf8')
    console.log('[sync] 已保留基座 js/api.js（不随 H5 产物覆盖）')
  }

  // 1. 备份旧内容（只保留最近一份，可回退）
  if (fs.existsSync(baseH5)) {
    const backup = `${baseH5}.backup`
    fs.rmSync(backup, { recursive: true, force: true })
    if (fs.readdirSync(baseH5).length > 0) {
      fs.cpSync(baseH5, backup, { recursive: true })
      console.log(`[sync] 旧内容已备份到：${backup}`)
    }
    fs.rmSync(baseH5, { recursive: true, force: true })
  }

  // 2. 复制 dist → 基座 h5
  fs.mkdirSync(baseH5, { recursive: true })
  fs.cpSync(distDir, baseH5, { recursive: true })

  // 2.1 恢复基座 js/api.js（H5 产物不包含 api.js，由基座提供）
  if (preservedApiJs) {
    fs.mkdirSync(path.join(baseH5, 'js'), { recursive: true })
    fs.writeFileSync(baseApiJs, preservedApiJs, 'utf8')
  }

  // 2.2 file:// 加载要求相对路径：把 /js/api.js 转回 ./js/api.js
  const baseEntry = path.join(baseH5, 'index.html')
  if (fs.existsSync(baseEntry)) {
    let baseHtml = fs.readFileSync(baseEntry, 'utf8')
    const rewritten = baseHtml.replace(/src="\/js\/api\.js"/g, 'src="./js/api.js"')
    if (rewritten !== baseHtml) {
      fs.writeFileSync(baseEntry, rewritten, 'utf8')
      console.log('[sync] index.html 已把 /js/api.js 转为相对路径 ./js/api.js')
    }
  }

  // 2.3 IIFE 产物标签规范化：去 module/crossorigin，业务 bundle 加 defer
  if (fs.existsSync(baseEntry)) {
    let baseHtml = fs.readFileSync(baseEntry, 'utf8')
    const orig = baseHtml
    baseHtml = baseHtml.replace(/<script\s+type="module"([^>]*)>/g, (_m, attrs) => {
      const cleaned = attrs.replace(/\s+crossorigin/g, '')
      const srcMatch = cleaned.match(/\ssrc="([^"]+)"/)
      const isApiJs = srcMatch && /api\.js$/.test(srcMatch[1])
      return isApiJs ? `<script${cleaned}>` : `<script${cleaned} defer>`
    })
    baseHtml = baseHtml.replace(/<link\s+([^>]*?)\bcrossorigin\b([^>]*)>/g, (_m, pre, post) => {
      const joined = (pre + ' ' + post).replace(/\s{2,}/g, ' ').trim()
      return `<link ${joined}>`
    })
    if (baseHtml !== orig) {
      fs.writeFileSync(baseEntry, baseHtml, 'utf8')
      console.log('[sync] index.html 已规范化 IIFE 标签（去 module/crossorigin，业务 bundle 加 defer）')
    }
  }

  // 3. 统计
  let files = 0
  let bytes = 0
  ;(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        files += 1
        bytes += fs.statSync(p).size
      }
    }
  })(baseH5)
  console.log(
    `[sync] 完成：${files} 个文件，${(bytes / 1024).toFixed(1)} KB 已同步到基座 h5/`
  )
}

main()
