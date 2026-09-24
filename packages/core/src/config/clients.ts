import OpenAI from 'openai'
import { OpenAIEmbeddings } from '@langchain/openai'
import type { ChromaClientParams } from 'chromadb'
import { config } from './index.js'

// 客户端工厂：把「本地 Ollama（默认） / 远程 OpenAI 兼容服务」的差异收敛在这里。
// 本地时 apiKey 用占位符即可（Ollama 不校验）；远程时从配置的 apiKeyEnv 读取。

const PLACEHOLDER_KEY = 'ollama'

/** 聊天客户端 */
export function createChatClient(): OpenAI {
  return new OpenAI({
    apiKey: config.chat.apiKey || PLACEHOLDER_KEY,
    baseURL: config.chat.baseUrl,
  })
}

/** 向量模型客户端 */
export function createEmbeddings(): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    modelName: config.embedding.model,
    apiKey: config.embedding.apiKey || PLACEHOLDER_KEY,
    configuration: { baseURL: config.embedding.baseUrl },
    batchSize: 10,
  })
}

/** chromadb 原生客户端的连接参数（含远程 token / tenant / database） */
export function chromaClientArgs(): ChromaClientParams {
  const args: ChromaClientParams = { path: config.chroma.url }
  const extra: Record<string, unknown> = {}
  if (config.chroma.token) extra.auth = { provider: 'token', credentials: config.chroma.token }
  if (config.chroma.tenant) extra.tenant = config.chroma.tenant
  if (config.chroma.database) extra.database = config.chroma.database
  return { ...args, ...extra } as ChromaClientParams
}

/** LangChain Chroma 向量库的连接参数（url + clientParams） */
export function chromaVectorStoreParams(): { url: string; clientParams: Record<string, unknown> } {
  const { path: _path, ...clientParams } = chromaClientArgs() as Record<string, unknown>
  return { url: config.chroma.url, clientParams }
}
