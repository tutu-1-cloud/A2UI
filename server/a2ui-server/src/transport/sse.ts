// SSE 底层写流：响应头设置 / 裸写 / 结束。业务格式化统一走 protocol.ts。

import type { Context } from 'koa'

/** 开始一个 SSE 响应：设置响应头，保持连接 */
export function sseStart(ctx: Context) {
  ctx.status = 200
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
  // 主动 flush 头
  ctx.res.flushHeaders?.()
}

/** 写一段原始 SSE 字符串（已经过 protocol 格式化） */
export function sseWrite(ctx: Context, payload: string) {
  ctx.res.write(payload)
}

/** 结束 SSE 响应 */
export function sseEnd(ctx: Context) {
  ctx.res.end()
}
