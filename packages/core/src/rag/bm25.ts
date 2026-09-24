import { ChromaClient, IncludeEnum } from 'chromadb'
import { config } from '../config/index.js'
import { chromaClientArgs } from '../config/clients.js'

// 关键词检索（BM25）—— 混合检索的"第二路"。
// 纯向量在**精确词**上最弱（英文缩写、专有名词、型号、代码标识符），BM25 正好互补。
//
// 两个刻意的设计：
// 1) 分词零依赖：英文/数字按词切，中文按「单字 + 字符 bigram」。
//    中文没有空格，直接用空白分词等于没分；bigram 不依赖词典，对技术文档够用（装了 jieba 可再换）。
// 2) 语料直接从向量库读（而不是重新扫文件切分）——保证两路检索面对的"块"完全一致，
//    也不会因为切分逻辑改动而与索引漂移。

const K1 = 1.5
const B = 0.75

/** 中文按单字 + bigram，英文/数字按词 */
export function tokenize(text: string): string[] {
  const t = text.toLowerCase()
  const out: string[] = []
  // 英文/数字词（含 . _ + - 等代码里常见的连接符）
  for (const m of t.matchAll(/[a-z0-9][a-z0-9._+-]*/g)) out.push(m[0])
  // 中日韩文字：单字 + 相邻两字
  for (const seg of t.match(/[\u4e00-\u9fff\u3040-\u30ff]+/g) ?? []) {
    for (let i = 0; i < seg.length; i++) {
      out.push(seg[i])
      if (i + 1 < seg.length) out.push(seg.slice(i, i + 2))
    }
  }
  return out
}

export class BM25Index {
  private postings = new Map<string, Map<number, number>>()
  private lens: number[] = []
  private avgLen = 0

  constructor(docs: string[]) {
    docs.forEach((text, id) => {
      const toks = tokenize(text)
      this.lens[id] = toks.length
      for (const tk of toks) {
        let m = this.postings.get(tk)
        if (!m) this.postings.set(tk, (m = new Map()))
        m.set(id, (m.get(id) ?? 0) + 1)
      }
    })
    this.avgLen = this.lens.reduce((a, b) => a + b, 0) / (this.lens.length || 1)
  }

  /** 返回 [语料下标, 分数][]，按分数从高到低 */
  search(query: string, topN: number): Array<[number, number]> {
    const N = this.lens.length
    const scores = new Map<number, number>()
    for (const tk of new Set(tokenize(query))) {
      const m = this.postings.get(tk)
      if (!m) continue
      const idf = Math.log(1 + (N - m.size + 0.5) / (m.size + 0.5))
      for (const [id, tf] of m) {
        const denom = tf + K1 * (1 - B + (B * this.lens[id]) / this.avgLen)
        scores.set(id, (scores.get(id) ?? 0) + (idf * (tf * (K1 + 1))) / denom)
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
  }
}

export type CorpusChunk = {
  id: string
  source: string
  text: string
  metadata: Record<string, unknown>
}

type Bm25Cache = { index: BM25Index; chunks: CorpusChunk[] }

let cache: Bm25Cache | null = null
let loading: Promise<Bm25Cache> | null = null

/** 从向量库读出全部块并建索引（进程内只建一次） */
async function build(): Promise<Bm25Cache> {
  const empty: Bm25Cache = { index: new BM25Index([]), chunks: [] }
  try {
    const client = new ChromaClient(chromaClientArgs())
    const collection = await client.getCollection({
      name: config.collectionName,
      embeddingFunction: null,
    } as never)
    const total = await collection.count()
    if (total === 0) return empty

    const res = (await collection.get({
      limit: total,
      include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
    })) as { ids: string[]; documents: string[]; metadatas: Array<Record<string, unknown>> }

    const chunks: CorpusChunk[] = res.ids.map((id, i) => ({
      id,
      source: String(res.metadatas[i]?.source ?? ''),
      text: res.documents[i] ?? '',
      metadata: res.metadatas[i] ?? {},
    }))
    return { index: new BM25Index(chunks.map((c) => c.text)), chunks }
  } catch {
    // 集合不存在（还没跑过 kb index）、向量库连不上等原因都降级为"纯向量检索"，
    // 绝不能让关键词这一路把整个检索拖挂
    console.warn('[bm25] 建索引失败，本次退化为纯向量检索')
    return empty
  }
}

/** 懒加载 BM25 索引（首次调用会从向量库拉全量语料） */
export async function getBm25() {
  if (cache) return cache
  if (!loading) loading = build().then((r) => (cache = r))
  return loading
}

/** 索引变更后让缓存失效（与 retriever 的 invalidateRetriever 配套） */
export function invalidateBm25() {
  cache = null
  loading = null
}
