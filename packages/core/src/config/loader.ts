import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import type { KnowledgeConfig, ResolvedConfig } from './types.js'

// 加载「实例配置」：定位 knowledge.config.mjs → 动态 import → 归一化（绝对路径 + env 合并）。
// 用 .mjs + 动态 import（而非静态 import TS）是为了绕开 tsc 的 rootDir 约束。

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILENAME = 'knowledge.config.mjs'

/**
 * 内容根 / 站点根：固定为实例根下的 `docs/`（唯一入口，不可配置）。
 * 之所以不让它可配：内容外置是伪需求（笔记搬进来更自然），而"两个根"会带来
 * 一堆配置错配（内容文件该放哪、srcDir 指向哪），认知负担远大于收益。
 */
export const CONTENT_DIR = 'docs'

/** 从某目录向上查找配置文件 */
function searchUp(startDir: string): string | undefined {
  let dir = startDir
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * 定位配置文件（按可靠性）：
 * ① --config <path> ② KNOWLEDGE_CONFIG 环境变量
 * ③ 从 cwd 向上查找 ④ 从本模块位置向上查找（兼容包被安装在 node_modules 内）
 */
function findConfigPath(): string {
  const argIdx = process.argv.indexOf('--config')
  if (argIdx >= 0 && process.argv[argIdx + 1]) return path.resolve(process.argv[argIdx + 1])

  const fromEnv = process.env.KNOWLEDGE_CONFIG
  if (fromEnv) return path.resolve(fromEnv)

  const fromCwd = searchUp(process.cwd())
  if (fromCwd) return fromCwd

  const fromModule = searchUp(__dirname)
  if (fromModule) return fromModule

  throw new Error(`未找到 ${CONFIG_FILENAME}（可用 --config 或 KNOWLEDGE_CONFIG 指定路径）`)
}

/** 解析配置并合并默认值 / 环境变量 */
export async function loadConfig(): Promise<ResolvedConfig> {
  const configPath = findConfigPath()
  const configDir = path.dirname(configPath)

  // 先加载默认 .env（configDir/.env），保证配置文件里引用 process.env 时已就绪
  const defaultEnv = path.join(configDir, '.env')
  if (fs.existsSync(defaultEnv)) dotenv.config({ path: defaultEnv })

  const mod = (await import(pathToFileURL(configPath).href)) as { default?: Partial<KnowledgeConfig> }
  const raw = mod.default ?? {}

  // 配置里若另指定 envFile，再补加载一次
  const envFile = path.resolve(configDir, raw.envFile ?? './.env')
  if (fs.existsSync(envFile) && envFile !== defaultEnv) dotenv.config({ path: envFile, override: true })

  const abs = (p: string) => path.resolve(configDir, p)
  const posInt = (v: string | undefined, fallback: number) => {
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const site = raw.site ?? {}

  // ---------- 模型端点：默认本地 Ollama，也支持任意 OpenAI 兼容服务 ----------
  const modelsRaw = raw.models ?? {}
  const sharedBaseUrl = modelsRaw.baseUrl || 'http://localhost:11434/v1'
  const sharedApiKeyEnv = modelsRaw.apiKeyEnv || 'OPENAI_API_KEY'
  const sharedApiKey = process.env[sharedApiKeyEnv] ?? ''
  const isOllama = (url: string) => url.includes('11434')

  const resolveModel = (spec: unknown, fallbackModel: string) => {
    if (spec === undefined || typeof spec === 'string') {
      return {
        baseUrl: sharedBaseUrl,
        model: typeof spec === 'string' ? spec : fallbackModel,
        apiKey: sharedApiKey,
        ollamaNative: isOllama(sharedBaseUrl),
      }
    }
    const s = spec as { model?: string; baseUrl?: string; apiKeyEnv?: string }
    const baseUrl = s.baseUrl ?? sharedBaseUrl
    // 密钥只从环境变量读（.env 或真实环境），配置里只写变量名 —— 不提供"直接写密钥"的入口
    const apiKey = s.apiKeyEnv ? (process.env[s.apiKeyEnv] ?? '') : sharedApiKey
    return { baseUrl, model: s.model ?? fallbackModel, apiKey, ollamaNative: isOllama(baseUrl) }
  }

  // ---------- 向量库：默认本地 Chroma，也支持远程 / 云（url + token） ----------
  const chromaRaw = raw.chroma ?? {}
  // token 只从环境变量读（.env / 真实环境），配置里只写变量名 —— 不提供"直接写 token"的入口
  const chromaToken = chromaRaw.tokenEnv ? (process.env[chromaRaw.tokenEnv] ?? '') : ''
  const chromaPort = posInt(process.env.CHROMA_PORT, chromaRaw.port ?? 8000)
  const chromaUrl =
    chromaRaw.url ??
    `${chromaRaw.ssl ? 'https' : 'http'}://${process.env.CHROMA_HOST || chromaRaw.host || 'localhost'}:${chromaPort}`

  return {
    name: raw.name ?? 'knowledge-base',
    docsPath: abs(CONTENT_DIR),
    dataDir: abs(raw.dataDir ?? './data'),
    evalDir: abs(raw.evalDir ?? './eval'),
    indexInclude: raw.index?.include ?? ['**/*.md'],
    indexExclude: raw.index?.exclude ?? ['node_modules/**', '.vitepress/**'],
    collectionName: raw.collectionName ?? 'knowledge_base',
    chat: resolveModel(modelsRaw.chat, 'qwen3:8b'),
    embedding: resolveModel(modelsRaw.embedding, 'bge-m3'),
    chunkSize: raw.chunk?.size ?? 1000,
    chunkOverlap: raw.chunk?.overlap ?? 200,
    rerankEnabled: raw.rerank?.enabled ?? false,
    rerankCandidates: raw.rerank?.candidates ?? 20,
    hybridEnabled: raw.retrieval?.hybrid?.enabled ?? true,
    hybridCandidates: raw.retrieval?.hybrid?.candidates ?? 50,
    hybridVectorWeight: raw.retrieval?.hybrid?.vectorWeight ?? 0.7,
    hybridBm25Weight: raw.retrieval?.hybrid?.bm25Weight ?? 0.3,
    chroma: {
      url: chromaUrl,
      // 写了 url 就是连远程/云，本地容器没有意义 → 不保留 port
      port: chromaRaw.url ? undefined : chromaPort,
      token: chromaToken || undefined,
      tenant: chromaRaw.tenant,
      database: chromaRaw.database,
    },
    port: posInt(process.env.PORT, raw.port ?? 3000),
    envFile,
    categories: raw.categories ?? {},
    site: {
      title: site.title ?? '知识库',
      description: site.description ?? '个人知识库',
      onlyLocal: site.onlyLocal ?? [],
    },
  }
}

export { findConfigPath }
