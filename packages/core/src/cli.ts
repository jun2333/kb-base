#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const argv = process.argv.slice(2)
const cmd = argv[0]
const rest = argv.slice(1)

// init 是「还没有实例」时要跑的命令，必须在加载实例配置之前处理：
// config 在 import 时就会去找 knowledge.config.mjs，找不到直接抛错。
if (cmd === 'init') {
  const { runInit } = await import('./init.js')
  await runInit(rest)
  process.exit(0)
}

const { config, findConfigPath } = await import('./config/index.js')

// 实例根 = 配置文件所在目录；站点根由配置的 site.dir 决定
const INSTANCE_ROOT = path.dirname(findConfigPath())
const SITE_ROOT = path.resolve(INSTANCE_ROOT, config.site.dir)
const has = (flag: string) => rest.includes(flag)
const val = (flag: string) => {
  const i = rest.indexOf(flag)
  return i >= 0 ? rest[i + 1] : undefined
}

/** 从实例依赖里解析某个包的 bin 脚本 */
function pkgBin(pkg: string, binName: string): string {
  const require = createRequire(path.join(INSTANCE_ROOT, 'package.json'))
  const pkgPath = require.resolve(`${pkg}/package.json`)
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const rel = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[binName]
  if (!rel) throw new Error(`${pkg} 未提供 bin: ${binName}`)
  return path.join(path.dirname(pkgPath), rel)
}

/** 子进程执行（继承 stdio，cwd 固定为实例根，Ctrl+C 透传） */
function spawnProc(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: 'inherit', cwd: INSTANCE_ROOT, env: process.env })
    const onSigint = () => child.kill('SIGINT')
    process.on('SIGINT', onSigint)
    child.on('exit', (code) => {
      process.off('SIGINT', onSigint)
      code === 0 ? resolve() : reject(new Error(`子进程退出码 ${code}`))
    })
    child.on('error', reject)
  })
}

/** 调用实例安装的 VitePress */
const vitepress = (sub: string) => spawnProc(pkgBin('vitepress', 'vitepress'), [sub, SITE_ROOT])

function help() {
  console.log(`用法：kb <命令> [选项]

  init <目录>           生成一个知识库实例骨架（--local <基座目录> 指向本地基座）
  index [--full]        建立向量索引（默认增量，--full 全量重建）
  serve                 只启动 API 服务
  dev                   启动 API + 文档站点（开发）
  build                 构建文档站点（生产）
  preview               预览构建产物
  eval [--full]         检索质量评估（--full 追加生成层评估）
  eval:baseline         把当前评估成绩固化为基线
  cases:gen [--limit N] [--concurrency N]   LLM 生成评估题初稿
  cases:review          自动筛出可疑题目
`)
}

async function main() {
  switch (cmd) {
    case 'index': {
      const { runIndex } = await import('./rag/indexer.js')
      await runIndex({ full: has('--full') })
      break
    }
    case 'serve': {
      const { startServer } = await import('./server.js')
      startServer()
      break
    }
    case 'dev': {
      const { startServer } = await import('./server.js')
      startServer()
      await vitepress('dev')
      process.exit(0)
    }
    case 'build':
      await vitepress('build')
      break
    case 'preview':
      await vitepress('preview')
      break
    case 'eval': {
      const retrieval = await import('./eval/rag-eval.js')
      await retrieval.default()
      if (has('--full')) {
        const generation = await import('./eval/rag-gen-eval.js')
        await generation.default()
      }
      break
    }
    case 'eval:baseline':
      await import('./eval/eval-baseline.js')
      break
    case 'cases:gen': {
      const { default: genCases } = await import('./eval/gen-eval-cases.js')
      await genCases({ limit: Number(val('--limit')) || 0, concurrency: Number(val('--concurrency')) || 4 })
      break
    }
    case 'cases:review': {
      const { default: reviewCases } = await import('./eval/review-eval-cases.js')
      await reviewCases()
      break
    }
    default:
      help()
      process.exit(cmd ? 1 : 0)
  }
}

main().catch((err) => {
  console.error(`kb ${cmd} 失败：${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
