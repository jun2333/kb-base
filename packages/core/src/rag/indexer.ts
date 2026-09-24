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

// 索引清单：记录每个文件的内容哈希，用于增量对比（relativePath -> sha256）
const MANIFEST_PATH = path.join(config.dataDir, 'index-manifest.json')

// 分批写入：Chroma 服务端对单次请求体大小有限制（约 35MB），300 块一批远小于该限制
const BATCH_SIZE = 300

/** 文件内容 sha256（用于判断文件是否变更） */
function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/** 读取上次的索引清单 */
function readManifest(): Record<string, string> {
  try {
    return JSON.parse(fsSync.readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch {
    return {} // 首次运行
  }
}

function writeManifest(manifest: Record<string, string>): void {
  fsSync.mkdirSync(config.dataDir, { recursive: true })
  fsSync.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
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

async function writeChunks(vectorStore: Chroma, chunks: Document[]): Promise<void> {
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    await vectorStore.addDocuments(chunks.slice(i, i + BATCH_SIZE))
    console.log(`  已写入 ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`)
  }
}

/** 建立/更新向量索引（供 CLI 调用） */
export async function runIndex(opts: { full?: boolean } = {}) {
  // 强制全量重建：kb index --full（或 FULL_INDEX=1）
  const forceFull = opts.full || process.env.FULL_INDEX === '1'

  console.log('开始索引文档...')
  console.log(`文档路径: ${config.docsPath}`)

  // glob：按通配符模式匹配文件路径（** = 任意层级，* = 任意文件名）
  // 索引范围（include / exclude）由实例配置提供
  const files = await glob(config.indexInclude, {
    cwd: config.docsPath,
    ignore: config.indexExclude,
    absolute: true,
  })
  console.log(`找到 ${files.length} 个 Markdown 文件`)

  // 1. 读取全部文件并计算内容哈希（文档总量约 2M 文本，全量读入内存即可，无需流式）
  const current = new Map<string, { raw: string; hash: string }>()
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf-8')
    const rel = path.relative(config.docsPath, file)
    current.set(rel, { raw, hash: hashContent(raw) })
  }

  // 2. 与上次清单对比，得到"变更"和"删除"
  const manifest = forceFull ? {} : readManifest()
  const changed: string[] = []
  for (const [rel, info] of current) {
    if (manifest[rel] !== info.hash) changed.push(rel)
  }
  const removed = Object.keys(manifest).filter((rel) => !current.has(rel))
  console.log(`变更 ${changed.length} 个，删除 ${removed.length} 个`)

  const chromaUrl = config.chroma.url
  const client = new ChromaClient(chromaClientArgs())
  const vectorStore = new Chroma(createEmbeddings(), {
    collectionName: config.collectionName,
    ...chromaVectorStoreParams(),
  })

  // 3. 判断能否增量：集合必须已存在，且不是强制全量
  let fullRebuild = forceFull
  if (!fullRebuild) {
    try {
      await client.getCollection({ name: config.collectionName } as never)
    } catch {
      fullRebuild = true // 集合不存在（首次 / 被清空）→ 全量
    }
  }

  if (fullRebuild) {
    console.log('模式: 全量重建')
    try {
      await client.deleteCollection({ name: config.collectionName })
      console.log(`已删除旧集合 ${config.collectionName}`)
    } catch {
      // 集合不存在时忽略
    }
    const docs = [...current.entries()].map(([rel, info]) => toDocument(rel, info.raw))
    const chunks = await chunkDocuments(docs)
    console.log(`切分为 ${chunks.length} 个文档块，正在写入 Chroma (${chromaUrl})...`)
    await writeChunks(vectorStore, chunks)
    console.log(`索引完成: ${chunks.length} 个文档块, 来自 ${files.length} 个文件`)
  } else {
    console.log('模式: 增量更新')
    if (changed.length === 0 && removed.length === 0) {
      console.log('没有文件变更，索引已是最新')
      return
    }

    // 先按 metadata.source 删掉"变更/移除"文件的旧块，避免重复累积
    const collection = await vectorStore.ensureCollection()
    for (const rel of [...changed, ...removed]) {
      await collection.delete({ where: { source: rel } })
    }

    const docs = changed.map((rel) => toDocument(rel, current.get(rel)!.raw))
    const chunks = await chunkDocuments(docs)
    console.log(`切分为 ${chunks.length} 个文档块，正在写入 Chroma (${chromaUrl})...`)
    await writeChunks(vectorStore, chunks)
    console.log(
      `增量完成: 更新 ${changed.length} 个文件、删除 ${removed.length} 个文件, 重新写入 ${chunks.length} 个文档块`
    )
  }

  // 4. 更新清单
  const next: Record<string, string> = {}
  for (const [rel, info] of current) next[rel] = info.hash
  writeManifest(next)
  console.log(`索引清单已更新: ${MANIFEST_PATH}`)
}
