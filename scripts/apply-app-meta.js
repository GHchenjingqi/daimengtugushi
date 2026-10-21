#!/usr/bin/env node
/**
 * 入口薄壳：委托调用基座唯一实现 scripts/apply-app-meta.js。
 * 用法：node scripts/apply-app-meta.js
 * 基座位置默认 D:/codes/RNbase，可用环境变量 BASE_DIR 覆盖。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseScript = path.resolve(
  process.env.BASE_DIR || 'D:/codes/RNbase',
  'scripts',
  'apply-app-meta.js'
)

if (!fs.existsSync(baseScript)) {
  console.error(`[app-meta] 未找到基座下发脚本：${baseScript}`)
  console.error('[app-meta] 请用 BASE_DIR 指定基座路径')
  process.exit(1)
}

const r = spawnSync(process.execPath, [baseScript, '--app', projectRoot], {
  stdio: 'inherit',
})
process.exit(r.status === null ? 1 : r.status)
