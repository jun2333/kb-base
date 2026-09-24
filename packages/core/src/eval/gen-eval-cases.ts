import fs from 'node:fs'
import path from 'node:path'
import { glob } from 'glob'
import matter from 'gray-matter'
import { config } from '../config/index.js'
import { createChatClient } from '../config/clients.js'

// 用本地 LLM 逐篇生成"能由该文档回答的问题"，产出评测集初稿。
// ⚠️ 生成结果必须人工审核（措辞是否合理、期望文档是否准确）后再合并到 retrieval-cases.json。
// 用法：pnpm kb cases:gen [--limit N] [--concurrency N]

// 输出路径由实例配置提供（evalDir）
const OUT_PATH = path.join(config.evalDir, 'retrieval-cases.generated.json')

// 本地 Ollama 走原生 API（OpenAI 兼容接口不支持 think 参数；开启 thinking 会比关闭慢 ~30 倍）；
// 远程 OpenAI 兼容服务则走标准 chat.completions。
const OLLAMA_CHAT_URL = config.chat.ollamaNative
  ? `${config.chat.baseUrl.replace(/\/v1\/?$/, '')}/api/chat`
  : null

/** 目录名 → 分类显示名（实例配置 categories） */
const inferCategory = (rel: string) => config.categories[rel.split('/')[0]] ?? '其他'

/** 让模型基于文档生成一个能由它回答的问题 */
async function generateQuestion(title: string, content: string): Promise<string> {
  const prompt = `根据下面的技术文档，生成一个用户可能提出的、且能由该文档回答的中文技术问题。
要求：只输出问题本身，不要解释、不要引号，不超过 30 字。

文档标题：${title}
文档内容（节选）：
${content.slice(0, 1200)}`

  let text = ''
  if (OLLAMA_CHAT_URL) {
    const res = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.chat.model,
        messages: [{ role: 'user', content: prompt }],
        think: false, // 关键：关闭思考，出题这种任务不需要
        stream: false,
        options: { temperature: 0.7 },
      }),
    })
    const data = (await res.json()) as { message?: { content?: string } }
    text = data.message?.content ?? ''
  } else {
    const res = await createChatClient().chat.completions.create({
      model: config.chat.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    })
    text = res.choices[0]?.message?.content ?? ''
  }

  return text
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .pop()! // 兜底：只取最后一行
    .replace(/^["'「《]+|["'」》]+$/g, '')
}

/** 并发执行（限制并发数），保持结果顺序 */
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function main(opts: { limit?: number; concurrency?: number } = {}) {
  const limit = opts.limit ?? 0
  const concurrency = opts.concurrency ?? 4

  const files = await glob(config.indexInclude, {
    cwd: config.docsPath,
    ignore: config.indexExclude,
    absolute: true,
  })
  const targets = limit > 0 ? files.slice(0, limit) : files
  console.log(`共 ${files.length} 篇文档，本次处理 ${targets.length} 篇，并发 ${concurrency}\n`)

  const t0 = Date.now()
  let done = 0
  const results = await mapConcurrent(targets, concurrency, async (file) => {
    const raw = fs.readFileSync(file, 'utf-8')
    const { content, data } = matter(raw)
    const rel = path.relative(config.docsPath, file)
    const title = data.title || content.match(/^#\s+(.+)$/m)?.[1]?.trim() || rel

    const q = await generateQuestion(title, content)
    done++
    console.log(`[${done}/${targets.length}] ${rel} → ${q || '（生成失败）'}`)
    return q ? { q, expect: [rel], category: inferCategory(rel) } : null
  })

  const out = results.filter((r): r is NonNullable<typeof r> => r !== null)
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))

  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\n生成 ${out.length} 条候选（耗时 ${secs}s）→ ${OUT_PATH}`)
  console.log('⚠️ 请人工审核（措辞、期望文档是否正确）后再合并到 retrieval-cases.json')
}

export default main
