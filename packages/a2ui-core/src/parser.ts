/**
 * JSONL 行解析器
 * 将单条 JSON 字符串解析为结构化的 A2UIMessage 对象。
 * 解析失败或未知消息类型时返回 null，由调用方忽略。
 */

import type { A2UIMessage, ComponentDef } from './types'

export function parseLine(line: string): A2UIMessage | null {
  // 先尝试 JSON 解析，失败直接返回 null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }

  // 非对象类型（如字符串、数字）不是合法消息
  if (typeof obj !== 'object' || obj === null) return null

  const type = obj.type as string | undefined
  const surfaceId = String(obj.surfaceId ?? '')

  // 根据 type 字段分发到对应消息类型
  switch (type) {
    case 'createSurface':
      // 创建画布
      return { type: 'createSurface', surfaceId }
    case 'surfaceUpdate':
      // 批量更新组件定义
      return { type: 'surfaceUpdate', surfaceId, components: (obj.components as ComponentDef[]) ?? [] }
    case 'dataModelUpdate':
      // 更新数据模型（支持按路径更新或整体替换）
      return { type: 'dataModelUpdate', surfaceId, path: obj.path as string | undefined, value: obj.value }
    case 'beginRendering':
      // 标记画布就绪并指定根组件
      return { type: 'beginRendering', surfaceId, root: String(obj.root ?? '') }
    case 'deleteSurface':
      // 删除画布
      return { type: 'deleteSurface', surfaceId }
    default:
      // 未知消息类型，忽略
      return null
  }
}
