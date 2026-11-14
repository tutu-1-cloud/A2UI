/**
 * A2UI 运行时入口
 * 组装 Store + Buffer + TreeBuilder 为统一运行时，提供 feed/end/buildTrees 等高层 API。
 */

import { A2UIBuffer } from './buffer'
import { parseLine } from './parser'
import { A2UIStore } from './store'
import { TreeBuilder, type TreeNode } from './treebuilder'
import type { A2UIMessage } from './types'

// 统一导出所有公共类型和类
export * from './types'
export { A2UIStore, type VNode } from './store'
export { TreeBuilder, type TreeNode } from './treebuilder'

/**
 * 创建 A2UI 运行时实例。
 * 包含 store（状态）、buffer（流式拼包）、treeBuilder（树构建）。
 */
export function createA2UI() {
  const store = new A2UIStore()
  const buffer = new A2UIBuffer()
  const treeBuilder = new TreeBuilder(store)

  return {
    store,
    buffer,
    treeBuilder,

    /**
     * 喂入 SSE chunk：Buffer 拼包 → Parser 解析 → Store 更新。
     * 返回本次 chunk 中解析出的所有完整消息。
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

    /** 流结束时调用，刷新 buffer 中剩余的完整消息 */
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

    /** 构建所有画布的渲染树 */
    buildTrees(): Map<string, TreeNode | null> {
      return treeBuilder.build()
    },
  }
}

/**
 * 将单条协议消息应用到 store。
 * 根据消息类型分发到对应的 store 方法。
 */
function applyMessage(store: A2UIStore, msg: A2UIMessage) {
  switch (msg.type) {
    case 'createSurface':
      // 创建画布
      store.createSurface(msg.surfaceId)
      break
    case 'surfaceUpdate':
      // 批量插入/更新组件定义
      for (const def of msg.components) store.upsertComponent(msg.surfaceId, def)
      break
    case 'dataModelUpdate':
      // 更新数据模型（按路径或整体）
      store.updateDataModel(msg.surfaceId, msg.path, msg.value)
      break
    case 'beginRendering':
      // 标记画布就绪并设置根组件
      store.setReady(msg.surfaceId, msg.root)
      break
    case 'deleteSurface':
      // 删除画布
      store.deleteSurface(msg.surfaceId)
      break
  }
}
