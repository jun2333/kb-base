import { glob } from 'glob'
import fs from 'fs/promises'
import fsSync from 'node:fs'
import path from 'path'
import crypto from 'node:crypto'
import matter from 'gray-matter'
import { Document } from '@langchain/core/documents'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { ChromaClient } from 'chromadb'
import { createMarkdownChunker } from './chunker.js'
import { config } from '../config/index.js'
import { createEmbeddings, chromaClientArgs, chromaVectorStoreParams } from '../config/clients.js'
import { assertOwnChromaContainer } from '../chroma.js'

// 索引清单：记录每个文件的内容哈希，用于增量对比（relativePath -> sha256）
const MANIFEST_PATH = path.join(config.dataDir, 'index-manifest.json')

// 分批写入：Chroma 服务端对单次请求体大小有限制（约 35MB），300 块一批远小于该限制
const BATCH_SIZE = 300

/** 文件内容 sha256（用于判断文件是否变更） */
function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/**
 * 索引清单：文件 → 内容哈希，另外记下**建这份索引时用的向量模型**。
 *
 * 记 embedding 模型是为了能在换模型时自动全量重建 —— 换模型后新旧向量不在同一个空间里，
 * 混着用检索会**静默变差**（不报错，只是不准），光靠人记得重建是靠不住的。
 */
type Manifest = { files: Record<string, string>; embedding?: string }

/** 读取上次的索引清单（兼容旧格式：老版本就是一个扁平的 文件→哈希 映射） */
function readManifest(): Manifest {
  try {
    const raw = JSON.parse(fsSync.readFileSync(MANIFEST_PATH, 'utf-8')) as Record<string, unknown>
    if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') {
      return {
        files: raw.files as Record<string, string>,
        embedding: typeof raw.embedding === 'string' ? raw.embedding : undefined,
      }
    }
    return { files: (raw ?? {}) as Record<string, string> }
  } catch {
    return { files: {} } // 首次运行
  }
}

function writeManifest(files: Record<string, string>, embedding: string): void {
  fsSync.mkdirSync(config.dataDir, { recursive: true })
  fsSync.writeFileSync(MANIFEST_PATH, JSON.stringify({ version: 2, embedding, files }, null, 2))
}

/** 原始文本 -> Document（剥离 frontmatter + 提取标题） */
function toDocument(rel: string, raw: string): Document {
  const { content, data } = matter(raw)
  // frontmatter 没有 title 时回退到正文 h1，避免 chunk 上下文退化成英文文件路径
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return new Document({
    pageContent: content,
    metadata: { source: rel, title: data.title || h1 || '' },
  })
}

/** Document -> chunks（切分 + 块首拼标题，让向量带上"来自哪篇"的信息，避免断章取义） */
async function chunkDocuments(docs: Document[]): Promise<Document[]> {
  const chunker = createMarkdownChunker()
  const chunks = await chunker.splitDocuments(docs)
  for (const chunk of chunks) {
    const title = chunk.metadata.title || chunk.metadata.source || ''
    chunk.pageContent = title ? `【${title}】\n${chunk.pageContent}` : chunk.pageContent
  }
  return chunks
}

async function writeChunks(vectorStore: Chroma, chunks: Document[], log: (msg: string) => void): Promise<void> {
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    await vectorStore.addDocuments(chunks.slice(i, i + BATCH_SIZE))
    log(`  已写入 ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`)
  }
}

/**
 * 建立/更新向量索引。
 * @param opts.onLog 进度回调（CLI 默认打到 stdout；服务端用它转发成 SSE）
 */
export async function runIndex(opts: { full?: boolean; onLog?: (msg: string) => void } = {}) {
  const log = opts.onLog ?? console.log

  // 强制全量重建：kb index --full（或 FULL_INDEX=1）
  const forceFull = opts.full || process.env.FULL_INDEX === '1'

  log('开始索引文档...')
  log(`文档路径: ${config.docsPath}`)

  // glob：按通配符模式匹配文件路径（** = 任意层级，* = 任意文件名）
  // 索引范围（include / exclude）由实例配置提供
  const files = await glob(config.indexInclude, {
    cwd: config.docsPath,
    ignore: config.indexExclude,
    absolute: true,
  })
  log(`找到 ${files.length} 个 Markdown 文件`)

  const chromaUrl = config.chroma.url
  const client = new ChromaClient(chromaClientArgs())
  const vectorStore = new Chroma(createEmbeddings(), {
    collectionName: config.collectionName,
    ...chromaVectorStoreParams(),
  })

  // 0. 先确认向量库活着。
  // 不先探一下的话：连不上会一路走到"写向量"才炸，报出来的是底层异常（ChromaConnectionError 那一长串英文）；
  // 更糟的是下面那次 getCollection 的 catch 会把"连不上"当成"集合不存在"，静默转成全量重建 ——
  // 等 Chroma 回来就会**白白把整个集合删了重建**。
  try {
    await client.heartbeat()
  } catch {
    throw new Error(
      `连不上向量库（${chromaUrl}）—— 先在项目里把它启动起来：pnpm chroma:start（需要 Docker 在运行）`,
    )
  }
  // 心跳通了不等于连的是"自己的"库：端口撞上别的实例时会静默写进人家那里
  assertOwnChromaContainer()

  // 1. 读取全部文件并计算内容哈希（文档总量约 2M 文本，全量读入内存即可，无需流式）
  const current = new Map<string, { raw: string; hash: string }>()
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf-8')
    const rel = path.relative(config.docsPath, file)
    current.set(rel, { raw, hash: hashContent(raw) })
  }

  // 2. 与上次清单对比，得到"变更"和"删除"
  const prev: Manifest = forceFull ? { files: {} } : readManifest()
  const manifest = prev.files
  // 向量模型换了？换了就必须全量重建（新旧向量不在同一空间，混用会静默变差）
  const embeddingsChanged = !forceFull && !!prev.embedding && prev.embedding !== config.embedding.model
  const changed: string[] = []
  for (const [rel, info] of current) {
    if (manifest[rel] !== info.hash) changed.push(rel)
  }
  const removed = Object.keys(manifest).filter((rel) => !current.has(rel))
  log(`变更 ${changed.length} 个，删除 ${removed.length} 个`)
  if (embeddingsChanged) {
    log(
      `⚠️ 向量模型变了（上次索引用的 ${prev.embedding}，现在配的是 ${config.embedding.model}）` +
        `→ 必须全量重建，否则新旧向量不在同一空间，检索会静默变差`,
    )
  }

  // 3. 判断能否增量：集合必须已存在，且不是强制全量
  let fullRebuild = forceFull || embeddingsChanged
  if (!fullRebuild) {
    try {
      await client.getCollection({ name: config.collectionName } as never)
    } catch {
      // 上面已经心跳过，所以走到这里基本只剩"集合不存在"（首次索引 / 集合被外部删了）
      log(`集合 ${config.collectionName} 不存在，这次走全量`)
      fullRebuild = true
    }
  }

  // 3.5 「没有变更」这条捷径**必须实物核对**：
  // 清单只记录文件哈希，它证明"文件没变"，但**证明不了向量库里真有东西**。
  // 容器换过挂载目录 / 集合被清过 / data 被换过时，就会出现"清单在、库是空的" ——
  // 那时若直接说"已是最新"，界面会显示成功，而 AI 其实什么都搜不到（假成功）。
  if (!fullRebuild && changed.length === 0 && removed.length === 0 && Object.keys(manifest).length > 0) {
    const n = await (await vectorStore.ensureCollection()).count()
    if (n > 0) {
      log(`没有文件变更，索引已是最新（库中 ${n} 个块）`)
      return
    }
    log('⚠️ 清单说没有变更，但向量库里是空的（换过库 / 集合被清过）→ 改为全量重建')
    fullRebuild = true
  }

  if (fullRebuild) {
    log('模式: 全量重建')
    try {
      await client.deleteCollection({ name: config.collectionName })
      log(`已删除旧集合 ${config.collectionName}`)
    } catch {
      // 集合不存在时忽略
    }
    const docs = [...current.entries()].map(([rel, info]) => toDocument(rel, info.raw))
    const chunks = await chunkDocuments(docs)
    log(`切分为 ${chunks.length} 个文档块，正在写入 Chroma (${chromaUrl})...`)
    await writeChunks(vectorStore, chunks, log)
    log(`索引完成: ${chunks.length} 个文档块, 来自 ${files.length} 个文件`)
  } else {
    log('模式: 增量更新')

    // 先按 metadata.source 删掉"变更/移除"文件的旧块，避免重复累积
    const collection = await vectorStore.ensureCollection()
    for (const rel of [...changed, ...removed]) {
      await collection.delete({ where: { source: rel } })
    }

    const docs = changed.map((rel) => toDocument(rel, current.get(rel)!.raw))
    const chunks = await chunkDocuments(docs)
    log(`切分为 ${chunks.length} 个文档块，正在写入 Chroma (${chromaUrl})...`)
    await writeChunks(vectorStore, chunks, log)
    log(
      `增量完成: 更新 ${changed.length} 个文件、删除 ${removed.length} 个文件, 重新写入 ${chunks.length} 个文档块`
    )
  }

  // 4. 更新清单
  const next: Record<string, string> = {}
  for (const [rel, info] of current) next[rel] = info.hash
  writeManifest(next, config.embedding.model)
  log(`索引清单已更新: ${MANIFEST_PATH}`)
}
