// SSE 客户端解析：手写 fetch reader，把服务端推送的 SSE 流拼成完整 JSONL 文本。

/**
 * 发起 SSE 请求，返回拼好的完整 JSONL。
 * 注意 SSE 规范细节：
 *   - 多个 data: 行用 \n 连接
 *   - 只去掉一个前导空格，不能 trim——chunk 首尾的空格可能是 JSON 字符串内容
 *   - 用 null 作「尚无 data 行」的哨兵，区分「空 data」与「无 data」
 */
export async function fetchSSE(url: string, payload: Record<string, unknown>): Promise<string> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.body) throw new Error('无响应体')
  
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const evt of events) {
      const lines = evt.split('\n')
      let event = 'message'
      let data: string | null = null
      for (const line of lines) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const piece = line.slice(5).replace(/^ /, '')
          data = data === null ? piece : data + '\n' + piece
        }
      }
      if (event === 'message') {
        full += data ?? ''
      } else if (event === 'error') {
        throw new Error(data ?? '未知错误')
      }
    }
  }
  return full
}
