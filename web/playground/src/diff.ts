import type { ComponentDef } from '@a2ui/core'

export type DiffOp =
  | { type: 'add'; component: ComponentDef }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; component: ComponentDef }

// 对比新旧组件集合，产出 add/remove/update 操作。
export function generateDiff(
  oldMap: Map<string, ComponentDef>,
  newMap: Map<string, ComponentDef>,
): DiffOp[] {
  const ops: DiffOp[] = []

  for (const [id, newDef] of newMap) {
    const oldDef = oldMap.get(id)
    if (!oldDef) {
      ops.push({ type: 'add', component: newDef })
    } else if (!deepEqual(oldDef, newDef)) {
      ops.push({ type: 'update', id, component: newDef })
    }
  }

  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      ops.push({ type: 'remove', id })
    }
  }

  return ops
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// 只应用变化部分，避免整树重建丢状态。
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
