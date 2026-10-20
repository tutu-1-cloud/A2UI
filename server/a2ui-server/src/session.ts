// 会话管理：内存存储多轮对话历史（多轮对话的「记忆」）。
// 维护 sessionId → ConversationState：appendTurn 追加并截断（保留最近
// MAX_TURNS 轮），buildContext 生成注入 prompt 的历史摘要。
// 协议快照由前端维护并随请求上传，服务端不重复维护，避免两端状态漂移。

export interface ConversationTurn {
  turnId: number
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  a2uiSnapshot?: unknown
  modificationType?: 'initial' | 'refine' | 'element_edit'
  modifiedElements?: string[]
}

export interface ConversationState {
  sessionId: string
  history: ConversationTurn[]
  stylePreferences?: Record<string, unknown>
}

/** 最多保留的最近轮数 */
export const MAX_TURNS = 10

const sessions = new Map<string, ConversationState>()

/** 获取或创建会话 */
export function getOrCreateSession(sessionId: string): ConversationState {
  let s = sessions.get(sessionId)
  if (!s) {
    s = { sessionId, history: [] }
    sessions.set(sessionId, s)
  }
  return s
}

/** 追加一轮对话，并做历史截断 */
export function appendTurn(state: ConversationState, turn: ConversationTurn): void {
  state.history.push(turn)
  // 截断：保留最近 MAX_TURNS 轮
  if (state.history.length > MAX_TURNS) {
    state.history = state.history.slice(-MAX_TURNS)
  }
}

/** 构建注入 prompt 的历史摘要（最近 N 轮 role: content） */
export function buildContext(state: ConversationState): { summaryHistory: string[] } {
  return {
    summaryHistory: state.history.map((t) => `${t.role}: ${t.content}`),
  }
}
