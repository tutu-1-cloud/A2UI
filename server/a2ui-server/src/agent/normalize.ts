// 协议归一化器（字符级流式）：剥离围栏/散文，对象内去空白，对象间补换行。

export interface ProtocolNormalizer {
  push: (chunk: string) => string
  flush: () => void
}

export function createProtocolNormalizer(): ProtocolNormalizer {
  let depth = 0
  let inString = false
  let escaped = false
  let needBoundary = false

  function push(chunk: string): string {
    let out = ''

    for (const c of chunk) {
      if (depth > 0) {
        // 对象内过滤格式化空白，否则客户端按 \n 切分会拆坏单个对象。
        if (!inString && (c === '\n' || c === '\r' || c === '\t' || c === ' ')) {
          continue
        }
        out += c
        if (inString) {
          if (escaped) escaped = false
          else if (c === '\\') escaped = true
          else if (c === '"') inString = false
          continue
        }
        if (c === '"') inString = true
        else if (c === '{' || c === '[') depth++
        else if (c === '}' || c === ']') {
          depth--
          if (depth === 0) needBoundary = true
        }
      } else {
        // 对象外只放行空白，围栏/散文丢弃。
        if (c === '{') {
          if (needBoundary) out += '\n'
          out += c
          depth = 1
          inString = false
          escaped = false
          needBoundary = false
        } else if (c === '\n' || c === '\r') {
          out += c
          needBoundary = false
        } else if (c === ' ' || c === '\t') {
          out += c
        }
      }
    }

    return out
  }

  function flush() {
    if (depth > 0) {
      console.warn('[normalizer] 流结束时对象未闭合，已透传的半截 JSON 将被客户端丢弃')
    }
  }

  return { push, flush }
}

// 完整协议必须同时含 surfaceUpdate 与 beginRendering，拦截只吐补丁的情况。
export function isCompleteProtocol(text: string): boolean {
  return text.includes('"surfaceUpdate"') && text.includes('"beginRendering"')
}
