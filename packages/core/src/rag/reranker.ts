import type { Document } from '@langchain/core/documents'

// @huggingface/transformers 是**可选依赖**（见 package.json 的 peerDependenciesMeta）。
//
// 为什么不写成普通依赖：它会拖进原生 ONNX 运行时（onnxruntime-node + onnxruntime-web
// + sharp，几十 MB），而重排默认是关的（knowledge.config.mjs 的 rerank.enabled）。
// 不开重排的人不该为它付安装代价；而且这些原生包带 postinstall 脚本，会在安装期触发
// pnpm 的「未批准构建脚本」（ERR_PNPM_IGNORED_BUILDS），把 kb init 这类 pnpm 脚本一起卡死。
//
// 所以这里惰性 import：只有真的用到重排时才加载。
// 要开本地重排（rerank.enabled: true）就先装：pnpm add @huggingface/transformers

const RERANK_MODEL = 'Xenova/bge-reranker-base'
const MAX_LENGTH = 512

export type RerankResult = { doc: Document; score: number }

// 模型只加载一次，进程内复用
let rerankerPromise: Promise<{ tokenizer: any; model: any }> | null = null

async function loadTransformers() {
  try {
    return await import('@huggingface/transformers')
  } catch (err) {
    throw new Error(
      '本地重排需要 @huggingface/transformers，但它没装。\n' +
        '  装它：pnpm add @huggingface/transformers\n' +
        '  或者关掉：knowledge.config.mjs 里把 rerank.enabled 设为 false（默认就是 false）',
      { cause: err },
    )
  }
}

function getReranker() {
  if (!rerankerPromise) {
    rerankerPromise = (async () => {
      const { AutoModelForSequenceClassification, AutoTokenizer, env } = await loadTransformers()
      // 国内访问 huggingface.co 不稳定，走镜像源
      env.remoteHost = 'https://hf-mirror.com'
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
    },
  )
  const output = await model(inputs)
  const scores = output.logits.data as Float32Array

  return docs
    .map((doc, i) => ({ doc, score: Number(scores[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
