/**
 * A2UI React 渲染层
 * 将 TreeBuilder 产出的 TreeNode 递归渲染为 React 元素。
 * 通过 rendersMap 实现"组件类型 → 渲染函数"的映射，可扩展新组件类型。
 */

import { createElement, type ReactElement, type CSSProperties as ReactCSSProperties } from 'react'
import type { TreeNode, ComponentAction } from '@a2ui/core'
import { mergeStyles } from './theme'

/** 渲染上下文：提供动作回调、数据变更回调、数据读取能力 */
type RenderCtx = {
  onAction?: (action: ComponentAction) => void       // 组件动作（点击等）回调
  onDataChange?: (componentId: string, value: unknown) => void  // Input 值变更回调
  getData?: (path: string) => unknown                 // 按路径读取数据模型
}

/** 渲染函数签名：接收树节点和上下文，返回 React 元素 */
type RenderFn = (node: TreeNode, ctx: RenderCtx) => ReactElement

/**
 * 生成 data-* 属性，供前端事件委托定位组件。
 * - data-component-id：组件唯一 id
 * - data-component-type：组件类型
 */
function dataAttrs(node: TreeNode): Record<string, string> {
  return {
    'data-component-id': node.id,
    'data-component-type': node.componentType,
  }
}

/** 组件类型 → 渲染函数的映射表，新增组件类型只需在此添加 */
export const rendersMap: Record<string, RenderFn> = {
  // 文本组件：优先显示数据绑定值，其次显示 props.text
  Text: (node, ctx) => {
    const text = resolveText(node, ctx)
    const style = mergeStyles(node.useHint, node.styles, { fontSize: '14px', lineHeight: '1.5' })
    return createElement(
      'span',
      { key: node.id, style: style as ReactCSSProperties, ...dataAttrs(node) },
      text,
    )
  },

  // 按钮组件：点击触发 onAction 回调
  Button: (node, ctx) => {
    const text = (node.props.text as string) ?? (node.props.label as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      padding: '8px 16px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
    })
    return createElement(
      'button',
      {
        key: node.id,
        style: style as ReactCSSProperties,
        ...dataAttrs(node),
        disabled: (node.props.disabled as boolean) ?? false,
        onClick: () => ctx.onAction?.({ componentId: node.id, action: 'click' }),
      },
      text,
    )
  },

  // 图片组件
  Image: (node) => {
    const source = (node.props.source as string) ?? ''
    const alt = (node.props.alt as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, { maxWidth: '100%' })
    return createElement('img', {
      key: node.id,
      style: style as ReactCSSProperties,
      ...dataAttrs(node),
      src: source,
      alt,
    })
  },

  // 输入框组件：非受控模式，onChange 只写数据模型不上报 action
  Input: (node, ctx) => {
    const placeholder = (node.props.placeholder as string) ?? ''
    const value = resolveBound(node, ctx, node.itemData) ?? (node.props.value as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      padding: '6px 10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px',
    })
    // 非受控输入框：用 defaultValue 只设初始值，避免 store 写入触发重渲染时输入框内容被重置
    const input = createElement('input', {
      key: node.id,
      style: style as ReactCSSProperties,
      ...dataAttrs(node),
      placeholder,
      defaultValue: value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        // 只回写数据模型，不触发后端重绘，避免输入框被替换导致内容丢失
        ctx.onDataChange?.(node.id, e.target.value)
      },
    })
    const label = (node.props.label as string) ?? ''
    if (label) {
      // 有 label 时用 label 包裹，包含 label 文字和输入框
      return createElement(
        'label',
        { key: `label-${node.id}`, ...dataAttrs(node) },
        createElement('span', null, label),
        input,
      )
    }
    return input
  },

  // 纵向容器：flex-direction: column
  Column: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 8
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'column',
      gap: `${gap}px`,
    })
    return createElement(
      'div',
      { key: node.id, style: style as ReactCSSProperties, ...dataAttrs(node) },
      ...renderChildren(node, ctx),
    )
  },

  // 横向容器：flex-direction: row
  Row: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 8
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'row',
      gap: `${gap}px`,
    })
    return createElement(
      'div',
      { key: node.id, style: style as ReactCSSProperties, ...dataAttrs(node) },
      ...renderChildren(node, ctx),
    )
  },

  // 卡片容器：带边框和内边距，可选标题
  Card: (node, ctx) => {
    const title = (node.props.title as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '12px',
    })
    const titleEl = title ? createElement('div', null, title) : null
    return createElement(
      'div',
      { key: node.id, style: style as ReactCSSProperties, ...dataAttrs(node) },
      titleEl,
      ...renderChildren(node, ctx),
    )
  },

  // 列表容器：flex-direction: column，子节点由 TreeBuilder 展开模板生成
  List: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 4
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'column',
      gap: `${gap}px`,
    })
    return createElement(
      'div',
      { key: node.id, style: style as ReactCSSProperties, ...dataAttrs(node) },
      ...renderChildren(node, ctx),
    )
  },
}

/** 递归渲染所有子节点，返回 React 元素数组 */
function renderChildren(node: TreeNode, ctx: RenderCtx): ReactElement[] {
  return node.children.map((child) => renderVNode(child, ctx))
}

/**
 * 渲染单个树节点。
 * 根据 componentType 查找渲染函数，未知类型渲染为占位 div。
 */
export function renderVNode(node: TreeNode, ctx: RenderCtx): ReactElement {
  const renderFn = rendersMap[node.componentType]
  return renderFn
    ? renderFn(node, ctx)
    : createElement('div', { key: node.id }, node.componentType)
}

/**
 * 解析 Text 组件显示内容。
 * 优先取数据绑定值，其次取 props.text。
 */
function resolveText(node: TreeNode, ctx: RenderCtx): string {
  const bound = resolveBound(node, ctx, node.itemData)
  if (bound != null) return String(bound)
  return (node.props.text as string) ?? ''
}

/**
 * 解析数据绑定值。
 * 优先从 List 注入的 itemData 取（按绑定路径首段匹配），再从 dataModel 取。
 */
function resolveBound(node: TreeNode, ctx: RenderCtx, itemData?: unknown): unknown {
  const binding = node.dataBinding
  if (!binding) return undefined
  // List 项：itemData 中可能包含绑定路径对应的值
  if (itemData != null && typeof itemData === 'object') {
    const key = binding.replace(/^\//, '').split('/')[0]
    if (key in (itemData as Record<string, unknown>)) {
      return (itemData as Record<string, unknown>)[key]
    }
  }
  // 非 List 项或 itemData 中无对应值：从 dataModel 读取
  return ctx.getData?.(binding)
}

/** 创建渲染上下文，提供给 renderVNode 使用 */
export function createRenderContext(opts?: {
  onAction?: (action: ComponentAction) => void
  onDataChange?: (componentId: string, value: unknown) => void
  getData?: (path: string) => unknown
}): RenderCtx {
  return {
    onAction: opts?.onAction,
    onDataChange: opts?.onDataChange,
    getData: opts?.getData,
  }
}
