/**
 * 组件差异计算与应用
 * 用于增量修改场景：对比新旧组件集合，只 apply 变化部分，避免整树重建导致输入框等状态丢失。
 */

import type { ComponentDef } from '@a2ui/core'

/** 差异操作类型：新增 / 删除 / 更新 */
export type DiffOp =
  | { type: 'add'; component: ComponentDef }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; component: ComponentDef }

/**
 * 对比新旧组件 Map，产出差异操作列表。
 * - newMap 中有而 oldMap 中没有 → add
 * - 双方都有但内容不同 → update
 * - oldMap 中有而 newMap 中没有 → remove
 */
export function generateDiff(
  oldMap: Map<string, ComponentDef>,
  newMap: Map<string, ComponentDef>,
): DiffOp[] {
  const ops: DiffOp[] = []

  // 遍历新集合，找出新增和更新的组件
  for (const [id, newDef] of newMap) {
    const oldDef = oldMap.get(id)
    if (!oldDef) {
      ops.push({ type: 'add', component: newDef })
    } else if (!deepEqual(oldDef, newDef)) {
      ops.push({ type: 'update', id, component: newDef })
    }
  }

  // 遍历旧集合，找出被删除的组件
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      ops.push({ type: 'remove', id })
    }
  }

  return ops
}

/** 深比较：通过 JSON 序列化比较两个对象是否相等（简单有效） */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 将差异操作应用到 store。
 * add 和 update 都调用 upsertComponent（插入或更新），remove 调用 deleteComponent。
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
