// chat / action 共用的流式编排：
// 消费 Agent 的 AsyncGenerator → 归一化 → SSE 下发 → 校验 → 落对话记录。

import type { Context } from 'koa'
import { sseWrite, sseEnd } from '../transport/sse'
import { formatAGUIEvent, formatAGUIError } from '../transport/protocol'
import { createProtocolNormalizer } from '../agent/normalize'
import { appendTurn, type ConversationState } from '../session'

export interface StreamAgentOptions {
  /** 完整协议校验；不通过则发 error 并丢弃本轮（chat 用，action 不校验） */
  validate?: (full: string) => boolean
}

/**
 * 把 Agent 的流式输出逐 chunk 归一化后经 SSE 下发，结束时校验并落一轮对话记录。
 */
export async function streamAgent(
  ctx: Context,
  agent: AsyncGenerator<string>,
  session: ConversationState,
  opts: StreamAgentOptions = {},
): Promise<void> {
  const normalizer = createProtocolNormalizer()
  let seq = 0
  let full = ''

  try {
    for await (const chunk of agent) {
      const normalized = normalizer.push(chunk)
      full += normalized
      if (normalized) sseWrite(ctx, formatAGUIEvent('message', normalized, String(++seq)))
    }
    normalizer.flush()

    if (opts.validate && !opts.validate(full)) {
      sseWrite(ctx, formatAGUIError('INCOMPLETE_PROTOCOL', '未输出完整协议（缺少 surfaceUpdate 或 beginRendering），本轮结果已丢弃，界面保持不变'))
      return
    }

    sseWrite(ctx, formatAGUIEvent('done', {}))
    appendTurn(session, {
      turnId: seq,
      role: 'assistant',
      content: '[A2UI 生成]',
      timestamp: Date.now(),
    })
  } catch (err) {
    sseWrite(ctx, formatAGUIError('AGENT_ERROR', (err as Error).message ?? 'unknown error'))
  } finally {
    sseEnd(ctx)
  }
}
