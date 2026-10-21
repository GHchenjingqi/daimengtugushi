#!/usr/bin/env node
/**
 * 用基座唯一真源 api.js 覆盖本工程的 Bridge 中间件产物。
 * 用法：node scripts/inject-api.js <相对本工程的目录，如 dist 或 public>
 * 基座位置默认 D:/codes/RNbase，可用环境变量 BASE_DIR 覆盖。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target) {
  console.error('[inject-api] 用法: node scripts/inject-api.js <相对本工程的目录，如 dist>')
  process.exit(1)
}

const baseRoot = process.env.BASE_DIR || 'D:/codes/RNbase'
const baseScript = path.join(baseRoot, 'scripts', 'inject-h5-api.js')
if (!fs.existsSync(baseScript)) {
  console.error(`[inject-api] 未找到基座注入脚本：${baseScript}`)
  console.error('[inject-api] 请用 BASE_DIR 指定基座路径')
  process.exit(1)
}

const r = spawnSync(process.execPath, [baseScript, path.resolve(projectRoot, target)], {
  stdio: 'inherit',
})
process.exit(r.status === null ? 1 : r.status)
