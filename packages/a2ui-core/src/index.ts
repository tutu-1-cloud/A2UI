// @a2ui/core 装配入口：把 Buffer / Parser / A2UIStore / TreeBuilder
// 组合成 createA2UI() 一个对外 API，feed(chunk) 完成拼包 → 解析 → 应用。

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

/** 初始化一个 A2UI 运行时（一个 store + 一个 buffer + 一个 treeBuilder） */
export function createA2UI() {
  const store = new A2UIStore()
  const buffer = new A2UIBuffer()
  const treeBuilder = new TreeBuilder(store)

  return {
    store,
    buffer,
    treeBuilder,

    /**
     * 喂入一个原始 chunk（来自 SSE），
     * 内部完成：Buffer 拼包 → Parser 解析 → A2UIStore 更新。
     */
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

    /** 流结束时调用，吐出剩余缓冲 */
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

    /** 建树：返回所有 surface 的根节点 Map（供渲染层调用） */
    buildTrees(): Map<string, TreeNode | null> {
      return treeBuilder.build()
    },

    /** 建单 surface 树（兼容旧调用） */
    buildTree(surfaceId: string): TreeNode | null {
      return treeBuilder.buildSingle(surfaceId)
    },
  }
}

/** 把一条 A2UI 消息应用到 store */
function applyMessage(store: A2UIStore, msg: A2UIMessage) {
  switch (msg.type) {
    case 'createSurface':
      store.createSurface(msg.surfaceId, (msg as { catalogId?: string }).catalogId ?? '0.9')
      break
    case 'surfaceUpdate':
      for (const def of msg.components) {
        store.upsertComponent(msg.surfaceId, def)
      }
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
