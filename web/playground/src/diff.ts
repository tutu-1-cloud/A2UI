// 前端增量 diff：Agent 返回「完整新 A2UI」，对比新旧组件定义产出
// add / remove / update 操作列表，只更新变化的部分（未变组件复用 DOM，状态不丢）。

import type { ComponentDef } from '@a2ui/core'

export type DiffOp =
  | { type: 'add'; component: ComponentDef }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; component: ComponentDef }

/**
 * 对比新旧组件定义集合，返回增量操作列表。
 * 判据：
 *   - 新集合有、旧集合无 → add
 *   - 旧集合有、新集合无 → remove
 *   - 两者都有但内容不同 → update（深比较）
 *   - 两者都有且内容相同 → 不变（跳过）
 */
export function generateDiff(
  oldMap: Map<string, ComponentDef>,
  newMap: Map<string, ComponentDef>,
): DiffOp[] {
  const ops: DiffOp[] = []

  // add + update
  for (const [id, newDef] of newMap) {
    const oldDef = oldMap.get(id)
    if (!oldDef) {
      ops.push({ type: 'add', component: newDef })
    } else if (!deepEqual(oldDef, newDef)) {
      ops.push({ type: 'update', id, component: newDef })
    }
  }

  // remove
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      ops.push({ type: 'remove', id })
    }
  }

  return ops
}

/** 深比较两个组件定义（JSON 序列化比较，简单可靠） */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 把一组 DiffOp 应用到 store（指定 surface）。
 * 用于「只更新变化的部分」，避免整树重建。
 */
export function applyDiff(
  ops: DiffOp[],
  surfaceId: string,
  store: {
    upsertComponent: (surfaceId: string, def: ComponentDef) => void
    deleteComponent: (surfaceId: string, id: string) => void
  },
) {
  for (const op of ops) {
    switch (op.type) {
      case 'add':
      case 'update':
        store.upsertComponent(surfaceId, op.component)
        break
      case 'remove':
        store.deleteComponent(surfaceId, op.id)
        break
    }
  }
}
