/**
 * SSE 流式请求工具
 * 向后端发送 POST 请求，读取 SSE 流并拼接完整 JSONL 返回。
 * message 事件累积为协议文本；error 抛出；其余过程事件通过 onEvent 回调。
 */

/** 过程事件：Agent 可见性 */
export interface SSEEvent {
  event: string
  data: string
}

/** 解析一个 SSE 事件块：抽取 event 类型与多行 data */
function parseBlock(block: string): SSEEvent | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      // 去掉 data: 后的一个前导空格（SSE 规范）
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }

  return dataLines.length ? { event, data: dataLines.join('\n') } : null
}

/**
 * 发送 SSE 请求并返回拼接后的完整 JSONL 文本。
 * @param url 请求地址
 * @param payload 请求体
 * @param onEvent 过程事件回调（reasoning / thought / plan / tool_call / tool_result）
 * @returns 完整 JSONL 字符串
 */
export async function fetchSSE(
  url: string,
  payload: Record<string, unknown>,
  onEvent?: (evt: SSEEvent) => void,
): Promise<string> {
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
    // SSE 事件以双换行分隔，最后一段可能不完整留待下次拼接
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const evt = parseBlock(block)
      if (!evt) continue

      if (evt.event === 'message') {
        full += evt.data
      } else if (evt.event === 'error') {
        throw new Error(evt.data || '未知错误')
      } else if (evt.event !== 'done') {
        onEvent?.(evt)
      }
    }
  }

  return full
}
