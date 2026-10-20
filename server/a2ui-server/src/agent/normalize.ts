// 协议归一化器（流式，字符级状态机）。
// LLM 的 chunk 逐 token 到达，内容经常不守 JSONL 规范：
// ```json 围栏包裹、对象间漏写换行（}{ 相连）、对象外夹杂散文。
// 在「逐 chunk 透传」的前提下做归一化：
//   1. 对象之外只放行空白，围栏/散文一律丢弃
//   2. 对象结束后未见换行就开始新对象时，自动补一个 \n
//   3. 对象之内过滤格式化空白（字符串内的字符原样透传）
// 不缓冲、不等待完整消息，半截对象照常透传，由客户端 Buffer 跨 chunk 拼包。

export interface ProtocolNormalizer {
  /** 处理一个原始 chunk，返回归一化后的字符串（可能为空串） */
  push: (chunk: string) => string
  /** 流结束回调：异常未闭合时给警告，无内容产出 */
  flush: () => void
}

export function createProtocolNormalizer(): ProtocolNormalizer {
  let depth = 0 // 0=对象外；>0=对象/数组嵌套深度
  let inString = false
  let escaped = false
  // 对象结束后、下一个对象开始前是否需要补换行
  let needBoundary = false

  function push(chunk: string): string {
    let out = ''

    for (const c of chunk) {
      if (depth > 0) {
        // ---- 对象内：过滤格式化空白（换行/制表/空格），字符串内除外 ----
        // LLM 常输出带缩进的格式化 JSON，若透传换行符，客户端 Buffer
        // 按 \n 切分会把单个对象拆成多行非法 JSON，导致全部丢弃。
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
        if (c === '"') {
          inString = true
        } else if (c === '{' || c === '[') {
          depth++
        } else if (c === '}' || c === ']') {
          depth--
          if (depth === 0) needBoundary = true
        }
      } else {
        // ---- 对象外：空白放行，其余（围栏/散文）丢弃 ----
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
        // 其余字符丢弃
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

/**
 * 完整协议判据：归一化后的文本必须同时包含 surfaceUpdate 与 beginRendering。
 * LLM 增量修改时可能只吐 dataModelUpdate 补丁，此判据用于拦截，
 * 防止补丁响应覆盖快照、经客户端 diff 后把界面清空。
 */
export function isCompleteProtocol(text: string): boolean {
  return text.includes('"surfaceUpdate"') && text.includes('"beginRendering"')
}
