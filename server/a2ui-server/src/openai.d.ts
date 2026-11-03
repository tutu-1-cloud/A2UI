// openai SDK 兜底类型声明，依赖缺失时让 typecheck 通过。

declare module 'openai' {
  export interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
  }

  export interface ChatCompletionChunk {
    choices?: Array<{ delta?: { content?: string } }>
  }

  export interface ChatCompletionsCreateParams {
    model: string
    messages: unknown[]
    stream: true
  }

  export interface ChatCompletions {
    create(params: ChatCompletionsCreateParams): Promise<AsyncIterable<ChatCompletionChunk>>
  }

  export interface OpenAIClient {
    chat: { completions: ChatCompletions }
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
