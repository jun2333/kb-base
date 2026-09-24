import Router from '@koa/router'
import type OpenAI from 'openai'
import { config } from '../config/index.js'
import { createChatClient } from '../config/clients.js'
import { createTools } from '../agent/tools.js'
import { runAgentLoop } from '../agent/loop.js'
import { SYSTEM_PROMPT } from '../agent/prompt.js'

const router = new Router()

const client = createChatClient()

router.post('/api/chat', async (ctx) => {
  const { message, history = [] } = ctx.request.body as {
    message: string
    history?: Array<{ role: string; content: string }>
  }

  if (!message) {
    ctx.status = 400
    ctx.body = { error: 'message is required' }
    return
  }

  // SSE 流式响应需要手动控制写入时机，绕过 Koa 的自动响应机制
  ctx.respond = false

  const res = ctx.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // 创建本次请求独立的工具（来源聚合独立于请求）
  const { definitions, implementations } = createTools()

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h) => ({
      role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.content,
    })),
    { role: 'user', content: message },
  ]

  const allSources: Array<{ source: string; title: string }> = []
  let sourcesSent = false
  const sendSources = () => {
    if (sourcesSent || allSources.length === 0) return
    sourcesSent = true
    res.write(`data: ${JSON.stringify({ type: 'sources', data: allSources })}\n\n`)
  }

  try {
    for await (const event of runAgentLoop({
      messages,
      definitions,
      implementations,
      client,
      model: config.chat.model,
    })) {
      if (event.type === 'tool') {
        // 聚合工具产生的来源（去重），在第一个 token 前一次性发出
        for (const s of event.sources) {
          if (!allSources.some((x) => x.source === s.source)) allSources.push(s)
        }
      } else if (event.type === 'token') {
        sendSources()
        res.write(`data: ${JSON.stringify({ type: 'token', data: event.content })}\n\n`)
      }
    }

    // 极端情况：全程无 token（如模型只调工具就结束），补发 sources 让前端能展示
    sendSources()
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
  } catch (error) {
    console.error('流式生成失败:', error)
    res.write(`data: ${JSON.stringify({ type: 'error', data: '生成失败，请重试' })}\n\n`)
  } finally {
    res.end()
  }
})

export default router
