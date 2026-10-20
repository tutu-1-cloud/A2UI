// openai SDK 的兜底类型声明。
// 正常 pnpm install 后 SDK 自带的完整类型优先于本声明；
// 这里仅覆盖 realAgent 实际用到的 API 面，供依赖缺失或类型解析
// 失败时让 typecheck 仍可通过。

declare module 'openai' {
  export interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
  }

  export interface ChatCompletionChunk {
    choices?: Array<{
      delta?: { content?: string }
    }>
  }

  export interface ChatCompletionsCreateParams {
    model: string
    // 消息结构保持宽松：真实场景可能含多模态 content（数组、图片 base64 等）
    messages: unknown[]
    stream: true
  }

  export interface ChatCompletions {
    create(params: ChatCompletionsCreateParams): Promise<AsyncIterable<ChatCompletionChunk>>
  }

  export interface OpenAIClient {
    chat: {
      completions: ChatCompletions
    }
  }

  export interface OpenAIConfig {
    apiKey: string
    baseURL?: string
  }

  export default class OpenAI implements OpenAIClient {
    constructor(config: OpenAIConfig)
    chat: { completions: ChatCompletions }
  }
}
