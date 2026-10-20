// buildSnapshot：从 store 反推「当前界面完整协议」快照（JSONL）。
// 每次请求随传给 Agent 作为「在此基础上修改」的底稿——服务端以此前端
// 快照为准而非自己维护的 session 状态，避免前端本地数据更新（如 Input
// 回写）后两端状态漂移。输出可被 createA2UI().feed() 重新解析还原。

import type { A2UIStore } from '@a2ui/core'

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
    // dataModel 含本地回写（Input onDataChange），必须一并带上
    if (surface.dataModel && Object.keys(surface.dataModel).length > 0) {
      lines.push(
        JSON.stringify({ type: 'dataModelUpdate', surfaceId, path: '/', value: surface.dataModel }),
      )
    }
  }

  return lines.join('\n')
}
