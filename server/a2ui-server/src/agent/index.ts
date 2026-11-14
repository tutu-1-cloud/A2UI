/**
 * LLM Agent 入口：组装 prompt 与工具 → 交给 Agent 循环执行。
 * Agent 可先调工具收集信息，最终输出 A2UI 协议 JSONL。
 */

import { SYSTEM_PROMPT } from './prompt'
import { hasLLM, type LLMMessage } from './llm'
import { AGENT_TOOLS } from './tools'
import { runAgentLoop, type AgentEvent } from './loop'
import type { ElementReference } from '@a2ui/core'

/** Agent 请求参数 */
export interface AgentRequest {
  messages?: unknown[]          // 多模态消息（含图片时使用）
  text: string                  // 用户文字指令
  currentProtocol?: unknown     // 当前界面协议快照（增量修改基底）
  historySummary?: string[]     // 对话历史摘要
  selectedElement?: ElementReference  // 选中的组件（增量修改目标）
}

/** 图片参考的固定说明：只在含图请求时拼入 */
const IMAGE_GUIDE = `【图片说明】：用户上传了一张图片作为界面参考。请：
1. 分析图中的布局层级（容器嵌套、排列方向）、组件类型（文本/按钮/输入框/卡片/列表）和文字内容；
2. 用 Column/Row 还原布局，配色与风格用 useHint（theme/style）或 styles 表达；
3. 图片仅作参考：无法精确还原的视觉细节（图标、字体）用最接近的组件表达即可，不要尝试复现原图；
4. 若文字指令与图片冲突，以文字指令为准。`

/** 强制要求输出完整协议，禁止只吐补丁 */
const FULL_PROTOCOL_RULE =
  '必须输出包含「全部组件」的完整协议（createSurface → surfaceUpdate（界面所有组件）→ beginRendering）。禁止只输出补丁消息，禁止使用 dataModelUpdate 修改组件。'

/** 判断是否配置了真实 LLM（apiKey 非空） */
export function hasRealAgent(): boolean {
  return hasLLM()
}

/** 判断请求是否包含图片：content 为数组且含有 image_url 片段 */
function requestHasImage(req: AgentRequest): boolean {
  return Boolean(
    req.messages?.some((message) => {
      const content = (message as { content?: unknown })?.content
      return (
        Array.isArray(content) &&
        content.some((part) => (part as { type?: string })?.type === 'image_url')
      )
    }),
  )
}

/** 组装本轮用户消息：选中组件 → 图片说明 → 修改要求 → 输出约束 */
function buildUserText(req: AgentRequest, hasImage: boolean): string {
  const sections: string[] = []

  if (req.selectedElement) {
    sections.push(
      `【需要修改的组件】：${req.selectedElement.type}[${req.selectedElement.componentId}]\n` +
        `【当前属性】：${JSON.stringify(req.selectedElement.currentProperties)}`,
    )
  }
  if (hasImage) sections.push(IMAGE_GUIDE)

  sections.push(`【本次修改要求】：${req.text}`, FULL_PROTOCOL_RULE)
  return sections.join('\n\n')
}

/**
 * 核心 Agent 函数：组装消息与工具 → 交出过程事件与协议增量。
 * 画布快照经 read_current_ui 工具按需投递，prompt 里只保留选中组件与本次指令。
 */
export async function* realAgent(req: AgentRequest): AsyncGenerator<AgentEvent> {
  const hasImage = requestHasImage(req)

  // 消息顺序：系统提示 → 对话历史 → 多模态消息 → 本轮文字指令
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(req.historySummary?.length
      ? [{ role: 'user' as const, content: `【对话历史】\n${req.historySummary.join('\n')}` }]
      : []),
    ...((req.messages ?? []) as LLMMessage[]),
    { role: 'user' as const, content: buildUserText(req, hasImage) },
  ]

  yield* runAgentLoop({
    messages,
    tools: AGENT_TOOLS.map((tool) => tool.schema),
    ctx: { currentProtocol: req.currentProtocol },
  })
}

export type { AgentEvent }
