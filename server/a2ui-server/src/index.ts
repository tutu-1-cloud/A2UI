/**
 * A2UI 服务端入口
 * 基于 Koa 构建，提供健康检查、对话生成、组件动作、会话重置四条路由。
 * LLM 配置从 .env 读取（dotenv/config 自动加载）。
 */

import 'dotenv/config'
import Koa from 'koa'
import cors from '@koa/cors'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import { hasRealAgent } from './agent'
import { resetSession } from './session'
import { chatHandler } from './routes/chat'
import { actionHandler } from './routes/action'

const app = new Koa()
const router = new Router()

// 允许跨域（前端开发服务器访问）
app.use(cors())
// 图片 base64 编码后易超 1mb 默认上限，调高到 20mb 避免 413 错误
app.use(bodyParser({ jsonLimit: '20mb', formLimit: '20mb' }))

// 健康检查：返回服务状态和 LLM 配置是否就绪
router.get('/api/health', (ctx) => {
  ctx.body = { ok: true, hasRealAgent: hasRealAgent() }
})

// 对话生成：用户文字/图片指令 → LLM → A2UI 协议 SSE 流
router.post('/api/chat', chatHandler)
// 组件动作：按钮点击等交互事件 → 转为文本指令走同一 LLM 链路
router.post('/api/action', actionHandler)
// 会话重置：清空画布时同步丢弃后端对话历史，避免旧上下文污染下一轮
router.post('/api/session/reset', (ctx) => {
  const { sessionId } = (ctx.request.body ?? {}) as { sessionId?: string }
  resetSession(sessionId ?? 'default')
  ctx.body = { ok: true }
})

app.use(router.routes()).use(router.allowedMethods())

// 从环境变量读取端口，默认 3000
const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`[a2ui-server] listening on http://127.0.0.1:${PORT}`)
})
