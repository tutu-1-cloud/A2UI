// 传输层事件包装（与 A2UI 应用层分离）。
// 三种事件：message（A2UI 数据）/ error（传输层错误）/ done（结束）。
// 每条消息可带 id（预留给断点续传 Last-Event-ID，当前只产出 id）。

export type AGUIEventType = 'message' | 'error' | 'done'

/** 结构化传输层错误 */
export interface AGUIError {
  code: string
  message: string
  details?: unknown
}

/**
 * 把数据格式化为一条 SSE 消息字符串。
 * event 事件类型，data 消息体，id 可选消息序号。
 *
 * 注意：data 若是「字符串」（JSONL 片段），必须直接透传，
 * 不能再 JSON.stringify——否则会加引号并转义（`{"` → `"{\""`），
 * 前端拼出的就不是合法 JSONL，导致 parseLine 解析失败。
 * 只有对象（如 error/done）才 stringify。
 */
export function formatAGUIEvent(
  event: AGUIEventType,
  data: unknown,
  id?: string,
): string {
  let s = `event: ${event}\n`
  if (id) s += `id: ${id}\n`
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  // SSE 规范：data 含换行时必须拆成多个 data: 行，
  // 否则续行没有 data: 前缀，前端解析时会丢失，导致 JSONL 损坏。
  // （Mock 按 3 字符切片，chunk 必然跨 JSONL 行边界而携带 \n）
  s += body
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n')
  s += '\n\n'
  return s
}

/** 格式化结构化错误事件 */
export function formatAGUIError(
  code: string,
  message: string,
  details?: unknown,
): string {
  const err: AGUIError = { code, message, details }
  return formatAGUIEvent('error', err)
}
