/**
 * SSE 流式请求工具
 * 向后端发送 POST 请求，读取 SSE 流并拼接完整 JSONL 返回。
 * 支持 message / error / done 三种 SSE 事件类型。
 */

/**
 * 发送 SSE 请求并返回拼接后的完整 JSONL 文本。
 * @param url 请求地址
 * @param payload 请求体
 * @returns 完整 JSONL 字符串
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
  let buffer = ''   // 未完成的 SSE 事件缓冲
  let full = ''     // 累积的完整 JSONL

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 事件以双换行分隔
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''  // 最后一段可能不完整，留待下次拼接

    for (const evt of events) {
      const lines = evt.split('\n')
      let event = 'message'
      let data: string | null = null
      // 解析 event: 和 data: 行
      for (const line of lines) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          // 去掉 data: 后的一个前导空格（SSE 规范）
          const piece = line.slice(5).replace(/^ /, '')
          // 多个 data: 行用 \n 连接
          data = data === null ? piece : data + '\n' + piece
        }
      }
      if (event === 'message') {
        full += data ?? ''
      } else if (event === 'error') {
        throw new Error(data ?? '未知错误')
      }
      // done 事件无需特殊处理，流结束时循环退出
    }
  }
  return full
}
