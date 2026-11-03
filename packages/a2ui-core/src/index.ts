import { A2UIBuffer } from './buffer'
import { parseLine } from './parser'
import { A2UIStore } from './store'
import { TreeBuilder, type TreeNode } from './treebuilder'
import type { A2UIMessage } from './types'

export * from './types'
export { A2UIBuffer } from './buffer'
export { parseLine } from './parser'
export { A2UIStore, type VNode } from './store'
export { TreeBuilder, type TreeNode } from './treebuilder'

// 组装 store + buffer + treeBuilder 为一个运行时。
export function createA2UI() {
  const store = new A2UIStore()
  const buffer = new A2UIBuffer()
  const treeBuilder = new TreeBuilder(store)

  return {
    store,
    buffer,
    treeBuilder,

    // 喂入 SSE chunk：Buffer 拼包 → Parser 解析 → Store 更新。
    feed(chunk: string): A2UIMessage[] {
      const messages: A2UIMessage[] = []
      for (const line of buffer.push(chunk)) {
        const msg = parseLine(line)
        if (!msg) continue
        applyMessage(store, msg)
        messages.push(msg)
      }
      return messages
    },

    end(): A2UIMessage[] {
      const messages: A2UIMessage[] = []
      for (const line of buffer.flush()) {
        const msg = parseLine(line)
        if (!msg) continue
        applyMessage(store, msg)
        messages.push(msg)
      }
      return messages
    },

    buildTrees(): Map<string, TreeNode | null> {
      return treeBuilder.build()
    },

    buildTree(surfaceId: string): TreeNode | null {
      return treeBuilder.buildSingle(surfaceId)
    },
  }
}

function applyMessage(store: A2UIStore, msg: A2UIMessage) {
  switch (msg.type) {
    case 'createSurface':
      store.createSurface(msg.surfaceId, (msg as { catalogId?: string }).catalogId ?? '0.9')
      break
    case 'surfaceUpdate':
      for (const def of msg.components) store.upsertComponent(msg.surfaceId, def)
      break
    case 'dataModelUpdate':
      store.updateDataModel(msg.surfaceId, msg.path, msg.value)
      break
    case 'beginRendering':
      store.setReady(msg.surfaceId, msg.root)
      break
    case 'deleteSurface':
      store.deleteSurface(msg.surfaceId)
      break
  }
}
