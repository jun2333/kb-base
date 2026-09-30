import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import cors from '@koa/cors'
import healthRouter from './routes/health.js'
import chatRouter from './routes/chat.js'
import importRouter from './routes/import.js'
import manageRouter from './routes/manage.js'
import { config } from './config/index.js'

/** 组装 Koa 应用（不含 listen，便于测试/嵌入） */
export function createApp(): Koa {
  const app = new Koa()
  app.use(cors())
  // 导入时客户端会把一批 .md 的正文一起 POST 上来，默认 1mb 不够
  app.use(bodyParser({ jsonLimit: '64mb' }))
  for (const router of [healthRouter, chatRouter, importRouter, manageRouter]) {
    app.use(router.routes())
    app.use(router.allowedMethods())
  }
  return app
}

/** 启动 API 服务 */
export function startServer(port: number = config.port) {
  const app = createApp()
  return app.listen(port, () => {
    console.log(`API 已启动: http://localhost:${port}`)
  })
}
