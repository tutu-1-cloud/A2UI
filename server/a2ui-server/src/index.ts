// A2UI Server 入口：Koa 装配与启动。
// 路由在 routes/，传输层在 transport/，LLM 调用在 agent/。

import Koa from 'koa'
import cors from '@koa/cors'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import { hasRealAgent } from './agent'
import { chatHandler } from './routes/chat'
import { actionHandler } from './routes/action'

const app = new Koa()
const router = new Router()

app.use(cors())
// 提高 JSON 请求体上限：图片 base64 编码后很容易超过默认 1mb，
// 若不调大会返回 413（Payload Too Large），前端拿不到响应而渲染空 surface。
app.use(bodyParser({
  jsonLimit: '20mb',
  formLimit: '20mb',
}))

// 健康检查
router.get('/api/health', (ctx) => {
  ctx.body = { ok: true, hasRealAgent: hasRealAgent() }
})

// 对话接口：SSE 流式返回 A2UI JSONL
router.post('/api/chat', chatHandler)

// 元素交互接口：接收组件动作，触发新一轮生成
router.post('/api/action', actionHandler)

app.use(router.routes()).use(router.allowedMethods())

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`[a2ui-server] listening on http://127.0.0.1:${PORT}`)
})
