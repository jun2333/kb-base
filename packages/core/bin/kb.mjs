#!/usr/bin/env node
// 发布形态：直接跑 tsc 产物（dist/）。
// 发布包只带 dist + templates，不带 src —— 所以改了 packages/core/src/** 之后
// 必须在 packages/core 里 `pnpm build`，否则跑的还是上一次编译的结果。
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/cli.js')

if (!existsSync(dist)) {
  console.error(
    `未找到构建产物：${dist}\n` +
      '  在基座仓库里先跑一次：cd packages/core && pnpm build',
  )
  process.exit(1)
}

await import(dist)
