import { SYSTEM_PROMPT } from './prompt'
import type { ElementReference } from '@a2ui/core'

// 从 .env 读取 LLM 配置。
const LLM_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY ?? '',
  baseURL: process.env.OPENAI_BASE_URL ?? '',
  model: process.env.OPENAI_MODEL ?? 'qwen-plus',
  vlModel: process.env.OPENAI_VL_MODEL ?? 'qwen-vl-plus',
}

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

function pickModel(req: AgentRequest): string {
  return requestHasImage(req) ? LLM_CONFIG.vlModel : LLM_CONFIG.model
}

export interface AgentRequest {
  sessionId?: string
  messages?: unknown[]
  text: string
  currentProtocol?: unknown
  historySummary?: string[]
  selectedElement?: ElementReference
}

export function hasRealAgent(): boolean {
  return Boolean(LLM_CONFIG.apiKey)
}

// 组装 prompt → 调 LLM（stream）→ 逐 token yield。
export async function* realAgent(req: AgentRequest): AsyncGenerator<string> {
  let OpenAI: typeof import('openai').default
  try {
    OpenAI = (await import('openai')).default
  } catch {
    throw new Error(
      '未安装 openai SDK。请执行 `pnpm install`，并在 server/a2ui-server/.env 中配置 OPENAI_API_KEY 后再使用。',
    )
  }

  const client = new OpenAI({
    apiKey: LLM_CONFIG.apiKey,
    ...(LLM_CONFIG.baseURL ? { baseURL: LLM_CONFIG.baseURL } : {}),
  })

  // 协议快照在前（基底），修改指令最后收尾。
  let userText = ''

  if (req.currentProtocol) {
    userText += `【当前界面协议（在此基础上修改）】：\n${req.currentProtocol}\n\n`
  }

  if (req.selectedElement) {
    userText += `【需要修改的组件】：${req.selectedElement.type}[${req.selectedElement.componentId}]\n`
    userText += `【当前属性】：${JSON.stringify(req.selectedElement.currentProperties)}\n\n`
  }

  if (requestHasImage(req)) {
    userText += `【图片说明】：用户上传了一张图片作为界面参考。请：
1. 分析图中的布局层级（容器嵌套、排列方向）、组件类型（文本/按钮/输入框/卡片/列表）和文字内容；
2. 用 Column/Row 还原布局，配色与风格用 useHint（theme/style）或 styles 表达；
3. 图片仅作参考：无法精确还原的视觉细节（图标、字体）用最接近的组件表达即可，不要尝试复现原图；
4. 若文字指令与图片冲突，以文字指令为准。

`
  }

  userText += `【本次修改要求】：${req.text}\n\n`
  userText +=
    '必须输出包含「全部组件」的完整协议（createSurface → surfaceUpdate（界面所有组件）→ beginRendering）。禁止只输出补丁消息，禁止使用 dataModelUpdate 修改组件。'

  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(req.historySummary?.length
      ? [{ role: 'user', content: `【对话历史】\n${req.historySummary.join('\n')}` }]
      : []),
    ...(req.messages ?? []),
    { role: 'user', content: userText },
  ]

  const stream = await client.chat.completions.create({
    model: pickModel(req),
    messages,
    stream: true,
  })

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}
