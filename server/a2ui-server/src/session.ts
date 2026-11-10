/**
 * 会话管理：内存存储多轮对话历史。
 * 每个 sessionId 对应一个 ConversationState，记录用户/助手轮次。
 * 超过 MAX_TURNS 时自动截断，保留最近的对话。
 */

/** 单轮对话记录 */
export interface ConversationTurn {
  turnId: number                                            // 轮次 id
  role: 'user' | 'assistant'                                // 角色
  content: string                                           // 内容文本
  timestamp: number                                         // 时间戳
  a2uiSnapshot?: unknown                                    // A2UI 协议快照（可选）
  modificationType?: 'initial' | 'refine' | 'element_edit'  // 修改类型
  modifiedElements?: string[]                               // 被修改的组件 id 列表
}

/** 会话状态 */
export interface ConversationState {
  sessionId: string                                // 会话 id
  history: ConversationTurn[]                      // 对话历史轮次
  stylePreferences?: Record<string, unknown>       // 样式偏好（可选）
}

/** 最大保留轮次数，超出后截断旧轮次 */
export const MAX_TURNS = 10

/** 会话存储（内存 Map，重启后丢失） */
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

/** 追加一轮对话，超过 MAX_TURNS 时保留最近的轮次 */
export function appendTurn(state: ConversationState, turn: ConversationTurn): void {
  state.history.push(turn)
  if (state.history.length > MAX_TURNS) {
    state.history = state.history.slice(-MAX_TURNS)
  }
}

/** 构建对话历史摘要，用于拼入 LLM prompt */
export function buildContext(state: ConversationState): { summaryHistory: string[] } {
  return {
    summaryHistory: state.history.map((t) => `${t.role}: ${t.content}`),
  }
}
