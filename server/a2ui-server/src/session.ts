// 会话管理：内存存储，多轮对话记忆。

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

export const MAX_TURNS = 10

const sessions = new Map<string, ConversationState>()

export function getOrCreateSession(sessionId: string): ConversationState {
  let s = sessions.get(sessionId)
  if (!s) {
    s = { sessionId, history: [] }
    sessions.set(sessionId, s)
  }
  return s
}

export function appendTurn(state: ConversationState, turn: ConversationTurn): void {
  state.history.push(turn)
  if (state.history.length > MAX_TURNS) {
    state.history = state.history.slice(-MAX_TURNS)
  }
}

export function buildContext(state: ConversationState): { summaryHistory: string[] } {
  return {
    summaryHistory: state.history.map((t) => `${t.role}: ${t.content}`),
  }
}
