import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import { spawnSync } from 'node:child_process'

// kb init —— 从骨架生成一个全新的知识库实例（唯一的对外路径）。
//
// 用法：
//   kb init <目录> [--name 名称] [--collection 集合名] [--port 3000]
//                [--local <基座目录>] [--yes] [--force] [--install]
//
// 生成的依赖默认写**版本号**（直接读 @kb/core / @kb/site 自己的版本）；
// 基座还没发布到 npm 时用 --local <基座目录>，改成指向本地基座的依赖。

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(__dirname, '../templates/instance')

/** @kb/core 自己的版本（读自身 package.json） */
const CORE_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
).version

/**
 * @kb/site 与 @kb/core 是两个互相独立的包，装谁就能解析谁 ——
 * 所以只能从「当前项目」（也就是你跑 kb init 的地方）解析，解析不到就拿 core 的版本兜底。
 */
function resolveSite(): { dir: string; version: string } | null {
  try {
    const require = createRequire(path.join(process.cwd(), 'package.json'))
    const pkgPath = require.resolve('@kb/site/package.json')
    return {
      dir: path.dirname(pkgPath),
      version: JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version as string,
    }
  } catch {
    return null
  }
}

type InitArgs = { _: string[]; [k: string]: string | boolean | string[] }

function parseArgs(argv: string[]): InitArgs {
  const out: InitArgs = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes' || a === '-y') out.yes = true
    else if (a === '--install') out.install = true
    else if (a === '--force') out.force = true
    else if (a === '--name') out.name = argv[++i]
    else if (a === '--collection') out.collection = argv[++i]
    else if (a === '--content-root') out.contentRoot = argv[++i]
    else if (a === '--port') out.port = argv[++i]
    else if (a === '--local') out.local = argv[++i]
    else out._.push(a)
  }
  return out
}

const sanitize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'knowledge_base'

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)

/** 依赖写法：--local 时指向本地基座，否则写版本号 */
function buildDeps(local: string | undefined, siteVersion: string) {
  if (!local) {
    return { '@kb/core': `^${CORE_VERSION}`, '@kb/site': `^${siteVersion}` }
  }
  const base = path.resolve(process.cwd(), local)
  if (!fs.existsSync(path.join(base, 'packages/core'))) {
    throw new Error(`--local 指向的目录里没有 packages/core：${base}`)
  }
  return {
    '@kb/core': `link:${path.join(base, 'packages/core')}`,
    '@kb/site': `link:${path.join(base, 'packages/site')}`,
  }
}

function instancePackageJson(name: string, local: string | undefined, siteVersion: string) {
  return {
    name,
    private: true,
    type: 'module',
    scripts: {
      dev: 'kb dev',
      build: 'kb build',
      preview: 'kb preview',
      'test:rag': 'kb eval',
      'test:rag:full': 'kb eval --full',
      'test:rag:baseline': 'kb eval:baseline',
      'chroma:start':
        'docker run -d -p 8000:8000 --name chroma -v ./data/chroma:/data chromadb/chroma:latest',
      'chroma:stop': 'docker stop chroma && docker rm chroma',
      'ollama:pull-chat': 'ollama pull qwen3:8b',
      'ollama:pull-embed': 'ollama pull bge-m3',
      'ollama:stop': 'ollama stop qwen3:8b && ollama stop bge-m3:latest',
    },
    dependencies: buildDeps(local, siteVersion),
    devDependencies: {
      vitepress: '^1.6.4',
      vue: '^3.5.0',
    },
  }
}

function writeConfig(target: string, o: Record<string, string>) {
  fs.writeFileSync(
    path.join(target, 'knowledge.config.mjs'),
    `// 知识库实例配置（唯一入口）。
// 类型提示来自基座包 @kb/core。
/** @type {import('@kb/core/types').KnowledgeConfig} */
export default {
  name: ${JSON.stringify(o.name)},

  // 内容根目录：相对本文件，或绝对路径（可指向仓库外，笔记不必搬进来）
  contentRoot: ${JSON.stringify(o.contentRoot)},

  // 索引范围（glob）
  index: {
    include: ['**/*.md'],
    // index.md / getting-started 是站点的元信息（首页与上手文），不算知识正文
    exclude: ['node_modules/**', '.vitepress/**', 'index.md', 'getting-started/**'],
  },

  dataDir: './data',
  evalDir: './eval',
  collectionName: ${JSON.stringify(o.collection)},

  // 模型：默认本地 Ollama；也可指向任意 OpenAI 兼容的远程服务（Key 从环境变量读）
  models: {
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    chat: 'qwen3:8b',
    embedding: 'bge-m3',
    // 远程示例：
    // chat: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    // embedding: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', apiKeyEnv: 'SILICONFLOW_API_KEY' },
  },

  chunk: { size: 1000, overlap: 200 },
  rerank: { enabled: false, candidates: 20 },

  // 检索策略：混合检索（向量 + BM25 关键词），默认开启。
  // 纯向量在精确词（英文缩写 / 专有名词 / 代码标识符）上最弱，BM25 正好互补。
  retrieval: {
    hybrid: { enabled: true, candidates: 50, vectorWeight: 0.7, bm25Weight: 0.3 },
  },

  // 向量库：默认本地 Chroma；远程 / 云给 url + tokenEnv
  chroma: {
    host: 'localhost',
    port: 8000,
    // 远程示例：url: 'https://xxx.chromadb.cloud', tokenEnv: 'CHROMA_TOKEN', tenant: 'xxx', database: 'xxx'
  },
  port: ${o.port},
  envFile: './.env',

  // 目录名 → 分类显示名（评估统计用）；留空则按目录名原样
  categories: {},

  // 站点（docs/.vitepress 消费）
  site: {
    dir: './docs',
    title: ${JSON.stringify(o.name)},
    description: '基于本地大模型的 RAG 知识库',
    // 无手写 sidebar 时按内容目录自动生成
    autoSidebar: true,
    // 顶部导航：也是「仅本地」的唯一来源 —— 带 onlyLocal 的项线上隐藏，
    // 且其路径会被排除出编译 / sidebar / 死链检查（目录或文件自动识别）。
    // nav: [
    //   { text: '首页', link: '/' },
    //   { text: '分组', items: [{ text: 'A', link: '/a/' }, { text: 'B', link: '/b/' }] },
    //   { text: '私人笔记', link: '/private/x', onlyLocal: 'private' },
    // ],
  },
}
`,
  )
}

function writeHome(target: string, o: Record<string, string>) {
  fs.mkdirSync(path.join(target, o.contentRoot), { recursive: true })
  fs.writeFileSync(
    path.join(target, o.contentRoot, 'index.md'),
    `---
layout: home

hero:
  name: ${o.name}
  text: 本地知识库 + AI 问答
  tagline: 把你的 Markdown 笔记变成可浏览、可搜索、可对话的网站
  actions:
    - theme: brand
      text: 快速上手
      link: /getting-started/
    - theme: alt
      text: 示例文档
      link: /example/hello
---

## 三步跑起来

\`\`\`bash
pnpm install          # 1. 装依赖
pnpm chroma:start     # 2. 启动向量库（需 Docker；用本地模型前先 ollama pull）
pnpm kb index         # 3. 建立索引
pnpm dev              # 启动 → http://localhost:5173
\`\`\`

> 第一次用？看 **[快速上手](/getting-started/)**。
`,
  )
}

export async function runInit(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const site = resolveSite()
  const siteVersion = site?.version ?? CORE_VERSION

  const interactive = !args.yes && process.stdin.isTTY
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
  const ask = async (q: string, def: string) => {
    if (!rl) return def
    const a = (await rl.question(`${q}${def ? `（${def}）` : ''}：`)).trim()
    return a || def
  }

  try {
    let target = str(args._[0], '')
    target = await ask('目标目录', target || '.')
    const abs = path.resolve(process.cwd(), target)

    // 只拦「已经是实例」的情况：正常流程是先装包再 init，目录本来就有 package.json / node_modules
    if (fs.existsSync(path.join(abs, 'knowledge.config.mjs')) && !args.force) {
      throw new Error(`该目录已经是知识库实例：${abs}（加 --force 覆盖）`)
    }
    if (!fs.existsSync(TEMPLATE)) throw new Error(`未找到实例骨架：${TEMPLATE}`)

    const defaults = {
      name: str(args.name, path.basename(abs)),
      contentRoot: str(args.contentRoot, './docs'),
      collection: str(args.collection, sanitize(path.basename(abs))),
      port: str(args.port, '3000'),
    }
    const o = {
      name: await ask('知识库名称', defaults.name),
      contentRoot: await ask('内容目录', defaults.contentRoot),
      collection: await ask('向量集合名', defaults.collection),
      port: await ask('服务端口', defaults.port),
    }

    console.log(`\n生成实例 → ${abs}`)
    fs.mkdirSync(abs, { recursive: true })
    fs.cpSync(TEMPLATE, abs, { recursive: true })

    // 「快速上手」文章由 @kb/site 提供（唯一来源），避免骨架里再存一份
    if (site) {
      const starter = path.join(site.dir, 'templates/getting-started/index.md')
      if (fs.existsSync(starter)) {
        const destDir = path.join(abs, o.contentRoot, 'getting-started')
        fs.mkdirSync(destDir, { recursive: true })
        fs.copyFileSync(starter, path.join(destDir, 'index.md'))
      }
    } else {
      console.log('⚠️  当前项目里没有 @kb/site，跳过「快速上手」文章（先装 @kb/site 可自动带上）')
    }

    fs.writeFileSync(
      path.join(abs, 'package.json'),
      JSON.stringify(instancePackageJson(o.name, str(args.local, '') || undefined, siteVersion), null, 2) + '\n',
    )
    writeConfig(abs, o)
    writeHome(abs, o)

    console.log('\n✅ 完成。')
    console.log(`   knowledge.config.mjs   （实例配置）`)
    console.log(`   ${o.contentRoot}/                     （内容目录 + 示例文档 + 快速上手）`)
    console.log(`\n后续步骤：`)
    console.log(`   cd ${target}`)
    console.log('   pnpm install')
    console.log('   pnpm chroma:start          # 启动向量库（需 Docker）')
    console.log('   ollama pull qwen3:8b && ollama pull bge-m3')
    console.log('   pnpm kb index              # 建立索引')
    console.log('   pnpm dev                   # 启动（文档 5173 / API 3000）')

    if (args.install) {
      console.log('\n安装依赖中...')
      const r = spawnSync('pnpm', ['install'], { cwd: abs, stdio: 'inherit' })
      if (r.status !== 0) throw new Error('pnpm install 失败')
    } else {
      console.log('\n（加 --install 可在生成后自动安装依赖）')
    }
  } finally {
    rl?.close()
  }
}
