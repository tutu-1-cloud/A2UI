/**
 * 生成请求的公共处理：会话准备 → LLM 未配置检查 → Agent 流式下发。
 * /api/chat 与 /api/action 只是请求体的翻译层，共用这一条链路。
 */

import type { Context } from 'koa'
import type { ElementReference } from '@a2ui/core'
import { sseStart, sseWrite, sseEnd } from '../transport/sse'
import { formatAGUIError } from '../transport/protocol'
import { realAgent, hasRealAgent } from '../agent'
import { getOrCreateSession, appendTurn, buildHistory } from '../session'
import { streamAgent } from './stream'

export interface GenerationParams {
  sessionId: string               // 会话 id
  text: string                    // 本轮指令（动作事件已转成文本）
  messages?: unknown[]            // 多模态消息（含图片时使用）
  currentProtocol?: unknown       // 当前界面协议快照
  selectedElement?: ElementReference  // 选中的组件
}

/** 处理一次生成请求，全程通过 SSE 流式返回 */
export async function handleGeneration(ctx: Context, params: GenerationParams): Promise<void> {
  // 初始化 SSE 响应头
  sseStart(ctx)

  // 先取历史再记本轮：避免本轮指令既进历史、又被当作当前要求重复一遍
  const session = getOrCreateSession(params.sessionId)
  const historySummary = buildHistory(session)

  // LLM 未配置：必须走 SSE error 事件，否则前端拿不到任何事件、只会静默显示空画布
  if (!hasRealAgent()) {
    sseWrite(ctx, formatAGUIError('LLM_NOT_CONFIGURED', 'LLM apiKey 未配置'))
    sseEnd(ctx)
    return
  }

  // 记录用户轮次到会话历史（紧随其后由 streamAgent 记录 assistant 轮次）
  appendTurn(session, {
    turnId: Date.now(),
    role: 'user',
    content: params.text,
    timestamp: Date.now(),
  })

  // 错误由 streamAgent 统一捕获并下发 error + 结束流，此处不再包 try/catch
  const agent = realAgent({
    messages: params.messages,
    text: params.text,
    currentProtocol: params.currentProtocol,
    historySummary,
    selectedElement: params.selectedElement,
  })
  await streamAgent(ctx, agent, session)
}
