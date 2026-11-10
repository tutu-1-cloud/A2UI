/**
 * /api/chat 路由处理：用户对话生成 UI。
 * 接收文字/图片指令，调用 realAgent，通过 streamAgent 以 SSE 流返回 A2UI 协议。
 */

import type { Context } from 'koa'
import { sseStart } from '../transport/sse'
import { realAgent, hasRealAgent, type AgentRequest } from '../agent'
import { isCompleteProtocol } from '../agent/normalize'
import { getOrCreateSession, appendTurn, buildContext } from '../session'
import { streamAgent } from './stream'

export async function chatHandler(ctx: Context) {
  const body = (ctx.request.body ?? {}) as AgentRequest
  // 初始化 SSE 响应
  sseStart(ctx)

  // 获取或创建会话，构建对话历史上下文
  const sessionId = body.sessionId ?? 'default'
  const session = getOrCreateSession(sessionId)
  const context = buildContext(session)

  // 记录用户轮次到会话历史
  appendTurn(session, {
    turnId: Date.now(),
    role: 'user',
    content: body.text || '[图片]',
    timestamp: Date.now(),
  })

  // LLM 未配置时直接返回错误
  if (!hasRealAgent()) {
    ctx.body = 'error: LLM apiKey 未配置'
    return
  }

  // 调用 realAgent 并流式下发，附加完整性校验
  const agent = realAgent({ ...body, currentProtocol: body.currentProtocol, historySummary: context.summaryHistory })
  await streamAgent(ctx, agent, session, { validate: isCompleteProtocol })
}
