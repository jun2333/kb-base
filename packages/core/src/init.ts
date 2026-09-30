import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
import { findFreePort } from './docker.js'
import { CONTENT_DIR } from './config/loader.js'

// kb init —— 从骨架生成一个全新的知识库实例（唯一的对外路径）。
//
// 用法：
//   kb init <目录> [--name 名称] [--collection 集合名] [--port 3000]
//                [--local <基座目录>] [--yes] [--force] [--install]
//
// 骨架**自包含**（含首页与快速上手文章），所以只装 @kb/core 就能跑，
// 不需要先有 @kb/site。生成的实例依赖里会同时写上 @kb/core 与 @kb/site。
//
// 依赖写法默认是**版本号**（读 @kb/core 自己的版本，两个包同仓库同版本发布）；
// 基座还没发布到 npm 时用 --local <基座目录>，改成指向本地基座的路径依赖。

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(__dirname, '../templates/instance')

/** @kb/core 自己的版本（读自身 package.json） */
const CORE_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
).version

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
    else if (a === '--port') out.port = argv[++i]
    else if (a === '--chroma-port') out.chromaPort = argv[++i]
    else if (a === '--local') out.local = argv[++i]
    else out._.push(a)
  }
  return out
}

const sanitize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'knowledge_base'

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)

/** 依赖写法：--local 时指向本地基座，否则写版本号 */
function buildDeps(local: string | undefined) {
  if (!local) {
    // 两个包同仓库、同版本发布，都取 @kb/core 自己的版本
    return { '@kb/core': `^${CORE_VERSION}`, '@kb/site': `^${CORE_VERSION}` }
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

function instancePackageJson(name: string, local: string | undefined) {
  return {
    name,
    private: true,
    type: 'module',
    scripts: {
      dev: 'kb dev',
      build: 'kb build',
      preview: 'kb preview',
      // 与 dev 同类：纯 kb 子命令，但日常最高频，给个短名字
      index: 'kb index',
      'index:full': 'kb index --full',
      'test:rag': 'kb eval',
      'test:rag:full': 'kb eval --full',
      'test:rag:baseline': 'kb eval:baseline',
      // 交给基座：容器名按实例区分（不然本地两个实例会互相顶掉），端口取自 knowledge.config.mjs
      'chroma:start': 'kb chroma:start',
      'chroma:stop': 'kb chroma:stop',
      // 交给基座：模型名取自 knowledge.config.mjs（不然改了配置还在拉旧模型）
      'ollama:pull': 'kb ollama:pull',
      'ollama:stop': 'kb ollama:stop',
    },
    dependencies: buildDeps(local),
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

  // 索引范围（glob）——内容固定放在实例根下的 docs/
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

  // 向量库：默认本地 Chroma；远程 / 云给 url + tokenEnv（给了 url 就不再用本地容器）
  chroma: {
    host: 'localhost',
    // 端口要和"本实例自己的容器"一致；kb init 会挑一个没被占用的，
    // 所以本地起第二个实例时不会和第一个撞车
    port: ${o.chromaPort},
    // 远程示例：url: 'https://xxx.chromadb.cloud', tokenEnv: 'CHROMA_TOKEN', tenant: 'xxx', database: 'xxx'
  },
  port: ${o.port},
  envFile: './.env',

  // 目录名 → 显示名（不写就按目录名，连字符/下划线转空格并首字母大写）
  categories: {},

  // 站点（docs/.vitepress 消费）
  site: {
    title: ${JSON.stringify(o.name)},
    description: '基于本地大模型的 RAG 知识库',

    // 社交链接：把 https://github.com/你的用户名/你的仓库 换成你自己的，然后解开这行的注释。
    // 配了之后，右上角图标和首页 hero 的 GitHub 按钮会**同时**出现（没配就都不出现）。
    // socialLinks: [{ icon: 'github', link: 'https://github.com/你的用户名/你的仓库' }],

    // 「仅本地」的内容路径（相对 docs/，可省略 .md）—— 这是**内容策略**：
    // 列在这里的目录/文件只在本地产出（线上不构建、不进菜单、不进侧边栏）。
    // onlyLocal: ['私人笔记', 'resume', 'service/roadmap.md'],

    // 菜单与侧边栏默认按目录推导：
    //   一级目录 = 一个菜单项；同一层有 ≥2 篇页面就给它一份侧边栏。
    // 想完全接管，跑 \`pnpm kb menu:export\` 生成 menu.config.mjs 再改。
  },
}
`,
  )
}

/**
 * 首页来自模板 `templates/instance/docs/index.md`（随骨架一起被 cpSync 复制过来），
 * 这里只把 `{{name}}` 换成实例名。想改首页长什么样，改模板文件，别改这里。
 */
function writeHome(target: string, o: Record<string, string>) {
  const file = path.join(target, CONTENT_DIR, 'index.md')
  const src = fs.readFileSync(file, 'utf-8')
  // 用函数形式替换：实例名里若有 $& 之类的字符不会被当成替换模式
  fs.writeFileSync(file, src.replaceAll('{{name}}', () => o.name), 'utf-8')
}

export async function runInit(argv: string[]): Promise<void> {
  const args = parseArgs(argv)

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
      collection: str(args.collection, sanitize(path.basename(abs))),
      port: str(args.port, '3000'),
    }
    // 向量库端口：默认挑一个没被占用的 —— 本地起第二个实例时就不会和第一个撞车
    //（容器名已经按实例区分了，端口也得分开）
    const chromaPort = str(args.chromaPort, '') || String(await findFreePort(8000))
    const o = {
      name: await ask('知识库名称', defaults.name),
      collection: await ask('向量集合名', defaults.collection),
      port: await ask('服务端口', defaults.port),
      chromaPort,
    }

    console.log(`\n生成实例 → ${abs}`)
    fs.mkdirSync(abs, { recursive: true })
    // 骨架自包含（含快速上手文章），不依赖任何已安装的包
    fs.cpSync(TEMPLATE, abs, { recursive: true })

    fs.writeFileSync(
      path.join(abs, 'package.json'),
      JSON.stringify(instancePackageJson(o.name, str(args.local, '') || undefined), null, 2) + '\n',
    )
    writeConfig(abs, o)
    writeHome(abs, o)

    console.log('\n✅ 完成。')
    console.log(`   knowledge.config.mjs   （实例配置）`)
    console.log(`   ${CONTENT_DIR}/               （你的内容 + 首页 + 快速上手）`)
    console.log(`\n后续步骤：`)
    console.log(`   cd ${target}`)
    console.log('   pnpm install')
    console.log(`   pnpm chroma:start          # 启动本实例自己的向量库容器（端口 ${chromaPort}，需 Docker）`)
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
