/**
 * 主题映射工具：将语义化的 UseHint 转换为 CSS 样式对象。
 * 提供 useHintToCss（单字段映射）和 mergeStyles（多层样式合并）。
 */

import type { CSSProperties, UseHint } from '@a2ui/core'

/**
 * UseHint 字段值 → CSS 样式的映射表。
 * 每个键为 "字段名:值" 格式，值为返回 CSSProperties 的函数（便于动态生成）。
 */
const USE_HINT_MAPPINGS: Record<string, () => CSSProperties> = {
  // 间距档位：同时设置内边距和 flex 间隙
  'spacing:tight': () => ({ padding: '8px', gap: '8px' }),
  'spacing:normal': () => ({ padding: '16px', gap: '16px' }),
  'spacing:loose': () => ({ padding: '24px', gap: '24px' }),
  // 交叉轴对齐（align-items）
  'align:start': () => ({ alignItems: 'flex-start' }),
  'align:center': () => ({ alignItems: 'center' }),
  'align:end': () => ({ alignItems: 'flex-end' }),
  'align:stretch': () => ({ alignItems: 'stretch' }),
  // 主轴对齐（justify-content）
  'justify:start': () => ({ justifyContent: 'flex-start' }),
  'justify:center': () => ({ justifyContent: 'center' }),
  'justify:end': () => ({ justifyContent: 'flex-end' }),
  'justify:between': () => ({ justifyContent: 'space-between' }),
  'justify:around': () => ({ justifyContent: 'space-around' }),
  // 视觉风格
  'style:minimal': () => ({}),
  'style:card': () => ({ backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }),
  'style:elevated': () => ({ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }),
  'style:bordered': () => ({ border: '1px solid #ddd' }),
  // 主题色
  'theme:light': () => ({ backgroundColor: '#fff', color: '#333' }),
  'theme:dark': () => ({ backgroundColor: '#1a1a1a', color: '#fff' }),
  'theme:primary': () => ({ backgroundColor: '#1890ff', color: '#fff' }),
  'theme:accent': () => ({ backgroundColor: '#f5f5f5', color: '#1890ff' }),
  // 宽度档位
  'width:narrow': () => ({ width: '200px' }),
  'width:medium': () => ({ width: '360px' }),
  'width:wide': () => ({ width: '600px' }),
  'width:full': () => ({ width: '100%' }),
  // 高度档位
  'height:short': () => ({ height: '32px' }),
  'height:medium': () => ({ height: '48px' }),
  'height:tall': () => ({ height: '80px' }),
  'height:full': () => ({ height: '100%' }),
}

/**
 * 将 UseHint 对象转换为 CSSProperties。
 * 遍历 UseHint 的所有字段，查表合并对应的 CSS 样式。
 */
export function useHintToCss(hint?: UseHint): CSSProperties {
  if (!hint) return {}
  const styles: CSSProperties = {}
  // apply 辅助函数：查找映射并合并样式
  const apply = (key: string) => {
    const mapping = USE_HINT_MAPPINGS[key]
    if (mapping) Object.assign(styles, mapping())
  }
  if (hint.spacing) apply(`spacing:${hint.spacing}`)
  if (hint.align) apply(`align:${hint.align}`)
  if (hint.justify) apply(`justify:${hint.justify}`)
  if (hint.style) apply(`style:${hint.style}`)
  if (hint.theme) apply(`theme:${hint.theme}`)
  if (hint.width) apply(`width:${hint.width}`)
  if (hint.height) apply(`height:${hint.height}`)
  return styles
}

/**
 * 合并多层样式，优先级从低到高：base < useHint < styles。
 * - base：组件默认样式
 * - useHint：语义化样式提示（由 LLM 输出）
 * - styles：精细样式覆盖（由 LLM 输出，优先级最高）
 */
export function mergeStyles(hint?: UseHint, styles?: CSSProperties, base?: CSSProperties): CSSProperties {
  return { ...(base ?? {}), ...useHintToCss(hint), ...(styles ?? {}) }
}
