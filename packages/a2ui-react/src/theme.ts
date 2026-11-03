import type { CSSProperties, UseHint } from '@a2ui/core'

const USE_HINT_MAPPINGS: Record<string, () => CSSProperties> = {
  'spacing:tight': () => ({ padding: '8px', gap: '8px' }),
  'spacing:normal': () => ({ padding: '16px', gap: '16px' }),
  'spacing:loose': () => ({ padding: '24px', gap: '24px' }),
  'align:start': () => ({ alignItems: 'flex-start' }),
  'align:center': () => ({ alignItems: 'center' }),
  'align:end': () => ({ alignItems: 'flex-end' }),
  'align:stretch': () => ({ alignItems: 'stretch' }),
  'justify:start': () => ({ justifyContent: 'flex-start' }),
  'justify:center': () => ({ justifyContent: 'center' }),
  'justify:end': () => ({ justifyContent: 'flex-end' }),
  'justify:between': () => ({ justifyContent: 'space-between' }),
  'justify:around': () => ({ justifyContent: 'space-around' }),
  'style:minimal': () => ({}),
  'style:card': () => ({ backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }),
  'style:elevated': () => ({ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }),
  'style:bordered': () => ({ border: '1px solid #ddd' }),
  'theme:light': () => ({ backgroundColor: '#fff', color: '#333' }),
  'theme:dark': () => ({ backgroundColor: '#1a1a1a', color: '#fff' }),
  'theme:primary': () => ({ backgroundColor: '#1890ff', color: '#fff' }),
  'theme:accent': () => ({ backgroundColor: '#f5f5f5', color: '#1890ff' }),
  'width:narrow': () => ({ width: '200px' }),
  'width:medium': () => ({ width: '360px' }),
  'width:wide': () => ({ width: '600px' }),
  'width:full': () => ({ width: '100%' }),
  'height:short': () => ({ height: '32px' }),
  'height:medium': () => ({ height: '48px' }),
  'height:tall': () => ({ height: '80px' }),
  'height:full': () => ({ height: '100%' }),
}

export function useHintToCss(hint?: UseHint): CSSProperties {
  if (!hint) return {}
  const styles: CSSProperties = {}
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

// 优先级：styles > useHint > base
export function mergeStyles(hint?: UseHint, styles?: CSSProperties, base?: CSSProperties): CSSProperties {
  return { ...(base ?? {}), ...useHintToCss(hint), ...(styles ?? {}) }
}
