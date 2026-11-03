import { createElement, type ReactElement, type CSSProperties as ReactCSSProperties } from 'react'
import type { TreeNode, ComponentAction } from '@a2ui/core'
import { mergeStyles } from './theme'

type RenderCtx = {
  onAction?: (action: ComponentAction) => void
  onDataChange?: (componentId: string, value: unknown) => void
  getData?: (path: string) => unknown
}

type RenderFn = (node: TreeNode, ctx: RenderCtx) => ReactElement

// 打 data 属性供前端事件委托定位组件。
function dataAttrs(node: TreeNode): Record<string, string> {
  return {
    'data-component-id': node.id,
    'data-component-type': node.componentType,
    'data-use-hint': node.useHint ? JSON.stringify(node.useHint) : '{}',
  }
}

// 组件类型 → 渲染函数，可扩展。
export const rendersMap: Record<string, RenderFn> = {
  Text: (node, ctx) => {
    const text = resolveText(node, ctx)
    const style = mergeStyles(node.useHint, node.styles, { fontSize: '14px', lineHeight: '1.5' })
    return createElement(
      'span',
      { key: node.id, className: 'a2ui-text', style: style as ReactCSSProperties, ...dataAttrs(node) },
      text,
    )
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
    return createElement(
      'button',
      {
        key: node.id,
        className: 'a2ui-button',
        style: style as ReactCSSProperties,
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
    return createElement('img', {
      key: node.id,
      className: 'a2ui-image',
      style: style as ReactCSSProperties,
      ...dataAttrs(node),
      src: source,
      alt,
    })
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
    // 非受控：避免 store 写入触发重渲染时输入框被重置。
    const input = createElement('input', {
      key: node.id,
      className: 'a2ui-input',
      style: style as ReactCSSProperties,
      ...dataAttrs(node),
      placeholder,
      defaultValue: value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.onDataChange?.(node.id, e.target.value)
      },
    })
    const label = (node.props.label as string) ?? ''
    if (label) {
      return createElement(
        'label',
        { key: `label-${node.id}`, className: 'a2ui-input-wrap', ...dataAttrs(node) },
        createElement('span', { className: 'a2ui-input-label' }, label),
        input,
      )
    }
    return input
  },

  Column: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 8
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'column',
      gap: `${gap}px`,
    })
    return createElement(
      'div',
      { key: node.id, className: 'a2ui-column', style: style as ReactCSSProperties, ...dataAttrs(node) },
      ...renderChildren(node, ctx),
    )
  },

  Row: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 8
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'row',
      gap: `${gap}px`,
    })
    return createElement(
      'div',
      { key: node.id, className: 'a2ui-row', style: style as ReactCSSProperties, ...dataAttrs(node) },
      ...renderChildren(node, ctx),
    )
  },

  Card: (node, ctx) => {
    const title = (node.props.title as string) ?? ''
    const style = mergeStyles(node.useHint, node.styles, {
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '12px',
    })
    const titleEl = title ? createElement('div', { className: 'a2ui-card-title' }, title) : null
    return createElement(
      'div',
      { key: node.id, className: 'a2ui-card', style: style as ReactCSSProperties, ...dataAttrs(node) },
      titleEl,
      ...renderChildren(node, ctx),
    )
  },

  List: (node, ctx) => {
    const gap = (node.props.gap as number) ?? 4
    const style = mergeStyles(node.useHint, node.styles, {
      display: 'flex',
      flexDirection: 'column',
      gap: `${gap}px`,
    })
    return createElement(
      'div',
      { key: node.id, className: 'a2ui-list', style: style as ReactCSSProperties, ...dataAttrs(node) },
      ...renderChildren(node, ctx),
    )
  },
}

function renderChildren(node: TreeNode, ctx: RenderCtx): ReactElement[] {
  return node.children.map((child) => renderVNode(child, ctx))
}

export function renderVNode(node: TreeNode, ctx: RenderCtx): ReactElement {
  const renderFn = rendersMap[node.componentType]
  return renderFn
    ? renderFn(node, ctx)
    : createElement('div', { key: node.id, className: 'a2ui-unknown' }, node.componentType)
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
