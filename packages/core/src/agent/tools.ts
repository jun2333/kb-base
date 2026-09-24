import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import type { OpenAI } from 'openai'
import { searchDocs, invalidateRetriever } from '../rag/retriever.js'
import { config } from '../config/index.js'

/** 单个来源条目，用于前端 sources 事件 */
export type SourceItem = { source: string; title: string }

/** 工具执行结果：content 回传给 LLM，sources 供前端展示 */
export type ToolResult = { content: string; sources: SourceItem[] }

export type ToolImplementations = Record<string, (args: any) => Promise<ToolResult>>

/** 工具定义（OpenAI 兼容 JSON Schema），注入 LLM */
export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        '在知识库中检索与用户问题相关的文档片段。当问题需要知识库内容支撑（技术问答、概念解释、查找文章）时调用；闲聊、寒暄不需要调用。返回结果带 [来源N] 编号，回答时在相关句子末尾标注对应来源。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题，应基于对话意图重构而非直接复制用户原话' },
          top_k: { type: 'integer', description: '返回结果数量，默认 3，最大 10。问题范围广时取大值，精确问题时取小值' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_doc_content',
      description:
        '读取知识库中某篇文章的完整内容。当 search_knowledge 返回的片段不足以回答问题（如用户要求全文总结、对比多篇文章）时调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文章路径，如 javascript/closure.md，可从 search_knowledge 结果的 [来源N] 中获取' },
        },
        required: ['path'],
      },
    },
  },
]

const MAX_TOP_K = 10

/** 检索 + 容错（集合重建后重试一次） */
async function searchWithRetry(query: string, k: number) {
  try {
    return await searchDocs(query, k)
  } catch (e) {
    invalidateRetriever()
    return await searchDocs(query, k)
  }
}

/** 创建工具实现。返回的工具会收集本次会话产生的所有来源（供前端 sources 聚合） */
export function createTools(): { definitions: typeof toolDefinitions; implementations: ToolImplementations } {
  const sources: SourceItem[] = []

  const implementations: ToolImplementations = {
    search_knowledge: async ({ query, top_k = 3 }) => {
      const k = Math.max(1, Math.min(MAX_TOP_K, Number(top_k) || 3))
      const docs = await searchWithRetry(String(query), k)

      const content = docs
        .map(([doc], i) => `[来源${i + 1}: ${doc.metadata.source}]\n${doc.pageContent}`)
        .join('\n\n---\n\n')

      for (const [doc] of docs) {
        const item = { source: String(doc.metadata.source), title: String(doc.metadata.title || '') }
        if (!sources.some((s) => s.source === item.source)) sources.push(item)
      }

      return { content, sources: [...sources] }
    },

    get_doc_content: async ({ path: p }) => {
      if (typeof p !== 'string') {
        return { content: JSON.stringify({ error: 'path 参数必须是字符串' }), sources: [] }
      }

      const docsRoot = path.resolve(config.docsPath)
      const resolved = path.resolve(docsRoot, p)

      // 路径穿越防护：必须位于知识库目录内
      if (resolved !== docsRoot && !resolved.startsWith(docsRoot + path.sep)) {
        return { content: JSON.stringify({ error: '非法路径：不允许访问知识库目录之外的文件' }), sources: [] }
      }

      try {
        const raw = await fs.readFile(resolved, 'utf-8')
        const { content, data } = matter(raw)
        const source = path.relative(docsRoot, resolved)
        const title = String(data.title || '')

        if (!sources.some((s) => s.source === source)) {
          sources.push({ source, title })
        }

        return {
          content: `【${title || source}】\n${content}`,
          sources: [...sources],
        }
      } catch (e: any) {
        return { content: JSON.stringify({ error: `读取失败: ${e.message}` }), sources: [] }
      }
    },
  }

  return { definitions: toolDefinitions, implementations }
}
