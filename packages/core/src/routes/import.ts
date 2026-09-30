import Router from '@koa/router'
import { plan, run, importedCount, type ImportEntry, type Strategy } from '../import.js'

const router = new Router()

/**
 * 预检：只读盘、不写盘。
 * 浏览器走这条（只传路径，内容在确认后才上传）；返回目标树 / 冲突 / 忽略项 / 改名映射。
 */
router.post('/api/import/scan', (ctx) => {
  const { files } = ctx.request.body as { files?: Array<{ path: string }> }
  if (!Array.isArray(files)) {
    ctx.status = 400
    ctx.body = { error: 'files 必填' }
    return
  }
  ctx.body = { ok: true, ...plan(files.map((f) => ({ path: f.path }))) }
})

/**
 * 执行导入：客户端把内容一起传上来（只支持 .md 文本，所以直接传字符串最省事）。
 * 前端对大批量会分批调用，所以这里只处理一批。
 */
router.post('/api/import/execute', (ctx) => {
  const { files, strategy } = ctx.request.body as { files?: ImportEntry[]; strategy?: Strategy }
  if (!Array.isArray(files) || files.length === 0) {
    ctx.status = 400
    ctx.body = { error: 'files 必填' }
    return
  }
  const summary = run(files, { strategy })
  ctx.body = { ok: true, ...summary, pending: importedCount() }
})

/** 收件箱状态：还有多少待归档 */
router.get('/api/import/stat', (ctx) => {
  ctx.body = { ok: true, pending: importedCount() }
})

export default router
