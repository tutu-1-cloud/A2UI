/**
 * SSE 传输层：设置 Server-Sent Events 响应头、写入数据、结束连接。
 */

import type { Context } from 'koa'

/**
 * 初始化 SSE 响应：设置必要的响应头并刷新。
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache（禁用代理缓存）
 * - Connection: keep-alive（长连接）
 * - X-Accel-Buffering: no（禁用 Nginx 缓冲）
 */
export function sseStart(ctx: Context) {
  ctx.status = 200
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no')
  ctx.res.flushHeaders?.()
}

/** 写入 SSE 数据到响应流 */
export function sseWrite(ctx: Context, payload: string) {
  ctx.res.write(payload)
}

/** 结束 SSE 响应流 */
export function sseEnd(ctx: Context) {
  ctx.res.end()
}
