/**
 * 会话管理：内存存储多轮对话历史。
 * 每个 sessionId 对应一个 ConversationState，记录用户/助手轮次。
 * 超过 MAX_TURNS 时自动截断，保留最近的对话。
 */

/** 工具调用轨迹（用于让后续轮次知道上一步查过什么） */
export interface ToolTrace {
  name: string      // 工具名
  ok: boolean       // 是否成功
  result: string    // 结果摘要（截断）
}

/** 单轮对话记录 */
export interface ConversationTurn {
  turnId: number                 // 轮次 id
  role: 'user' | 'assistant'     // 角色
  content: string                // 内容文本
  timestamp: number              // 时间戳
  toolTraces?: ToolTrace[]       // 本轮调用的工具轨迹
}

/** 会话状态 */
export interface ConversationState {
  sessionId: string              // 会话 id
  history: ConversationTurn[]    // 对话历史轮次
}

/** 最大保留轮次数，超出后截断旧轮次 */
const MAX_TURNS = 10

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
export function buildHistory(state: ConversationState): string[] {
  return state.history.map((t) => {
    // 无工具轨迹时保持原样
    if (!t.toolTraces?.length) return `${t.role}: ${t.content}`
    const tools = t.toolTraces.map((x) => `${x.name}${x.ok ? '成功' : '失败'}`).join('、')
    return `${t.role}: ${t.content}（调用工具：${tools}）`
  })
}

/**
 * 重置会话：丢弃该 session 的全部对话历史。
 * 下次请求会读到空历史，避免旧上下文影响新一轮生成。
 */
export function resetSession(sessionId: string): void {
  sessions.delete(sessionId)
}
