import type { A2UIStore } from '@a2ui/core'

// 把当前 store 反推成协议快照（JSONL），随请求传给 Agent 作为修改底稿。
export function buildSnapshot(store: A2UIStore): string {
  const lines: string[] = []

  for (const [surfaceId, surface] of store.surfaces) {
    const components = Array.from(surface.components.values())
    if (components.length > 0) {
      lines.push(JSON.stringify({ type: 'surfaceUpdate', surfaceId, components }))
    }
    if (surface.rootId) {
      lines.push(JSON.stringify({ type: 'beginRendering', surfaceId, root: surface.rootId }))
    }
    if (surface.dataModel && Object.keys(surface.dataModel).length > 0) {
      lines.push(
        JSON.stringify({ type: 'dataModelUpdate', surfaceId, path: '/', value: surface.dataModel }),
      )
    }
  }

  return lines.join('\n')
}
