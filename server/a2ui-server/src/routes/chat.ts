/**
 * /api/chat 路由处理：用户对话生成 UI。
 * 接收文字/图片指令，交给公共生成链路。
 */

import type { Context } from 'koa'
import type { AgentRequest } from '../agent'
import { handleGeneration } from './generate'

export async function chatHandler(ctx: Context) {
  // 请求体 = Agent 参数 + 会话 id
  const body = (ctx.request.body ?? {}) as AgentRequest & { sessionId?: string }

  await handleGeneration(ctx, {
    sessionId: body.sessionId ?? 'default',
    text: body.text || '[图片]',
    messages: body.messages,
    currentProtocol: body.currentProtocol,
    selectedElement: body.selectedElement,
  })
}
