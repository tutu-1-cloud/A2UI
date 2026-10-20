// A2UI v0.9 协议类型定义，全项目唯一的 schema 源。
// 5 种消息 + 8 种组件，扁平 ComponentDef 结构（children 为 id 指针）。

// ---------- 组件类型枚举 ----------
export type ComponentType =
  | 'Text'
  | 'Button'
  | 'Image'
  | 'Input'
  | 'Column'
  | 'Row'
  | 'Card'
  | 'List'

// ---------- 组件属性（方案 C：所有组件可选并集，带字段提示） ----------
export interface ComponentProps {
  /** Text / Button 文本 */
  text?: string
  /** Button 文本（别名） */
  label?: string
  /** Image 地址 */
  source?: string
  /** Image 替代文本 */
  alt?: string
  /** Input 占位符 */
  placeholder?: string
  /** Input 默认值 */
  value?: string
  /** Button 是否禁用 */
  disabled?: boolean
  /** Card 标题 */
  title?: string
  /** Column/Row/List 间距（数字 px） */
  gap?: number
  /** 间距（语义） */
  spacing?: string
  /** 兜底：保留扩展性 */
  [key: string]: unknown
}

// ---------- useHint：语义化样式提示 ----------
export interface UseHint {
  /** 间距 */
  spacing?: 'tight' | 'normal' | 'loose' | 'none'
  /** 交叉轴对齐 */
  align?: 'start' | 'center' | 'end' | 'stretch'
  /** 主轴分布 */
  justify?: 'start' | 'center' | 'end' | 'between' | 'around'
  /** 视觉风格 */
  style?: 'minimal' | 'card' | 'elevated' | 'bordered'
  /** 主题 / 强调色 */
  theme?: 'light' | 'dark' | 'primary' | 'accent'
  /** 交互状态 */
  state?: 'default' | 'active' | 'disabled' | 'loading'
  /** 宽度档位 */
  width?: 'narrow' | 'medium' | 'wide' | 'full'
  /** 高度档位 */
  height?: 'short' | 'medium' | 'tall' | 'full'
}

// ---------- 精细样式覆盖（styles 字段） ----------
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

// ---------- 组件定义（扁平结构） ----------
export interface ComponentDef {
  /** 组件唯一 id */
  id: string
  /** 组件类型 */
  componentType: ComponentType
  /** 组件属性 */
  props: ComponentProps
  /** 子组件 id 列表（容器组件用） */
  children?: string[]
  /** 语义化样式提示 */
  useHint?: UseHint
  /** 精细样式覆盖 */
  styles?: CSSProperties
  /** 数据绑定路径（如 /user/name，Input 或 List 用） */
  dataBinding?: string
  /** List 专用：模板定义 */
  template?: ListTemplate
}

export interface ListTemplate {
  componentId: string
  dataBinding: string
}

// ---------- Surface（多画布） ----------
export interface SurfaceState {
  /** 画布唯一 id */
  surfaceId: string
  /** 协议版本 */
  version: string
  /** 组件定义（模板）id → def */
  components: Map<string, ComponentDef>
  /** 数据模型（UI 状态） */
  dataModel: Record<string, unknown>
  /** 组件 id → 数据绑定路径 */
  dataBindings: Map<string, string>
  /** 根组件 id（收到 beginRendering 后回填） */
  rootId?: string
  /** 是否已就绪（收到 beginRendering） */
  isReady: boolean
}

// ---------- 事件（元素交互 + 组件动作） ----------
export interface ElementReference {
  /** 组件 id */
  componentId: string
  /** 组件类型 */
  type: string
  /** 组件在树中的路径 */
  path: string
  /** 组件当前属性快照 */
  currentProperties: Record<string, unknown>
  /** 组件当前语义化样式 */
  currentUseHint?: UseHint
  /** 组件当前精细样式 */
  currentStyles?: CSSProperties
}

export interface ComponentAction {
  /** 组件 id */
  componentId: string
  /** 动作类型：点击 / 提交 / 输入变化 */
  action: 'click' | 'submit' | 'change'
  /** 动作附加数据（如输入值） */
  payload?: unknown
}

// ---------- 消息类型（5 种） ----------

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
  root: string // 根组件 id
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
