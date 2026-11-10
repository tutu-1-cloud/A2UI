/**
 * LLM Agent：组装 prompt 并调用 OpenAI 兼容接口（流式）。
 * 配置从 .env 读取，含图片时自动切换多模态模型（vlModel）。
 */

import { SYSTEM_PROMPT } from './prompt'
import type { ElementReference } from '@a2ui/core'

/** LLM 配置：从环境变量读取，无值时使用默认模型名 */
const LLM_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY ?? '',
  baseURL: process.env.OPENAI_BASE_URL ?? '',
  model: process.env.OPENAI_MODEL ?? 'qwen-plus',
  vlModel: process.env.OPENAI_VL_MODEL ?? 'qwen-vl-plus',
}

/**
 * 判断请求是否包含图片。
 * 检查 messages 中是否有 content 为数组且含 image_url 类型的项。
 */
function requestHasImage(req: AgentRequest): boolean {
  return Boolean(
    req.messages?.some((m) => {
      const content = (m as { content?: unknown })?.content
      return (
        Array.isArray(content) &&
        content.some((p) => (p as { type?: string })?.type === 'image_url')
      )
    }),
  )
}

/** 根据是否含图片选择模型：含图用 vlModel，否则用普通 model */
function pickModel(req: AgentRequest): string {
  return requestHasImage(req) ? LLM_CONFIG.vlModel : LLM_CONFIG.model
}

/** Agent 请求参数 */
export interface AgentRequest {
  sessionId?: string            // 会话 id
  messages?: unknown[]          // 多模态消息（含图片时使用）
  text: string                  // 用户文字指令
  currentProtocol?: unknown     // 当前界面协议快照（增量修改基底）
  historySummary?: string[]     // 对话历史摘要
  selectedElement?: ElementReference  // 选中的组件（增量修改目标）
}

/** 判断是否配置了真实 LLM（apiKey 非空） */
export function hasRealAgent(): boolean {
  return Boolean(LLM_CONFIG.apiKey)
}

/**
 * 核心 Agent 函数：组装 prompt → 调用 LLM（流式）→ 逐 token yield。
 * 协议快照放在前面作为基底，选中组件信息居中，修改指令最后收尾。
 */
export async function* realAgent(req: AgentRequest): AsyncGenerator<string> {
  // 动态导入 openai SDK，未安装时给出明确提示
  let OpenAI: typeof import('openai').default
  try {
    OpenAI = (await import('openai')).default
  } catch {
    throw new Error(
      '未安装 openai SDK。请执行 `pnpm install`，并在 server/a2ui-server/.env 中配置 OPENAI_API_KEY 后再使用。',
    )
  }

  // 创建 OpenAI 客户端，baseURL 为空时使用官方地址
  const client = new OpenAI({
    apiKey: LLM_CONFIG.apiKey,
    ...(LLM_CONFIG.baseURL ? { baseURL: LLM_CONFIG.baseURL } : {}),
  })

  // 组装用户消息文本：协议快照在前（基底），选中组件信息居中，修改指令最后收尾
  let userText = ''

  // 1. 当前界面协议快照（增量修改的基底）
  if (req.currentProtocol) {
    userText += `【当前界面协议（在此基础上修改）】：\n${req.currentProtocol}\n\n`
  }

  // 2. 选中的组件信息（增量修改目标）
  if (req.selectedElement) {
    userText += `【需要修改的组件】：${req.selectedElement.type}[${req.selectedElement.componentId}]\n`
    userText += `【当前属性】：${JSON.stringify(req.selectedElement.currentProperties)}\n\n`
  }

  // 3. 图片分析指令（含图时追加）
  if (requestHasImage(req)) {
    userText += `【图片说明】：用户上传了一张图片作为界面参考。请：
1. 分析图中的布局层级（容器嵌套、排列方向）、组件类型（文本/按钮/输入框/卡片/列表）和文字内容；
2. 用 Column/Row 还原布局，配色与风格用 useHint（theme/style）或 styles 表达；
3. 图片仅作参考：无法精确还原的视觉细节（图标、字体）用最接近的组件表达即可，不要尝试复现原图；
4. 若文字指令与图片冲突，以文字指令为准。

`
  }

  // 4. 本次修改要求
  userText += `【本次修改要求】：${req.text}\n\n`
  // 强制要求输出完整协议，禁止只吐补丁
  userText +=
    '必须输出包含「全部组件」的完整协议（createSurface → surfaceUpdate（界面所有组件）→ beginRendering）。禁止只输出补丁消息，禁止使用 dataModelUpdate 修改组件。'

  // 组装完整消息序列：系统提示 → 对话历史 → 多模态消息 → 用户指令
  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(req.historySummary?.length
      ? [{ role: 'user', content: `【对话历史】\n${req.historySummary.join('\n')}` }]
      : []),
    ...(req.messages ?? []),
    { role: 'user', content: userText },
  ]

  // 调用 LLM 流式接口
  const stream = await client.chat.completions.create({
    model: pickModel(req),
    messages,
    stream: true,
  })

  // 逐 chunk yield token 内容
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}
