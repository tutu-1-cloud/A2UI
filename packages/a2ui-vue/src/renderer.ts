// @a2ui/vue 渲染层：把 core 的 VNode 树用 Vue 渲染函数 h() 渲染成 DOM。
// 核心：rendersMap（组件类型 → 渲染函数）+ 递归 renderVNode。
// :key = vnode.id，保证增量 diff 时未变组件复用（输入框状态不丢）。
// 样式优先级 styles > useHint > 默认；事件经 ctx.onAction 上报，
// 输入经 ctx.onDataChange 回写数据绑定。

import { h, type VNode as VueVNode } from 'vue'
import type { TreeNode, ComponentAction } from '@a2ui/core'
import { mergeStyles } from './theme'

type RenderCtx = {
  /** 组件交互事件回调（点击/提交/输入） */
  onAction?: (action: ComponentAction) => void
  /** 双向绑定写侧：Input 值变化时回写数据模型 */
  onDataChange?: (componentId: string, value: unknown) => void
}

/** 每个组件类型的渲染函数 */
type RenderFn = (node: TreeNode, ctx: RenderCtx) => VueVNode

/** 给元素打 data 属性（元素定位用） */
function dataAttrs(node: TreeNode): Record<string, string> {
  return {
    'data-component-id': node.id,
    'data-component-type': node.componentType,
    'data-use-hint': node.useHint ? JSON.stringify(node.useHint) : '{}',
  }
}

/** 组件类型 → 渲染函数 的映射表（依赖注入，可扩展）。 */
export const rendersMap: Record<string, RenderFn> = {
  // ---- 原子组件 ----

  Text: (node) => {
    const text = resolveText(node)
    const style = mergeStyles(node.useHint, node.styles, {
      fontSize: '14px',
      lineHeight: '1.5',
    })
    return h('span', { key: node.id, class: 'a2ui-text', style, ...dataAttrs(node) }, text)
  },

  Button: (node, ctx) => {
    const text = (node.props.text as string) ?? (node.props.label as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      padding: '8px 16px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
    })
    return h(
      'button',
      {
        key: node.id,
        class: 'a2ui-button',
        style,
        ...dataAttrs(node),
        disabled: (node.props.disabled as boolean) ?? false,
        onClick: () => ctx.onAction?.({ componentId: node.id, action: 'click' }),
      },
      text,
    )
  },

  Image: (node) => {
    const source = (node.props.source as string) ?? ''
    const alt = (node.props.alt as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, { maxWidth: '100%' })
    return h('img', { key: node.id, class: 'a2ui-image', style, ...dataAttrs(node), src: source, alt })
  },

  Input: (node, ctx) => {
    const placeholder = (node.props.placeholder as string) ?? ''
    const value = resolveBound(node, node.itemData) ?? (node.props.value as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      padding: '6px 10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px',
    })
    const input = h('input', {
      key: node.id,
      class: 'a2ui-input',
      style,
      ...dataAttrs(node),
      placeholder,
      value,
      onInput: (e: Event) => {
        const val = (e.target as HTMLInputElement).value
        // 双向绑定写侧：只回写数据，不上报 action。
        // 否则每敲一个键都会触发 /api/action 重绘，输入框被替换、内容丢失。
        ctx.onDataChange?.(node.id, val)
      },
    })
    // 有 label 时包一层
    const label = (node.props.label as string) ?? ''
    if (label) {
      return h('label', { key: `label-${node.id}`, class: 'a2ui-input-wrap', ...dataAttrs(node) }, [
        h('span', { class: 'a2ui-input-label' }, label),
        input,
      ])
    }
    return input
  },

  // ---- 容器组件 ----

  Column: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 8
    const style = mergeStyles(
      node.useHint,
      node.styles,
      { display: 'flex', flexDirection: 'column' as const, gap: `${gap}px` },
    )
    return h('div', { key: node.id, class: 'a2ui-column', style, ...dataAttrs(node) }, renderChildren(node, ctx))
  },

  Row: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 8
    const style = mergeStyles(
      node.useHint,
      node.styles,
      { display: 'flex', flexDirection: 'row' as const, gap: `${gap}px` },
    )
    return h('div', { key: node.id, class: 'a2ui-row', style, ...dataAttrs(node) }, renderChildren(node, ctx))
  },

  Card: (node, ctx) => {
    const title = (node.props.title as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '12px',
    })
    const titleEl = title ? h('div', { class: 'a2ui-card-title' }, title) : null
    return h(
      'div',
      { key: node.id, class: 'a2ui-card', style, ...dataAttrs(node) },
      [titleEl, renderChildren(node, ctx)],
    )
  },

  List: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 4
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: `${gap}px`,
    })
    return h('div', { key: node.id, class: 'a2ui-list', style, ...dataAttrs(node) }, renderChildren(node, ctx))
  },
}

/** 递归渲染子节点 */
function renderChildren(node: TreeNode, ctx: RenderCtx): VueVNode[] {
  return node.children.map((child) => renderVNode(child, ctx))
}

/** 递归渲染单个 VNode */
export function renderVNode(node: TreeNode, ctx: RenderCtx): VueVNode {
  const renderFn = rendersMap[node.componentType]
  return renderFn
    ? renderFn(node, ctx)
    : // 未知组件类型：渲染一个占位，避免崩溃
      h('div', { key: node.id, class: 'a2ui-unknown' }, node.componentType)
}

/** 解析 Text 的文本：优先 dataBinding 绑定的数据，其次 props.text */
function resolveText(node: TreeNode): string {
  const bound = resolveBound(node, node.itemData)
  if (bound != null) return String(bound)
  return (node.props.text as string) ?? ''
}

/**
 * 解析 dataBinding：仅从 itemData（List 展开时注入的当前项）取值。
 * 若 itemData 存在且 binding 首段（如 /name → name）是 itemData 的键，返回对应值；
 * 否则返回 undefined，由调用方回退到 props 默认值。
 */
function resolveBound(node: TreeNode, itemData?: unknown): unknown {
  const binding = node.dataBinding
  if (!binding) return undefined
  if (itemData != null && typeof itemData === 'object') {
    const key = binding.replace(/^\//, '').split('/')[0]
    if (key in (itemData as Record<string, unknown>)) {
      return (itemData as Record<string, unknown>)[key]
    }
  }
  return undefined
}

/** 创建渲染上下文 */
export function createRenderContext(opts?: {
  onAction?: (action: ComponentAction) => void
  onDataChange?: (componentId: string, value: unknown) => void
}): RenderCtx {
  return { onAction: opts?.onAction, onDataChange: opts?.onDataChange }
}
