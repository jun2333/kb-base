import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers'
import type { Document } from '@langchain/core/documents'

// 国内访问 huggingface.co 不稳定，走镜像源
env.remoteHost = 'https://hf-mirror.com'

const RERANK_MODEL = 'Xenova/bge-reranker-base'
const MAX_LENGTH = 512

export type RerankResult = { doc: Document; score: number }

// 模型只加载一次，进程内复用
let rerankerPromise: Promise<{ tokenizer: any; model: any }> | null = null

function getReranker() {
  if (!rerankerPromise) {
    rerankerPromise = (async () => {
      const tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL)
      const model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL)
      return { tokenizer, model }
    })()
  }
  return rerankerPromise
}

/**
 * Cross-encoder 重排：把 (query, doc) 一起编码打分，精度高于向量（bi-encoder），
 * 但更慢——所以只对向量召回的一小批候选做，返回相关性最高的 topK。
 */
export async function rerank(query: string, docs: Document[], topK: number): Promise<RerankResult[]> {
  if (docs.length === 0) return []
  const { tokenizer, model } = await getReranker()

  const inputs = await tokenizer(
    docs.map(() => query),
    {
      text_pair: docs.map((d) => d.pageContent),
      padding: true,
      truncation: true,
      max_length: MAX_LENGTH,
    }
  )
  const output = await model(inputs)
  const scores = output.logits.data as Float32Array

  return docs
    .map((doc, i) => ({ doc, score: Number(scores[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
