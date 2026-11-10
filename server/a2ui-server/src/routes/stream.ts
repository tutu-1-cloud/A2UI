/**
 * 流式 Agent 编排：归一化 LLM 输出 → SSE 下发 → 结束校验 → 落 assistant 轮次。
 */

import type { Context } from 'koa'
import { sseWrite, sseEnd } from '../transport/sse'
import { formatAGUIEvent, formatAGUIError } from '../transport/protocol'
import { createProtocolNormalizer } from '../agent/normalize'
import { appendTurn, type ConversationState } from '../session'

export interface StreamAgentOptions {
  validate?: (full: string) => boolean  // 结束时的完整性校验函数
}

/**
 * 流式处理 Agent 输出：
 * 1. 逐 chunk 通过归一化器剥离围栏/散文、去空白
 * 2. 归一化后的文本通过 SSE 下发给前端
 * 3. 流结束后执行完整性校验（如缺少 surfaceUpdate/beginRendering 则报错丢弃）
 * 4. 校验通过后发送 done 事件，并将 assistant 轮次落入会话历史
 */
export async function streamAgent(
  ctx: Context,
  agent: AsyncGenerator<string>,
  session: ConversationState,
  opts: StreamAgentOptions = {},
): Promise<void> {
  const normalizer = createProtocolNormalizer()
  let seq = 0           // 消息序号
  let full = ''         // 累积的完整归一化文本（用于结束校验）

  try {
    // 逐 chunk 处理 LLM 流式输出
    for await (const chunk of agent) {
      const normalized = normalizer.push(chunk)
      full += normalized
      // 有有效内容时下发 SSE message 事件
      if (normalized) sseWrite(ctx, formatAGUIEvent('message', normalized, String(++seq)))
    }
    // 流结束，检查是否有未闭合对象
    normalizer.flush()

    // 完整性校验：拦截 LLM 只吐补丁的情况
    if (opts.validate && !opts.validate(full)) {
      sseWrite(ctx, formatAGUIError('INCOMPLETE_PROTOCOL', '未输出完整协议（缺少 surfaceUpdate 或 beginRendering），本轮结果已丢弃，界面保持不变'))
      return
    }

    // 校验通过，发送 done 事件
    sseWrite(ctx, formatAGUIEvent('done', {}))
    // 记录 assistant 轮次到会话历史
    appendTurn(session, {
      turnId: seq,
      role: 'assistant',
      content: '[A2UI 生成]',
      timestamp: Date.now(),
    })
  } catch (err) {
    // 出错时下发 error 事件
    sseWrite(ctx, formatAGUIError('AGENT_ERROR', (err as Error).message ?? 'unknown error'))
  } finally {
    // 无论成功失败都结束 SSE 连接
    sseEnd(ctx)
  }
}
