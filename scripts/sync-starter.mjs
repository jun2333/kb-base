#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 把「快速上手」文章从基座（packages/site/templates，唯一来源）同步到某个实例的内容目录。
//
// 用法：
//   node scripts/sync-starter.mjs [实例目录]      # 省略则用当前目录
// 例：
//   pnpm sync:starter ../my-kb

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_ROOT = path.resolve(__dirname, '..')
const SRC = path.join(BASE_ROOT, 'packages/site/templates/getting-started/index.md')

const instanceDir = path.resolve(process.argv[2] ?? process.cwd())
const configPath = path.join(instanceDir, 'knowledge.config.mjs')

if (!fs.existsSync(SRC)) {
  console.error(`❌ 未找到来源：${SRC}`)
  process.exit(1)
}
if (!fs.existsSync(configPath)) {
  console.error(`❌ 目标不是知识库实例（缺 knowledge.config.mjs）：${instanceDir}`)
  process.exit(1)
}

const cfg = (await import(pathToFileURL(configPath).href)).default ?? {}
const contentRoot = path.resolve(instanceDir, cfg.contentRoot ?? './docs')

const destDir = path.join(contentRoot, 'getting-started')
const dest = path.join(destDir, 'index.md')

const next = fs.readFileSync(SRC, 'utf-8')
const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf-8') : null

if (current === next) {
  console.log(`✓ 已是最新（${path.relative(instanceDir, dest)}）`)
} else {
  fs.mkdirSync(destDir, { recursive: true })
  fs.writeFileSync(dest, next)
  console.log(`✓ 已同步 ${path.relative(instanceDir, dest)}`)
}
