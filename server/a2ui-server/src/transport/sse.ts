import type { Context } from 'koa'

export function sseStart(ctx: Context) {
  ctx.status = 200
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no')
  ctx.res.flushHeaders?.()
}

export function sseWrite(ctx: Context, payload: string) {
  ctx.res.write(payload)
}

export function sseEnd(ctx: Context) {
  ctx.res.end()
}
