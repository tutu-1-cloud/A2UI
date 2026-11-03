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

  const agent = realAgent({ ...body, currentProtocol: body.currentProtocol, historySummary: context.summaryHistory })
  await streamAgent(ctx, agent, session, { validate: isCompleteProtocol })
}
