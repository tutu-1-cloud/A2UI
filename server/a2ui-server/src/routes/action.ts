// /api/action 路由：组件事件回传入口，把动作转成用户消息走同一 Agent 链路。

import type { Context } from 'koa'
import { sseStart } from '../transport/sse'
import { realAgent, hasRealAgent, type AgentRequest } from '../agent'
import { getOrCreateSession, appendTurn, buildContext } from '../session'
import { streamAgent } from './stream'

export async function actionHandler(ctx: Context) {
  const body = (ctx.request.body ?? {}) as {
    sessionId?: string
    action?: { componentId: string; action: string; payload?: unknown }
    selectedElement?: unknown
    currentProtocol?: unknown
  }

  sseStart(ctx)

  const sessionId = body.sessionId ?? 'default'
  const session = getOrCreateSession(sessionId)
  const context = buildContext(session)

  // 把交互动作转成一条用户消息，走同样的 Agent 链路
  const actionText = body.action
    ? `[组件事件] ${body.action.action} @${body.action.componentId}`
    : '[组件事件]'

  appendTurn(session, {
    turnId: Date.now(),
    role: 'user',
    content: actionText,
    timestamp: Date.now(),
  })

  if (!hasRealAgent()) {
    ctx.body = 'error: LLM apiKey 未配置'
    return
  }
  const agent = realAgent({
    sessionId,
    messages: [],
    text: actionText,
    currentProtocol: body.currentProtocol,
    historySummary: context.summaryHistory,
    selectedElement: body.selectedElement as AgentRequest['selectedElement'],
  })

  await streamAgent(ctx, agent, session)
}
