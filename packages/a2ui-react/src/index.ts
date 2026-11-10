/**
 * A2UI React 渲染层入口
 * 统一导出渲染函数、主题工具和核心类型。
 */

export { rendersMap, renderVNode, createRenderContext } from './renderer'
export { useHintToCss, mergeStyles } from './theme'
export type { TreeNode } from '@a2ui/core'
