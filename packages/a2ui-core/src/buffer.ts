/**
 * JSONL 流式缓冲器
 * LLM 流式输出是任意字符片段（chunk），一条 JSON 消息可能被拆成多个 chunk，
 * 也可能一个 chunk 包含多条消息。Buffer 负责按换行切出完整 JSON 行。
 */

export class A2UIBuffer {
  /** 内部缓冲区，存储尚未形成完整行的字符 */
  private buf = ''

  /**
   * 喂入一个 chunk，返回其中包含的完整 JSON 行列表。
   * 半截行（无尾换行）会留在缓冲区，等待下一个 chunk 拼接。
   */
  push(chunk: string): string[] {
    this.buf += chunk
    const complete: string[] = []

    // 循环切出所有以换行结尾的完整行
    let idx: number
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      const trimmed = line.trim()
      if (!trimmed) continue  // 跳过空行
      if (this.isComplete(trimmed)) {
        complete.push(trimmed)
      } else {
        // 非法行直接丢弃，不能塞回 buffer，否则后续 chunk 永远无法解析。
        console.warn('[A2UIBuffer] 丢弃非法 JSON 行:', trimmed.slice(0, 50))
      }
    }

    // 最后一行可能无尾换行，如果已经是完整 JSON 也吐出。
    if (this.buf && this.isComplete(this.buf.trim())) {
      complete.push(this.buf.trim())
      this.buf = ''
    }

    return complete
  }

  /**
   * 流结束时调用，尝试解析缓冲区剩余内容。
   * 如果剩余内容是完整 JSON 则返回，否则丢弃。
   */
  flush(): string[] {
    const rest = this.buf.trim()
    this.buf = ''
    if (!rest) return []
    if (this.isComplete(rest)) return [rest]
    console.warn('[A2UIBuffer] 结束时丢弃非法片段:', rest.slice(0, 50))
    return []
  }

  /** 判断字符串是否为合法 JSON（通过尝试解析） */
  private isComplete(s: string): boolean {
    try {
      JSON.parse(s)
      return true
    } catch {
      return false
    }
  }
}
