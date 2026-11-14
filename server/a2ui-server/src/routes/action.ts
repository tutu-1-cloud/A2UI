/**
 * /api/action 路由处理：组件交互动作。
 * 将按钮点击等动作转为文本指令（如 "[组件事件] click @btn1"），走同一生成链路。
 */

import type { Context } from 'koa'
import type { ElementReference } from '@a2ui/core'
import { handleGeneration } from './generate'

export async function actionHandler(ctx: Context) {
  const body = (ctx.request.body ?? {}) as {
    sessionId?: string
    action?: { componentId: string; action: string; payload?: unknown }
    selectedElement?: ElementReference
    currentProtocol?: unknown
  }

  // 将组件动作转为文本指令，如 "[组件事件] click @btn1"
  const actionText = body.action
    ? `[组件事件] ${body.action.action} @${body.action.componentId}`
    : '[组件事件]'

  await handleGeneration(ctx, {
    sessionId: body.sessionId ?? 'default',
    text: actionText,
    currentProtocol: body.currentProtocol,
    selectedElement: body.selectedElement,
  })
}
