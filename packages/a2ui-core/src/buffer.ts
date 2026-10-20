// Buffer：JSONL 流式拼包，判断「何时凑成一条完整消息」。
// chunk 是任意字符片段：一条消息可能跨多个 chunk，一个 chunk 也可能含多条消息。
// 职责：按 \n 切出完整行；半截行留在缓冲等下一个 chunk；
// 非法行直接丢弃（塞回缓冲会和后续 chunk 永远无法解析，造成死锁）。
// 协议规范性（围栏剥离、消息间换行）由服务端归一化器保证，
// Buffer 只做跨 chunk 拼包，不负责从无边界字符流中提取对象。

export class A2UIBuffer {
  private buf = ''

  /**
   * 接收一个 chunk，返回「已经凑完整的消息字符串数组」。
   * 不完整的部分留在内部缓冲，等下一个 chunk 继续拼。
   */
  push(chunk: string): string[] {
    this.buf += chunk
    const complete: string[] = []

    // 用换行符切分，最后一段（可能半截）留下
    let idx: number
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      const trimmed = line.trim()
      if (!trimmed) continue
      if (this.isComplete(trimmed)) {
        complete.push(trimmed)
      } else {
        // 不是合法 JSON：可能是漏过服务端归一化的围栏等垃圾行，直接丢弃。
        // 不能塞回 buffer，否则该行和后续 chunk 永远无法解析（死锁）。
        console.warn('[A2UIBuffer] 丢弃非法 JSON 行:', trimmed.slice(0, 50))
      }
    }

    // 剩余 buffer 可能已是一条完整 JSON（最后一行无尾换行），也吐出来
    if (this.buf && this.isComplete(this.buf.trim())) {
      complete.push(this.buf.trim())
      this.buf = ''
    }

    return complete
  }

  /** 结束时强制吐出剩余缓冲（仍须是合法 JSON，否则丢弃） */
  flush(): string[] {
    const rest = this.buf.trim()
    this.buf = ''
    if (!rest) return []
    if (this.isComplete(rest)) return [rest]
    console.warn('[A2UIBuffer] 结束时丢弃非法片段:', rest.slice(0, 50))
    return []
  }

  /** 判断一个字符串是否是一条完整可解析的 JSON */
  private isComplete(s: string): boolean {
    try {
      JSON.parse(s)
      return true
    } catch {
      return false
    }
  }
}
