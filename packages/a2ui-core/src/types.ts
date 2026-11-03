// A2UI v0.9 协议类型定义

export type ComponentType =
  | 'Text'
  | 'Button'
  | 'Image'
  | 'Input'
  | 'Column'
  | 'Row'
  | 'Card'
  | 'List'

export interface ComponentProps {
  text?: string
  label?: string
  source?: string
  alt?: string
  placeholder?: string
  value?: string
  disabled?: boolean
  title?: string
  gap?: number
  spacing?: string
  [key: string]: unknown
}

export interface UseHint {
  spacing?: 'tight' | 'normal' | 'loose' | 'none'
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around'
  style?: 'minimal' | 'card' | 'elevated' | 'bordered'
  theme?: 'light' | 'dark' | 'primary' | 'accent'
  state?: 'default' | 'active' | 'disabled' | 'loading'
  width?: 'narrow' | 'medium' | 'wide' | 'full'
  height?: 'short' | 'medium' | 'tall' | 'full'
}

export interface CSSProperties {
  display?: string
  flexDirection?: string
  justifyContent?: string
  alignItems?: string
  gap?: string
  padding?: string
  margin?: string
  width?: string
  height?: string
  minWidth?: string
  minHeight?: string
  backgroundColor?: string
  color?: string
  fontSize?: string
  fontWeight?: string
  borderRadius?: string
  border?: string
  boxShadow?: string
  opacity?: string
  [key: string]: string | undefined
}

export interface ComponentDef {
  id: string
  componentType: ComponentType
  props: ComponentProps
  children?: string[]
  useHint?: UseHint
  styles?: CSSProperties
  dataBinding?: string
  template?: ListTemplate
}

export interface ListTemplate {
  componentId: string
  dataBinding: string
}

export interface SurfaceState {
  surfaceId: string
  version: string
  components: Map<string, ComponentDef>
  dataModel: Record<string, unknown>
  dataBindings: Map<string, string>
  rootId?: string
  isReady: boolean
}

export interface ElementReference {
  componentId: string
  type: string
  path: string
  currentProperties: Record<string, unknown>
  currentUseHint?: UseHint
  currentStyles?: CSSProperties
}

export interface ComponentAction {
  componentId: string
  action: 'click' | 'submit' | 'change'
  payload?: unknown
}

export interface CreateSurfaceMessage {
  type: 'createSurface'
  surfaceId: string
  catalogId?: string
}

export interface SurfaceUpdateMessage {
  type: 'surfaceUpdate'
  surfaceId: string
  components: ComponentDef[]
}

export interface DataModelUpdateMessage {
  type: 'dataModelUpdate'
  surfaceId: string
  path?: string
  value: unknown
}

export interface BeginRenderingMessage {
  type: 'beginRendering'
  surfaceId: string
  root: string
}

export interface DeleteSurfaceMessage {
  type: 'deleteSurface'
  surfaceId: string
}

export type A2UIMessage =
  | CreateSurfaceMessage
  | SurfaceUpdateMessage
  | DataModelUpdateMessage
  | BeginRenderingMessage
  | DeleteSurfaceMessage
