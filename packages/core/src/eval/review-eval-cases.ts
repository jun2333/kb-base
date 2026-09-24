import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { Document } from '@langchain/core/documents'
import { config } from '../config/index.js'
import { createEmbeddings } from '../config/clients.js'
import { getRetriever } from '../rag/retriever.js'
import { createMarkdownChunker } from '../rag/chunker.js'

// 自动标出"问题与期望文档可能对不上"的可疑题，缩小人工审核范围。
// 两个信号：
//   A. 检索不到（期望文档"任一篇"都不在 top5）—— 最强信号，标注可能错、或检索确实差
//   B. 语义相似度偏低（问题 vs 期望文档，用 bge-m3 算，多篇取最相似那篇）
// 用法：pnpm kb cases:review

// 路径由实例配置提供（evalDir）
const CASES_PATH = path.join(config.evalDir, 'retrieval-cases.json')
const OUT_PATH = path.join(config.evalDir, 'retrieval-cases.suspects.json')
const REVIEWED_PATH = path.join(config.evalDir, 'retrieval-cases.reviewed.json')

const SIM_THRESHOLD = 0.55
const TOP_K = 5

type Case = { q: string; expect: string[]; category: string }

const embeddings = createEmbeddings()

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * 把期望文档切成"块"（与索引口径一致：切分 + 块首拼标题）。
 * 用它算相似度才准——只比"文档开头"会严重低估匹配度。
 */
async function docBlocksOf(rel: string): Promise<string[]> {
  const file = path.join(config.docsPath, rel)
  if (!fs.existsSync(file)) return []
  const { content, data } = matter(fs.readFileSync(file, 'utf-8'))
  const title = (data.title || content.match(/^#\s+(.+)$/m)?.[1] || '').trim()
  const chunker = createMarkdownChunker()
  const chunks = await chunker.splitDocuments([
    new Document({ pageContent: content, metadata: { source: rel, title } }),
  ])
  return chunks.map((c) => (title ? `【${title}】\n${c.pageContent}` : c.pageContent))
}

async function main() {
  const cases: Case[] = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'))

  // 已审核确认的条目（不论判定为"检索问题"还是"无需处理"）——不再出现在可疑清单里
  const reviewed: string[] = fs.existsSync(REVIEWED_PATH)
    ? (JSON.parse(fs.readFileSync(REVIEWED_PATH, 'utf-8')).reviewed ?? []).map((r: { q: string }) => r.q)
    : []
  const isReviewed = (q: string) => reviewed.includes(q)

  // === 信号 B：语义相似度（问题 vs 期望文档的各块，取最大——与检索口径一致）===
  const pairs: Array<{ caseIdx: number; block: string }> = []
  for (const [i, c] of cases.entries()) {
    for (const rel of c.expect) {
      for (const block of await docBlocksOf(rel)) pairs.push({ caseIdx: i, block })
    }
  }

  console.log(`计算语义相似度（${cases.length} 题 / ${pairs.length} 个文档块）...`)
  const qVecs = await embeddings.embedDocuments(cases.map((c) => c.q))
  const blockVecs = await embeddings.embedDocuments(pairs.map((p) => p.block))

  const sims = new Array(cases.length).fill(-1)
  pairs.forEach((p, j) => {
    const s = cosine(qVecs[p.caseIdx], blockVecs[j])
    if (s > sims[p.caseIdx]) sims[p.caseIdx] = s
  })

  // === 信号 A：检索命中排名（expect 任一篇命中即算命中，与 rag-eval 口径一致）===
  const retriever = await getRetriever(TOP_K)
  console.log(`评估检索命中（${cases.length} 题）...`)
  const ranks: number[] = []
  const topOf: string[][] = []
  for (const [i, c] of cases.entries()) {
    const docs = await retriever.invoke(c.q)
    const sources = docs.map((d) => d.metadata.source as string)
    const hitIdx = sources.findIndex((s) => c.expect.includes(s)) // 任一命中
    ranks.push(hitIdx + 1) // 0 = 未命中
    topOf.push(sources)
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${cases.length}`)
  }

  const miss = cases.map((c, i) => ({ c, i })).filter(({ c, i }) => ranks[i] === 0 && !isReviewed(c.q))
  const lowSim = cases
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => ranks[i] > 0 && sims[i] < SIM_THRESHOLD && !isReviewed(c.q))
    .sort((a, b) => sims[a.i] - sims[b.i])

  console.log(`\n=== A. 检索未命中 top${TOP_K}：${miss.length} 条（强烈建议审核）===`)
  for (const { c, i } of miss) {
    console.log(`- expect: ${JSON.stringify(c.expect)}`)
    console.log(`  q: ${c.q}  (相似度 ${sims[i].toFixed(3)})`)
    console.log(`  实际命中: ${topOf[i].slice(0, 3).join(', ') || '（无）'}`)
  }

  console.log(`\n=== B. 命中但语义相似度 < ${SIM_THRESHOLD}：${lowSim.length} 条（标注可能不精准）===`)
  for (const { c, i } of lowSim) {
    console.log(`- [${c.expect[0]}] (相似度 ${sims[i].toFixed(3)} | 命中排名 ${ranks[i]}) ${c.q}`)
    console.log(`    实际命中: ${topOf[i].slice(0, 3).join(', ')}`)
  }

  const total = miss.length + lowSim.length
  console.log(`\n需重点审核合计 ${total}/${cases.length} 条（${((total / cases.length) * 100).toFixed(0)}%）`)

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        threshold: SIM_THRESHOLD,
        miss: miss.map(({ c, i }) => ({ q: c.q, expect: c.expect, sim: sims[i], top: topOf[i].slice(0, 3) })),
        lowSim: lowSim.map(({ c, i }) => ({
          q: c.q,
          expect: c.expect,
          sim: sims[i],
          rank: ranks[i], // 期望文档命中的排名（1-based）
          top: topOf[i].slice(0, 3),
        })),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`可疑清单已写入：${OUT_PATH}`)
}

export default main
