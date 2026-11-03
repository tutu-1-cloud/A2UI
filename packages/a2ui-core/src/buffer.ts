// JSONL 流式缓冲：按换行切出完整行，半截行留到下个 chunk 继续拼。

export class A2UIBuffer {
  private buf = ''

  push(chunk: string): string[] {
    this.buf += chunk
    const complete: string[] = []

    let idx: number
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      const trimmed = line.trim()
      if (!trimmed) continue
      if (this.isComplete(trimmed)) {
        complete.push(trimmed)
      } else {
        // 非法行直接丢弃，不能塞回 buffer，否则后续 chunk 永远无法解析。
        console.warn('[A2UIBuffer] 丢弃非法 JSON 行:', trimmed.slice(0, 50))
      }
    }

    // 最后一行可能无尾换行，已是完整 JSON 时也吐出。
    if (this.buf && this.isComplete(this.buf.trim())) {
      complete.push(this.buf.trim())
      this.buf = ''
    }

    return complete
  }

  flush(): string[] {
    const rest = this.buf.trim()
    this.buf = ''
    if (!rest) return []
    if (this.isComplete(rest)) return [rest]
    console.warn('[A2UIBuffer] 结束时丢弃非法片段:', rest.slice(0, 50))
    return []
  }

  private isComplete(s: string): boolean {
    try {
      JSON.parse(s)
      return true
    } catch {
      return false
    }
  }
}
