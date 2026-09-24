import { Chroma } from '@langchain/community/vectorstores/chroma'
import { Document } from '@langchain/core/documents'
import { config } from '../config/index.js'
import { createEmbeddings, chromaVectorStoreParams } from '../config/clients.js'
import { rerank } from './reranker.js'
import { getBm25, invalidateBm25, type CorpusChunk } from './bm25.js'

let cachedStore: Chroma | null = null
let cacheValidated = false

async function getVectorStore(): Promise<Chroma> {
  if (!cachedStore || !cacheValidated) {
    cachedStore = await Chroma.fromExistingCollection(createEmbeddings(), {
      collectionName: config.collectionName,
      ...chromaVectorStoreParams(),
    })
    cacheValidated = true
  }

  return cachedStore
}

/**
 * 按来源去重：同一篇文档只保留最相关的一块。
 * 否则 topK 会被同一篇的多个块占满（实测「前端错误监控」前 4 名全是同一篇），
 * 既浪费位置，也让期望文档被挤下去。入参需已按相关性从高到低排好序。
 */
function dedupeBySource(results: [Document, number][], k: number): [Document, number][] {
  const seen = new Set<string>()
  const out: [Document, number][] = []
  for (const item of results) {
    const src = String(item[0].metadata.source || '')
    if (seen.has(src)) continue
    seen.add(src)
    out.push(item)
    if (out.length >= k) break
  }
  return out
}

/**
 * 混合检索：向量（语义）+ BM25（关键词）。
 *
 * 为什么需要：纯向量在**精确词**上最弱——英文缩写、专有名词、代码标识符这类，
 * 向量空间里容易和无关内容"漂"到一起。实测本项目 4 道未命中的题全都带精确词
 * （FMP/LCP、"代码审查"…），加 BM25 后全部命中。
 *
 * 融合方式：两路各自归一化到 [0,1] 再按权重相加（不是 RRF）。
 * 实测本项目用等权 RRF 反而伤 Hit@1（17 道原本排第一的被 BM25 噪声挤下去），
 * 因为零依赖的字符 bigram 分词比生产级分词器噪声大，需要压低 BM25 的权重。
 */
async function hybridFuse(query: string, candidates: [Document, number][], k: number) {
  const vec = dedupeBySource(candidates, Math.max(k, config.hybridCandidates))
  const { index, chunks } = await getBm25()
  const bmHits = index.search(query, Math.max(k, config.hybridCandidates) * 4)

  const fused = new Map<string, { doc: Document; score: number }>()

  // 向量路：距离越小越相关（向量已归一化，L2²/2 = 1 - cos）→ 用本查询内的最大距离归一
  const dMax = Math.max(...vec.map(([, d]) => d), 1e-6)
  for (const [doc, distance] of vec) {
    const src = String(doc.metadata.source ?? '')
    fused.set(src, { doc, score: (1 - distance / dMax) * config.hybridVectorWeight })
  }

  // BM25 路：先按来源去重（同篇只留最高分），再用本查询内的最高分归一
  const seenBm = new Set<string>()
  const bmList: Array<{ chunk: CorpusChunk; score: number }> = []
  for (const [idx, score] of bmHits) {
    const chunk = chunks[idx]
    if (!chunk || seenBm.has(chunk.source)) continue
    seenBm.add(chunk.source)
    bmList.push({ chunk, score })
  }
  const bMax = Math.max(...bmList.map((x) => x.score), 1e-6)
  for (const { chunk, score } of bmList) {
    const add = (score / bMax) * config.hybridBm25Weight
    const hit = fused.get(chunk.source)
    if (hit) hit.score += add
    else
      fused.set(chunk.source, {
        doc: new Document({ id: chunk.id, pageContent: chunk.text, metadata: chunk.metadata }),
        score: add,
      })
  }

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => [x.doc, x.score] as [Document, number])
}

/**
 * 检索：向量召回候选 → （可选 cross-encoder 精排）→（可选 BM25 混合）→ 按来源去重取 topK。
 * 返回 [Document, score][]：rerank 时 score 为相关性分数（越大越相关）；
 * 混合检索时 score 为归一化融合分（越大越相关）；纯向量时 score 为向量距离（越小越相关）。
 */
export async function searchDocs(query: string, k: number = 5) {
  const store = await getVectorStore()
  const depth = config.hybridEnabled
    ? Math.max(k, config.hybridCandidates)
    : Math.max(k, config.rerankCandidates)
  const candidates = await store.similaritySearchWithScore(query, depth)

  // 开了 rerank 就以精排为准（混合检索不再叠加，避免两套排序打架）
  if (config.rerankEnabled) {
    const ranked = await rerank(
      query,
      candidates.map(([doc]) => doc),
      candidates.length
    )
    return dedupeBySource(
      ranked.map((r) => [r.doc, r.score] as [Document, number]),
      k
    )
  }

  if (!config.hybridEnabled) return dedupeBySource(candidates, k)

  return hybridFuse(query, candidates, k)
}

/** 兼容旧接口（rag-eval 等）：返回带 invoke 的检索器（内部已含 rerank / 混合检索） */
export async function getRetriever(topK: number = 5) {
  return {
    async invoke(query: string): Promise<Document[]> {
      const results = await searchDocs(query, topK)
      return results.map(([doc]) => doc)
    },
  }
}

// kb index 会删除并重建集合，旧句柄（以及按旧集合建的 BM25 语料）会失效
export function invalidateRetriever() {
  cacheValidated = false
  invalidateBm25()
}
