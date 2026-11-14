/**
 * 流式 Agent 编排：过程事件实时下发 → 协议增量归一化 → 落 assistant 轮次。
 * 协议合法性由 agent/loop.ts 统一自检，此处只负责传输。
 */

import type { Context } from 'koa'
import { sseWrite, sseEnd } from '../transport/sse'
import { formatAGUIEvent, formatAGUIError, type AGUIEventType } from '../transport/protocol'
import { createProtocolNormalizer } from '../agent/normalize'
import type { AgentEvent } from '../agent/loop'
import { appendTurn, type ConversationState, type ToolTrace } from '../session'

/**
 * 流式处理 Agent 过程：
 * 1. reasoning / thought / plan / tool_call / tool_result 作为独立 SSE 事件下发，供前端展示步骤
 * 2. protocol 增量经归一化器剥离围栏/散文后，作为 message 事件下发
 * 3. 结束后发送 done 事件，并将 assistant 轮次与工具轨迹落入会话历史
 */
export async function streamAgent(
  ctx: Context,
  agent: AsyncGenerator<AgentEvent>,
  session: ConversationState,
): Promise<void> {
  const normalizer = createProtocolNormalizer()
  let seq = 0                          // 协议消息序号
  const toolTraces: ToolTrace[] = []   // 本轮工具轨迹

  /** 统一下发入口：避免每处重复 sseWrite + formatAGUIEvent */
  const send = (event: AGUIEventType, data: unknown, id?: string) =>
    sseWrite(ctx, formatAGUIEvent(event, data, id))

  try {
    for await (const evt of agent) {
      switch (evt.type) {
        case 'protocol': {
          const normalized = normalizer.push(evt.delta)
          if (normalized) send('message', normalized, String(++seq))
          break
        }
        case 'reasoning':
          send('reasoning', { text: evt.delta })
          break
        case 'thought':
          send('thought', { text: evt.text })
          break
        case 'plan':
          send('plan', { steps: evt.steps })
          break
        case 'tool_call':
          send('tool_call', { id: evt.id, name: evt.name, args: evt.args })
          break
        case 'tool_result':
          // 会话里只留摘要，SSE 里给前端更完整的结果
          toolTraces.push({ name: evt.name, ok: evt.ok, result: evt.result.slice(0, 300) })
          send('tool_result', {
            id: evt.id,
            name: evt.name,
            ok: evt.ok,
            result: evt.result.slice(0, 2000),
          })
          break
      }
    }
    // 流结束，检查是否有未闭合对象
    normalizer.flush()

    send('done', {})
    // 记录 assistant 轮次到会话历史（含工具轨迹，供下一轮参考）
    appendTurn(session, {
      turnId: seq,
      role: 'assistant',
      content: '[A2UI 生成]',
      timestamp: Date.now(),
      toolTraces: toolTraces.length ? toolTraces : undefined,
    })
  } catch (err) {
    sseWrite(ctx, formatAGUIError('AGENT_ERROR', (err as Error).message ?? 'unknown error'))
  } finally {
    // 无论成功失败都结束 SSE 连接
    sseEnd(ctx)
  }
}
