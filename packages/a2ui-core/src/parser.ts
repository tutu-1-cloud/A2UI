// Parser：把一条完整 JSONL 行解析为结构化 A2UI 消息。
// 按 type 字段分发识别 5 种消息（比字段存在性判断更可靠）；
// 坏行（非法 JSON / 未知类型）返回 null，不抛异常、不中断流。

import type { A2UIMessage, ComponentDef } from './types'

export function parseLine(line: string): A2UIMessage | null {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }

  if (typeof obj !== 'object' || obj === null) return null

  const type = obj.type as string | undefined
  const surfaceId = String(obj.surfaceId ?? '')

  switch (type) {
    case 'createSurface':
      return {
        type: 'createSurface',
        surfaceId,
        catalogId: obj.catalogId as string | undefined,
      }
    case 'surfaceUpdate':
      return {
        type: 'surfaceUpdate',
        surfaceId,
        components: (obj.components as ComponentDef[]) ?? [],
      }
    case 'dataModelUpdate':
      return {
        type: 'dataModelUpdate',
        surfaceId,
        path: obj.path as string | undefined,
        value: obj.value,
      }
    case 'beginRendering':
      return {
        type: 'beginRendering',
        surfaceId,
        root: String(obj.root ?? ''),
      }
    case 'deleteSurface':
      return { type: 'deleteSurface', surfaceId }
    default:
      return null
  }
}
