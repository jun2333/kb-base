import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import cors from '@koa/cors'
import healthRouter from './routes/health.js'
import chatRouter from './routes/chat.js'
import { config } from './config/index.js'

/** 组装 Koa 应用（不含 listen，便于测试/嵌入） */
export function createApp(): Koa {
  const app = new Koa()
  app.use(cors())
  app.use(bodyParser())
  app.use(healthRouter.routes())
  app.use(healthRouter.allowedMethods())
  app.use(chatRouter.routes())
  app.use(chatRouter.allowedMethods())
  return app
}

/** 启动 API 服务 */
export function startServer(port: number = config.port) {
  const app = createApp()
  return app.listen(port, () => {
    console.log(`API 已启动: http://localhost:${port}`)
  })
}
