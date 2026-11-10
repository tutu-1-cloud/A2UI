/**
 * 协议快照构建
 * 将当前 store 状态反推为 A2UI 协议 JSONL，随请求传给 Agent 作为增量修改的底稿。
 */

import type { A2UIStore } from '@a2ui/core'

/**
 * 构建 store 的协议快照（JSONL 格式）。
 * 依次输出 surfaceUpdate（全部组件）、beginRendering（根组件）、dataModelUpdate（数据模型）。
 */
export function buildSnapshot(store: A2UIStore): string {
  const lines: string[] = []

  for (const [surfaceId, surface] of store.surfaces) {
    const components = Array.from(surface.components.values())
    // 有组件时输出 surfaceUpdate
    if (components.length > 0) {
      lines.push(JSON.stringify({ type: 'surfaceUpdate', surfaceId, components }))
    }
    // 有根组件时输出 beginRendering
    if (surface.rootId) {
      lines.push(JSON.stringify({ type: 'beginRendering', surfaceId, root: surface.rootId }))
    }
    // 有数据模型时输出 dataModelUpdate（path 为 / 表示整体替换）
    if (surface.dataModel && Object.keys(surface.dataModel).length > 0) {
      lines.push(
        JSON.stringify({ type: 'dataModelUpdate', surfaceId, path: '/', value: surface.dataModel }),
      )
    }
  }

  return lines.join('\n')
}
