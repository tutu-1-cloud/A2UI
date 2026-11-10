/**
 * 协议归一化器（字符级流式处理）
 * LLM 输出可能包含 markdown 围栏、散文解释、格式化空白等。
 * 归一化器逐字符扫描，剥离围栏/散文，对象内去空白，对象间补换行。
 */

export interface ProtocolNormalizer {
  push: (chunk: string) => string  // 喂入 chunk，返回归一化后的文本
  flush: () => void                // 流结束时调用，检查是否有未闭合对象
}

/**
 * 创建协议归一化器。
 * 使用深度计数器 depth 跟踪 JSON 对象/数组嵌套层级：
 * - depth > 0：在对象内部，过滤格式化空白（换行/回车/制表/空格），保留字符串内字符
 * - depth = 0：在对象外部，只放行 { 开始新对象和空白，丢弃围栏/散文
 */
export function createProtocolNormalizer(): ProtocolNormalizer {
  let depth = 0          // JSON 嵌套深度，0 表示对象外
  let inString = false   // 是否在字符串内
  let escaped = false    // 字符串内是否处于转义状态
  let needBoundary = false  // 下一个对象前是否需要补换行

  function push(chunk: string): string {
    let out = ''

    for (const c of chunk) {
      if (depth > 0) {
        // 对象内：过滤格式化空白，否则客户端按 \n 切分会拆坏单个对象
        if (!inString && (c === '\n' || c === '\r' || c === '\t' || c === ' ')) {
          continue
        }
        out += c
        // 字符串状态机：处理转义和引号
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
          // 对象闭合后，下一个对象前需要补换行
          if (depth === 0) needBoundary = true
        }
      } else {
        // 对象外：只放行 { 开始新对象，其余（围栏/散文）丢弃
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
    // 流结束时若仍有未闭合对象，警告并丢弃（客户端 Buffer 也会丢弃非法 JSON）
    if (depth > 0) {
      console.warn('[normalizer] 流结束时对象未闭合，已透传的半截 JSON 将被客户端丢弃')
    }
  }

  return { push, flush }
}

/**
 * 判断协议是否完整：必须同时包含 surfaceUpdate 和 beginRendering。
 * 用于拦截 LLM 只吐 dataModelUpdate 补丁的情况。
 */
export function isCompleteProtocol(text: string): boolean {
  return text.includes('"surfaceUpdate"') && text.includes('"beginRendering"')
}
