/**
 * AGUI 传输层事件包装：将数据格式化为 SSE 规范的 event/data 格式。
 * message 承载协议内容，error / done 表示流状态，thought / tool_call / tool_result 描述 Agent 过程。
 */

/** SSE 事件类型 */
export type AGUIEventType =
  | 'message'      // A2UI 协议增量
  | 'reasoning'    // 模型思考过程（流式片段）
  | 'thought'      // Agent 思考文本
  | 'plan'         // 任务计划
  | 'tool_call'    // 开始调用工具
  | 'tool_result'  // 工具返回结果
  | 'error'
  | 'done'

/** 错误对象结构 */
export interface AGUIError {
  code: string        // 错误码
  message: string     // 错误信息
}

/**
 * 格式化 SSE 事件。
 * 遵循 SSE 规范：
 * - 以 event: 开头指定事件类型
 * - data 含换行时拆成多行 data: 前缀
 * - 以双换行结尾
 * data 为字符串时直接透传（如 JSONL 片段），不 stringify 避免加引号转义
 */
export function formatAGUIEvent(
  event: AGUIEventType,
  data: unknown,
  id?: string,
): string {
  let s = `event: ${event}\n`
  if (id) s += `id: ${id}\n`
  // data 是字符串（JSONL 片段）时直接透传，不能 stringify，否则会加引号转义
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  // SSE 规范：data 含换行须拆成多行 data: 前缀
  s += body.split('\n').map((line) => `data: ${line}`).join('\n')
  s += '\n\n'
  return s
}

/** 格式化错误事件 */
export function formatAGUIError(code: string, message: string): string {
  const err: AGUIError = { code, message }
  return formatAGUIEvent('error', err)
}
