// /api/chat 路由：对话入口，SSE 流式返回 A2UI JSONL。

import type { Context } from 'koa'
import { sseStart } from '../transport/sse'
import { realAgent, hasRealAgent, type AgentRequest } from '../agent'
import { isCompleteProtocol } from '../agent/normalize'
import { getOrCreateSession, appendTurn, buildContext } from '../session'
import { streamAgent } from './stream'

export async function chatHandler(ctx: Context) {
  const body = (ctx.request.body ?? {}) as AgentRequest
  sseStart(ctx)

  const sessionId = body.sessionId ?? 'default'
  const session = getOrCreateSession(sessionId)
  const context = buildContext(session)

  // 记录本轮用户消息（生成前入历史，供后续轮次做多轮记忆）
  appendTurn(session, {
    turnId: Date.now(),
    role: 'user',
    content: body.text || '[图片]',
    timestamp: Date.now(),
  })

  if (!hasRealAgent()) {
    ctx.body = 'error: LLM apiKey 未配置'
    return
  }
  // currentProtocol 是前端随请求上传的当前界面协议快照，
  // 供 LLM「在此基础上修改」；historySummary 提供多轮记忆
  const agent = realAgent({ ...body, currentProtocol: body.currentProtocol, historySummary: context.summaryHistory })

  await streamAgent(ctx, agent, session, { validate: isCompleteProtocol })
}
