// LLM Agent：组装 prompt → 流式调用 LLM → 逐 token 产出 A2UI JSONL 片段。
// 约定：返回 AsyncGenerator<string>；未在 LLM_CONFIG 填写 apiKey 时
// hasRealAgent() 返回 false，路由直接返回错误。

import { SYSTEM_PROMPT } from './prompt'
import type { ElementReference } from '@a2ui/core'

// LLM 配置（唯一入口，直接在此填写，无需环境变量）
//   apiKey  —— API Key
//   baseURL —— 接口地址（默认 OpenAI 官方，可换 DeepSeek / 通义等兼容服务）
//   model   —— 纯文本模型（JSON 协议遵循度高）
//   vlModel —— 含图片请求时自动切换的多模态模型
const LLM_CONFIG = {
  apiKey: '',
  baseURL: '',
  model: '',
  vlModel: '',
}

/** 请求是否携带图片输入（多模态） */
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

/** 根据请求是否含图片选择模型 */
function pickModel(req: AgentRequest): string {
  return requestHasImage(req) ? LLM_CONFIG.vlModel : LLM_CONFIG.model
}

export interface AgentRequest {
  /** 会话 id（多轮对话用） */
  sessionId?: string
  /** 对话历史（含多模态图片，base64）。前端部分场景不传，故为可选 */
  messages?: unknown[]
  /** 本次用户指令文本 */
  text: string
  /** 当前画布协议快照（增量修改用） */
  currentProtocol?: unknown
  /** 服务端维护的对话历史摘要（最近 N 轮 role: content，多轮记忆用） */
  historySummary?: string[]
  /** 选中的元素完整信息（点选修改用） */
  selectedElement?: ElementReference
}

/**
 * 是否有真实 LLM 可用。
 * 依据 LLM_CONFIG.apiKey 是否已填写判断。
 */
export function hasRealAgent(): boolean {
  return Boolean(LLM_CONFIG.apiKey)
}

/**
 * 真实 LLM Agent：组装 system prompt → 调 LLM（stream）→ 逐 token yield。
 *
 * 依赖 `openai` SDK（已在本包 devDependencies 中声明）。
 * 这里用动态 import，万一未安装会给出清晰报错。
 */
export async function* realAgent(req: AgentRequest): AsyncGenerator<string> {
  let OpenAI: typeof import('openai').default
  try {
    OpenAI = (await import('openai')).default
  } catch {
    throw new Error(
      '未安装 openai SDK。请执行 `pnpm install`，并在 src/agent/index.ts 的 LLM_CONFIG 里填写 apiKey 后再使用。',
    )
  }

  const client = new OpenAI({
    apiKey: LLM_CONFIG.apiKey,
    ...(LLM_CONFIG.baseURL ? { baseURL: LLM_CONFIG.baseURL } : {}),
  })

  // 组装 userText：协议快照在前（提供基底），修改指令最后收尾——
  // 若协议放最后，LLM 收尾印象是「在此基础修改」，容易只吐补丁
  let userText = ''

  // 当前协议快照：让 LLM 基于现有界面改，而非凭空重画
  if (req.currentProtocol) {
    userText += `【当前界面协议（在此基础上修改）】：\n${req.currentProtocol}\n\n`
  }

  // 选中的组件信息
  if (req.selectedElement) {
    userText += `【需要修改的组件】：${req.selectedElement.type}[${req.selectedElement.componentId}]\n`
    userText += `【当前属性】：${JSON.stringify(req.selectedElement.currentProperties)}\n\n`
  }

  // 含图片输入时附加多模态指令：SYSTEM_PROMPT 只约定了 JSONL 协议输出，
  // 需明确图片的角色（界面参考）与处理方式，模型行为才稳定
  if (requestHasImage(req)) {
    userText += `【图片说明】：用户上传了一张图片作为界面参考。请：
1. 分析图中的布局层级（容器嵌套、排列方向）、组件类型（文本/按钮/输入框/卡片/列表）和文字内容；
2. 用 Column/Row 还原布局，配色与风格用 useHint（theme/style）或 styles 表达；
3. 图片仅作参考：无法精确还原的视觉细节（图标、字体）用最接近的组件表达即可，不要尝试复现原图；
4. 若文字指令与图片冲突，以文字指令为准。

`
  }

  // 用户指令最后，强制收尾语义
  userText += `【本次修改要求】：${req.text}\n\n`
  userText +=
    '必须输出包含「全部组件」的完整协议（createSurface → surfaceUpdate（界面所有组件）→ beginRendering）。禁止只输出补丁消息，禁止使用 dataModelUpdate 修改组件。'

  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    // 服务端多轮记忆：注入最近 N 轮对话历史
    ...(req.historySummary?.length
      ? [{ role: 'user', content: `【对话历史】\n${req.historySummary.join('\n')}` }]
      : []),
    // 前端传的多模态消息（图片）
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
