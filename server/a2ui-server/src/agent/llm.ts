/**
 * LLM 客户端：通过 openai SDK 流式调用 chat completions，支持 function calling 与思考模式。
 * 对外只暴露 streamChat，Agent 循环与工具层不感知传输实现。
 */

import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

/** 对话消息：直接复用 SDK 类型 */
export type LLMMessage = ChatCompletionMessageParam

/** 工具调用（assistant 消息回传、tool 消息按 id 对应） */
export interface LLMToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** 工具定义（下发给 LLM 的 tools 参数，仅函数型工具） */
export type ToolSchema = ChatCompletionFunctionTool

/** 流式增量：思考片段、文本片段，或一轮结束时累积出的完整工具调用 */
export type LLMChunk =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; toolCalls: LLMToolCall[] }

/** DashScope 兼容接口的扩展参数：思考模式开关（SDK 类型里没有） */
interface DashScopeOptions {
  enable_thinking?: boolean
}

/** 请求参数 = SDK 流式参数 + 厂商扩展参数 */
type ChatRequestParams = ChatCompletionCreateParamsStreaming & DashScopeOptions

export interface StreamChatOptions {
  messages: LLMMessage[]
  tools?: ToolSchema[]
}

/** LLM 配置：单模型同时处理文本与图片，需选用支持图像输入且支持思考模式的模型 */
const LLM_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY ?? '',
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  model: process.env.OPENAI_MODEL ?? 'qwen3.8-max',
  // 思考模式：默认开启，设置 OPENAI_ENABLE_THINKING=false 可关闭
  thinking: process.env.OPENAI_ENABLE_THINKING !== 'false',
}

/** 思考内容攒批阈值：攒够一批再下发，避免前端被逐字刷新 */
const REASONING_FLUSH_CHARS = 200

/** 单次输出上限：协议是长 JSONL，默认上限会把大型界面截断成非法 JSON */
const MAX_OUTPUT_TOKENS = 8192

/** SDK 客户端延迟创建：apiKey 缺失时不在模块加载阶段抛错 */
let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: LLM_CONFIG.apiKey, baseURL: LLM_CONFIG.baseURL })
  }
  return client
}

/** 判断是否配置了真实 LLM（apiKey 非空） */
export function hasLLM(): boolean {
  return Boolean(LLM_CONFIG.apiKey)
}

/**
 * 读取思考内容：SDK 类型未声明 reasoning_content，
 * 用 in 收窄代替类型断言，取不到时返回空串。
 */
function readReasoning(delta: object): string {
  return 'reasoning_content' in delta && typeof delta.reasoning_content === 'string'
    ? delta.reasoning_content
    : ''
}

/**
 * 流式调用 chat completions。
 * 思考与文本增量实时 yield；工具调用分片到达，按 index 累积后在本轮结束时一次性 yield。
 */
export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<LLMChunk> {
  // 厂商扩展字段（enable_thinking）与 SDK 参数合并声明，无需断言转换
  const params: ChatRequestParams = {
    model: LLM_CONFIG.model,
    messages: opts.messages,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    // 显式下发开关：缺省时各厂商默认值不一致，可能仍会开启思考
    enable_thinking: LLM_CONFIG.thinking,
  }

  const stream = await getClient().chat.completions.create(params)

  // 工具调用按 index 累积：id / name / arguments 都可能被拆到多个 chunk
  const pendingToolCalls = new Map<number, LLMToolCall>()
  let reasoningBuf = ''

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta
    if (!delta) continue

    // 思考内容：攒够一批再下发，避免前端被逐字刷新
    const reasoning = readReasoning(delta)
    if (reasoning) {
      reasoningBuf += reasoning
      if (reasoningBuf.length >= REASONING_FLUSH_CHARS) {
        yield { type: 'reasoning', text: reasoningBuf }
        reasoningBuf = ''
      }
    }

    if (delta.content) yield { type: 'text', text: delta.content }

    for (const piece of delta.tool_calls ?? []) {
      const call: LLMToolCall = pendingToolCalls.get(piece.index) ?? {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      }
      if (piece.id) call.id = piece.id
      if (piece.function?.name) call.function.name += piece.function.name
      if (piece.function?.arguments) call.function.arguments += piece.function.arguments
      pendingToolCalls.set(piece.index, call)
    }
  }

  // 收尾：残留的思考内容
  if (reasoningBuf) yield { type: 'reasoning', text: reasoningBuf }

  if (pendingToolCalls.size > 0) {
    const toolCalls = [...pendingToolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    yield { type: 'tool_calls', toolCalls }
  }
}
