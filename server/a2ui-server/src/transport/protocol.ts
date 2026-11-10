/**
 * AGUI 传输层事件包装：将数据格式化为 SSE 规范的 event/data 格式。
 * 支持 message / error / done 三种事件类型。
 */

/** SSE 事件类型 */
export type AGUIEventType = 'message' | 'error' | 'done'

/** 错误对象结构 */
export interface AGUIError {
  code: string        // 错误码
  message: string     // 错误信息
  details?: unknown   // 错误详情
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
export function formatAGUIError(code: string, message: string, details?: unknown): string {
  const err: AGUIError = { code, message, details }
  return formatAGUIEvent('error', err)
}
