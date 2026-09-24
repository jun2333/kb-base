#!/usr/bin/env tsx
/**
 * verify-tool-calling.ts — 小范围验证：Ollama(qwen3:8b) 的 Function Calling 链路
 *
 * 验证目标（场景 1 + 2 的最小链路）：
 *   1. qwen3:8b 能通过 OpenAI 兼容接口使用 tools 参数
 *   2. 模型能正确决定"何时调用工具、传什么参数"
 *   3. agent loop 闭环：决定调用 → 执行(mock) → 结果回传 → 基于结果流式回答
 *
 * 工具实现用 mock（不依赖 Chroma），只验证链路本身。
 * 运行：cd server && npx tsx scripts/verify-tool-calling.ts
 */
import OpenAI from 'openai'
import { config } from '../config/index.js'
import { createChatClient } from '../config/clients.js'

const client = createChatClient()

// === 工具定义（OpenAI 兼容 JSON Schema）===
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        '在知识库中检索与用户问题相关的文档片段。当问题需要知识库内容支撑（技术问答、概念解释、找文章）时调用；闲聊不需要调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题，应基于对话意图重构，而非直接复制用户原话' },
          top_k: { type: 'integer', description: '返回结果数量，默认 3' },
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
        '读取知识库中某篇文章的完整内容。当检索到的片段不足以回答（如用户要求全文总结、对比多篇文章）时调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文章路径，如 javascript/closure.md' },
        },
        required: ['path'],
      },
    },
  },
]

// === Mock 知识库（验证用，模拟检索/读全文结果）===
const MOCK_KB: Record<string, { title: string; content: string }> = {
  'javascript/closure.md': {
    title: '闭包详解',
    content:
      '闭包是函数与其词法作用域的绑定组合。\n\n形成条件：内层函数引用了外层函数的变量，并被保存到外部。\n\n常见用途：\n- 私有变量（模块模式）\n- 回调中的状态保持\n- 柯里化\n\n注意事项：\n- 闭包持有外部变量引用，不会自动回收，可能造成内存泄漏\n- 循环中创建闭包要注意变量捕获问题（用 let 或 IIFE）',
  },
  'react/hooks-summary.md': {
    title: 'React Hooks 总结',
    content:
      'useMemo：缓存计算结果，依赖不变时跳过重算。用于昂贵计算。\n\nuseCallback：缓存函数引用，防止子组件不必要重渲染。\n\n两者的区别：useMemo 缓存值，useCallback 缓存函数。\n\n规则：Hook 只能在组件顶层调用，不能在条件语句中调用。',
  },
  'browser/cross-origin.md': {
    title: '跨域解决方案',
    content:
      '跨域（CORS）是浏览器同源策略导致的请求限制。\n\n解决方案：\n- JSONP（只支持 GET）\n- CORS 配置（后端设置 Access-Control-Allow-Origin）\n- 反向代理（Nginx 转发）\n- postMessage（iframe 跨域通信）',
  },
}

// === 工具实现（mock）===
const toolImplementations: Record<string, (args: any) => Promise<string>> = {
  search_knowledge: async ({ query, top_k = 3 }: { query: string; top_k?: number }) => {
    console.log(`  [tool] search_knowledge(query="${query}", top_k=${top_k})`)
    const hits = Object.entries(MOCK_KB)
      .filter(([path, doc]) => path.includes(query) || doc.title.includes(query) || doc.content.includes(query))
      .slice(0, top_k)
    if (hits.length === 0) {
      // 模拟"检索到但无命中"，给一个兜底片段
      return JSON.stringify([{ pageContent: '（无精确命中，返回最相关的片段）', metadata: { source: 'javascript/closure.md' } }])
    }
    return JSON.stringify(
      hits.map(([path, doc]) => ({
        pageContent: doc.content.slice(0, 200),
        metadata: { source: path, title: doc.title },
      })),
    )
  },
  get_doc_content: async ({ path }: { path: string }) => {
    console.log(`  [tool] get_doc_content(path="${path}")`)
    const doc = MOCK_KB[path]
    if (!doc) return JSON.stringify({ error: `未找到文章: ${path}` })
    return JSON.stringify({ source: path, title: doc.title, content: doc.content })
  },
}

// === Agent Loop：LLM 决定调工具 → 执行 → 回传 → 直到无工具调用 ===
async function runAgent(question: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: '你是知识库助手。需要知识库内容时调用工具获取真实信息，不要编造。' },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: question },
  ]

  for (let turn = 0; turn < 3; turn++) {
    const response = await client.chat.completions.create({
      model: config.chat.model,
      messages,
      tools,
      stream: true,
      temperature: 0.2,
    })

    // 流式收集 content + tool_calls
    let content = ''
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = []
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) content += delta.content
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? toolCalls.length
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id ?? `call_${idx}`, type: 'function', function: { name: '', arguments: '' } }
          }
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
        }
      }
    }

    // 无工具调用 → 最终回答
    if (toolCalls.length === 0) {
      return content.trim()
    }

    // 有工具调用 → 执行工具，结果回传
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    })

    for (const tc of toolCalls) {
      const fn = toolImplementations[tc.function.name]
      let result: string
      if (fn) {
        try {
          result = await fn(JSON.parse(tc.function.arguments || '{}'))
        } catch (e: any) {
          result = JSON.stringify({ error: `参数解析失败: ${e.message}` })
        }
      } else {
        result = JSON.stringify({ error: `未知工具: ${tc.function.name}` })
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
  }
  return '（达到最大工具调用轮数，未能完成）'
}

// === 测试用例 ===
const cases: Array<{ name: string; q: string }> = [
  { name: '用例1: 技术问答（应触发 search_knowledge）', q: '介绍一下 React 的 useMemo 是干什么的？' },
  { name: '用例2: 全文总结（应触发 get_doc_content）', q: '把闭包这篇文章的完整内容总结一下' },
  { name: '用例3: 闲聊（不应触发任何工具）', q: '你好呀' },
  { name: '用例4: 多轮追问（应再次检索）', q: '那闭包有哪些注意事项？' },
]

async function main() {
  console.log(`模型: ${config.chat.model}\n`)
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const c of cases) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(c.name)
    console.log(`Q: ${c.q}`)
    const answer = await runAgent(c.q, history)
    console.log(`\nA: ${answer.slice(0, 300)}${answer.length > 300 ? '...' : ''}`)
    history.push({ role: 'user', content: c.q })
    history.push({ role: 'assistant', content: answer })
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('验证完成：观察上面每个用例是否按预期触发/不触发工具调用。')
}

export default main
