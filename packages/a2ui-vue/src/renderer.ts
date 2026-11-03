import { h, type VNode as VueVNode } from 'vue'
import type { TreeNode, ComponentAction } from '@a2ui/core'
import { mergeStyles } from './theme'

type RenderCtx = {
  onAction?: (action: ComponentAction) => void
  onDataChange?: (componentId: string, value: unknown) => void
  getData?: (path: string) => unknown
}

type RenderFn = (node: TreeNode, ctx: RenderCtx) => VueVNode

function dataAttrs(node: TreeNode): Record<string, string> {
  return {
    'data-component-id': node.id,
    'data-component-type': node.componentType,
    'data-use-hint': node.useHint ? JSON.stringify(node.useHint) : '{}',
  }
}

export const rendersMap: Record<string, RenderFn> = {
  Text: (node, ctx) => {
    const text = resolveText(node, ctx)
    const style = mergeStyles(node.useHint, node.styles, { fontSize: '14px', lineHeight: '1.5' })
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
    const value = resolveBound(node, ctx, node.itemData) ?? (node.props.value as string) ?? ''
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
        // 只回写数据，不上报 action，否则每敲一键都会触发重绘导致输入框被替换。
        ctx.onDataChange?.(node.id, (e.target as HTMLInputElement).value)
      },
    })
    const label = (node.props.label as string) ?? ''
    if (label) {
      return h('label', { key: `label-${node.id}`, class: 'a2ui-input-wrap', ...dataAttrs(node) }, [
        h('span', { class: 'a2ui-input-label' }, label),
        input,
      ])
    }
    return input
  },

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

function renderChildren(node: TreeNode, ctx: RenderCtx): VueVNode[] {
  return node.children.map((child) => renderVNode(child, ctx))
}

export function renderVNode(node: TreeNode, ctx: RenderCtx): VueVNode {
  const renderFn = rendersMap[node.componentType]
  return renderFn
    ? renderFn(node, ctx)
    : h('div', { key: node.id, class: 'a2ui-unknown' }, node.componentType)
}

function resolveText(node: TreeNode, ctx: RenderCtx): string {
  const bound = resolveBound(node, ctx, node.itemData)
  if (bound != null) return String(bound)
  return (node.props.text as string) ?? ''
}

// 优先从 List 注入的 itemData 取，再从 dataModel 取。
function resolveBound(node: TreeNode, ctx: RenderCtx, itemData?: unknown): unknown {
  const binding = node.dataBinding
  if (!binding) return undefined
  if (itemData != null && typeof itemData === 'object') {
    const key = binding.replace(/^\//, '').split('/')[0]
    if (key in (itemData as Record<string, unknown>)) {
      return (itemData as Record<string, unknown>)[key]
    }
  }
  return ctx.getData?.(binding)
}

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
