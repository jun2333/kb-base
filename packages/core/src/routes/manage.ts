import Router from '@koa/router'
import { inboxTree, listCategories, archive, remove } from '../manage.js'
import { importedCount, type Strategy } from '../import.js'
import { runIndex } from '../rag/indexer.js'
import { invalidateRetriever } from '../rag/retriever.js'

const router = new Router()

/** 归档面板的数据：收件箱树 + 现有分类 */
router.get('/api/manage/tree', (ctx) => {
  const { tree, total } = inboxTree()
  ctx.body = { ok: true, tree, total, categories: listCategories() }
})

/** 归档：把收件箱里的条目移到目标分类 */
router.post('/api/manage/archive', (ctx) => {
  const { items, target, strategy } = ctx.request.body as {
    items?: string[]
    target?: string
    strategy?: Strategy
  }
  if (!Array.isArray(items) || items.length === 0 || !target) {
    ctx.status = 400
    ctx.body = { ok: false, error: 'items 与 target 必填' }
    return
  }
  try {
    const summary = archive(items, target, strategy ?? 'skip')
    const { tree, total } = inboxTree()
    ctx.body = { ok: true, ...summary, tree, total, categories: listCategories() }
  } catch (err) {
    ctx.status = 400
    ctx.body = { ok: false, error: (err as Error).message }
  }
})

/**
 * 删除：把收件箱里的条目直接删掉（不进分类）。
 * 只作用于 docs/imported/（manage.ts 里有路径越界校验），源目录不受影响。
 */
router.post('/api/manage/delete', (ctx) => {
  const { items } = ctx.request.body as { items?: string[] }
  if (!Array.isArray(items) || items.length === 0) {
    ctx.status = 400
    ctx.body = { ok: false, error: 'items 必填（数组）' }
    return
  }
  const summary = remove(items)
  const { tree, total } = inboxTree()
  ctx.body = { ok: true, ...summary, tree, total, categories: listCategories() }
})

/**
 * 建立/更新索引（SSE 进度）。
 * 导入与归档都改动了内容，必须重建索引 AI 才搜得到 —— 所以把它做成一等公民接口。
 */
router.post('/api/index', async (ctx) => {
  const { full } = (ctx.request.body ?? {}) as { full?: boolean }

  ctx.respond = false
  const res = ctx.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

  try {
    await runIndex({ full: Boolean(full), onLog: (msg) => send({ type: 'log', data: msg }) })
    // 索引重建后旧集合句柄失效（BM25 语料也要跟着失效）
    invalidateRetriever()
    send({ type: 'done', pending: importedCount() })
  } catch (err) {
    send({ type: 'error', data: (err as Error).message })
  } finally {
    res.end()
  }
})

export default router
