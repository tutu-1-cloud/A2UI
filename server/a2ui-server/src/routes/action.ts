/**
 * /api/action 路由处理：组件交互动作。
 * 将按钮点击等动作转为文本指令（如 "[组件事件] click @btn1"），走同一 LLM 链路。
 */

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

  // 初始化 SSE 响应
  sseStart(ctx)

  // 获取或创建会话
  const sessionId = body.sessionId ?? 'default'
  const session = getOrCreateSession(sessionId)
  const context = buildContext(session)

  // 将组件动作转为文本指令，如 "[组件事件] click @btn1"
  const actionText = body.action
    ? `[组件事件] ${body.action.action} @${body.action.componentId}`
    : '[组件事件]'

  // 记录用户轮次
  appendTurn(session, {
    turnId: Date.now(),
    role: 'user',
    content: actionText,
    timestamp: Date.now(),
  })

  // LLM 未配置时直接返回错误
  if (!hasRealAgent()) {
    ctx.body = 'error: LLM apiKey 未配置'
    return
  }

  // 调用 realAgent（动作场景不带多模态消息）
  const agent = realAgent({
    sessionId,
    messages: [],
    text: actionText,
    currentProtocol: body.currentProtocol,
    historySummary: context.summaryHistory,
    selectedElement: body.selectedElement as AgentRequest['selectedElement'],
  })

  // 流式下发（动作场景不做完整性校验，允许 LLM 只吐数据补丁）
  await streamAgent(ctx, agent, session)
}
