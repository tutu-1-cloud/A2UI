/**
 * Agent 循环：思考 → 调工具 → 观察结果 → 再思考，直到模型输出最终 A2UI 协议。
 * 协议仍是最终产物，工具只用于收集信息；协议合法性由服务端统一自检。
 */

import { streamChat, type LLMMessage, type LLMToolCall, type ToolSchema } from './llm'
import { getTool, type ToolContext } from './tools'
import { checkProtocol, normalizeProtocolText } from './normalize'

/** Agent 产出的过程事件，由 stream.ts 转成 SSE */
export type AgentEvent =
  | { type: 'reasoning'; delta: string }                                    // 模型思考过程（流式片段）
  | { type: 'thought'; text: string }                                       // 模型的思考文本（本轮未输出协议）
  | { type: 'plan'; steps: string[] }                                       // 任务计划
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: string }
  | { type: 'protocol'; delta: string }                                      // 最终协议增量

export interface RunAgentOptions {
  messages: LLMMessage[]
  tools: ToolSchema[]
  ctx: ToolContext
  maxSteps?: number
}

/** 默认最大步数，防止模型反复调工具无法收敛 */
const DEFAULT_MAX_STEPS = 8

/** 协议自检不通过时允许的返工轮数（避免把坏界面丢给前端） */
const MAX_REPAIR_ROUNDS = 2

/**
 * 执行一轮完整 Agent 任务。
 * 每一步：调用 LLM → 有 tool_calls 就执行并回喂，无 tool_calls 则自检后作为最终协议。
 */
export async function* runAgentLoop(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const messages: LLMMessage[] = [...opts.messages]
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  let repairRounds = 0

  for (let step = 0; step < maxSteps; step++) {
    // 单步文本先累积：模型可能在调用工具前给出一段思考，也可能直接给出协议
    let text = ''
    let toolCalls: LLMToolCall[] = []

    for await (const chunk of streamChat({ messages, tools: opts.tools })) {
      // 思考过程实时转出，不参与协议文本累积
      if (chunk.type === 'reasoning') yield { type: 'reasoning', delta: chunk.text }
      else if (chunk.type === 'text') text += chunk.text
      else toolCalls = chunk.toolCalls
    }

    // 没有工具调用 → 本轮文本就是最终协议，先自检
    if (toolCalls.length === 0) {
      const normalized = normalizeProtocolText(text)
      const check = checkProtocol(normalized)
      if (check.ok) {
        yield { type: 'protocol', delta: text }
        return
      }

      // 自检不通过：还有返工额度就回喂模型重出一轮
      if (repairRounds < MAX_REPAIR_ROUNDS) {
        repairRounds++
        yield { type: 'thought', text: `协议自检未通过：${check.message}` }
        messages.push({ role: 'assistant', content: text })
        // 模型只写了说明文字、没输出任何 JSON 时，明确指出问题，避免它继续叙述
        const noJson = !normalized.trim()
          ? '你上一条回复里没有任何 JSONL 协议内容，只有说明文字。现在只输出协议本身，禁止输出任何解释。\n\n'
          : ''
        messages.push({
          role: 'user',
          content: `${noJson}【协议自检未通过】\n${check.message}\n\n请修正后重新输出完整协议：createSurface → surfaceUpdate（全部组件，并在父容器的 children 中挂接每一个子组件）→ beginRendering（root 必须是容纳所有内容的容器组件）。`,
        })
        continue
      }

      // 返工额度用尽：致命错误直接中止，仅部分组件不可达则照常下发并提示
      if (check.fatal) throw new Error(`协议自检未通过：${check.message}`)
      yield { type: 'thought', text: `部分组件未挂接，已尽力渲染：${check.message}` }
      yield { type: 'protocol', delta: text }
      return
    }

    // 有工具调用：本轮文本当作思考过程展示，然后逐个执行工具
    if (text.trim()) yield { type: 'thought', text: text.trim() }
    messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls })

    for (const call of toolCalls) {
      const name = call.function.name
      let args: Record<string, unknown> = {}
      let parseError = ''
      try {
        args = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {}
      } catch {
        parseError = `工具参数不是合法 JSON：${call.function.arguments.slice(0, 200)}`
      }

      yield { type: 'tool_call', id: call.id, name, args }

      let ok = true
      let result: string
      const tool = getTool(name)
      if (parseError) {
        ok = false
        result = parseError
      } else if (!tool) {
        ok = false
        result = `未知工具：${name}。可用工具：${opts.tools.map((t) => t.function.name).join('、')}`
      } else {
        try {
          const raw = await tool.execute(args, opts.ctx)
          if (typeof raw === 'string') {
            result = raw
          } else {
            result = raw.text
            // 工具附带的过程事件（如任务计划）先于结果下发
            if (raw.plan?.length) yield { type: 'plan', steps: raw.plan }
          }
        } catch (err) {
          ok = false
          result = `工具执行失败：${(err as Error).message}`
        }
      }

      yield { type: 'tool_result', id: call.id, name, ok, result }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  throw new Error(`Agent 超过最大步数 ${maxSteps}，已中止本轮生成`)
}
