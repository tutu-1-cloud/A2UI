// AGUI 传输层事件包装：message / error / done。

export type AGUIEventType = 'message' | 'error' | 'done'

export interface AGUIError {
  code: string
  message: string
  details?: unknown
}

export function formatAGUIEvent(
  event: AGUIEventType,
  data: unknown,
  id?: string,
): string {
  let s = `event: ${event}\n`
  if (id) s += `id: ${id}\n`
  // data 是字符串（JSONL 片段）时直接透传，不能 stringify，否则会加引号转义。
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  // SSE 规范：data 含换行须拆成多行 data: 前缀。
  s += body.split('\n').map((line) => `data: ${line}`).join('\n')
  s += '\n\n'
  return s
}

export function formatAGUIError(code: string, message: string, details?: unknown): string {
  const err: AGUIError = { code, message, details }
  return formatAGUIEvent('error', err)
}
