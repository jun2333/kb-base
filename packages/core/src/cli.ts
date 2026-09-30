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

// 帮助同理：还没 init 的目录里也得能看用法（`kb` / `kb help` / `kb --help`）
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help()
  process.exit(0)
}

const { config, findConfigPath, CONTENT_DIR } = await import('./config/index.js')

// 实例根 = 配置文件所在目录；内容根 = 站点根 = <实例根>/docs（固定，不可配）
const INSTANCE_ROOT = path.dirname(findConfigPath())
const SITE_ROOT = path.resolve(INSTANCE_ROOT, CONTENT_DIR)
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
  chroma:start          启动本实例的向量库容器（端口取配置的 chroma.port）
  chroma:stop           停止并移除本实例的向量库容器（数据保留）
  ollama:pull           按配置拉取本地模型（缺什么拉什么；配的是远程模型会说不用）
  ollama:stop           停止本地模型（模型文件保留）
  import <目录>         把一个目录下的 Markdown 导入 docs/imported/（--dry-run 只预检）
  menu:export           把当前目录结构推导出的菜单/侧边栏导出成 menu.config.mjs
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
    case 'menu:export': {
      const { runMenuExport } = await import('./menu.js')
      const result = await runMenuExport({ force: has('--force'), check: has('--check') })
      const rel = path.relative(INSTANCE_ROOT, result.file)

      if (has('--check')) {
        if (!result.added?.length && !result.removed?.length) {
          console.log(`✅ 配置与目录一致：${rel}`)
        } else {
          console.log(`配置与目录的差异（${rel}）：`)
          for (const l of result.added ?? []) console.log(`  ＋ 目录里有、配置里没有：${l}`)
          for (const l of result.removed ?? []) console.log(`  － 配置里有、目录里没有：${l}`)
        }
        break
      }

      if (result.created) {
        console.log(`✅ 已生成 ${rel}`)
        console.log('   之后站点完全按它渲染（不再按目录自动推导）；删掉该文件就回到全自动。')
      } else {
        console.log(`⚠️  ${rel} 已存在，未覆盖（要重新生成加 --force；只看差异用 --check）`)
      }
      // 这个文件不在 VitePress 的「配置依赖监听清单」里（它由 loadMenu 动态 import），
      // 所以改了它正在跑的 dev 服务不会自己重启 —— 提前说一声，省得以为没生效
      console.log('\n⚠️  改了它之后要**重启 pnpm dev** 才生效（menu.config.mjs 不参与热更新）。')
      break
    }
    case 'chroma:start': {
      const { startChroma } = await import('./chroma.js')
      await startChroma()
      break
    }
    case 'chroma:stop': {
      const { stopChroma } = await import('./chroma.js')
      stopChroma()
      break
    }
    case 'ollama:pull': {
      const { pullModels } = await import('./ollama.js')
      pullModels()
      break
    }
    case 'ollama:stop': {
      const { stopModels } = await import('./ollama.js')
      stopModels()
      break
    }
    case 'index': {
      const { runIndex } = await import('./rag/indexer.js')
      await runIndex({ full: has('--full') })
      break
    }
    case 'import': {
      const { readDir, plan, run } = await import('./import.js')
      const src = rest.find((a) => !a.startsWith('--'))
      if (!src) {
        console.error('用法：kb import <目录> [--dry-run] [--strategy skip|overwrite|rename]')
        process.exit(1)
      }

      const { entries, ignored } = readDir(path.resolve(process.cwd(), src))
      const p = plan(entries)

      console.log(`扫描：${path.resolve(process.cwd(), src)}`)
      console.log(`  待导入 ${p.count} 个 Markdown`)
      if (p.categories.length > 0) {
        console.log('\n  会新增这些分类（顶层目录）：')
        for (const c of p.categories) console.log(`    ${c.name}  ${c.count} 个`)
      }
      if (p.conflicts.length > 0) console.log(`\n  ⚠️  ${p.conflicts.length} 个目标已存在（按 --strategy 处理，默认跳过）`)
      if (p.renamed.length > 0) {
        console.log(`\n  ✏️  ${p.renamed.length} 个文件将被重命名（URL 不友好字符）：`)
        for (const r of p.renamed.slice(0, 10)) console.log(`    ${r.from} → ${r.to}`)
      }
      const ignoredTotal = ignored.length + p.skipped.length
      if (ignoredTotal > 0) console.log(`\n  🚫 忽略 ${ignoredTotal} 项（非 Markdown / 隐藏文件 / index.md）`)

      if (has('--dry-run')) {
        console.log('\n（--dry-run：没有写入任何文件）')
        break
      }

      const strategy = (val('--strategy') ?? 'skip') as 'skip' | 'overwrite' | 'rename'
      const s = run(entries, { strategy })
      console.log(`\n✅ 导入完成：${s.imported.length} 个 → docs/imported/`)
      if (s.skipped.length > 0) console.log(`   跳过 ${s.skipped.length} 个`)
      if (s.failed.length > 0) {
        console.log(`   失败 ${s.failed.length} 个：`)
        for (const f of s.failed.slice(0, 10)) console.log(`     ${f.path}（${f.error}）`)
      }
      console.log('\n下一步：pnpm kb index          # 建立索引，AI 才能搜到')
      console.log('         pnpm dev               # 打开站点，在「管理」里把内容归档到分类')
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
