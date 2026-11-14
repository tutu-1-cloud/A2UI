/**
 * A2UI v0.9 协议类型定义
 * 定义了组件类型、属性、样式提示、消息格式等核心数据结构
 */

/** 组件类型枚举：4 种原子组件 + 4 种容器组件 */
export type ComponentType =
  | 'Text'      // 文本展示
  | 'Button'    // 按钮交互
  | 'Image'     // 图片展示
  | 'Input'     // 输入框交互
  | 'Column'    // 纵向布局容器
  | 'Row'       // 横向布局容器
  | 'Card'      // 卡片容器
  | 'List'      // 列表容器（支持模板展开）

/** 组件属性集合：各组件类型共用的属性字段，多余字段用索引签名兼容 */
export interface ComponentProps {
  text?: string          // Text/Button 的文字内容
  label?: string         // Input 的标签文字
  source?: string        // Image 的图片地址
  alt?: string           // Image 的替代文本
  placeholder?: string   // Input 的占位提示
  value?: string         // Input 的默认值
  disabled?: boolean     // 是否禁用
  title?: string         // Card 的标题
  gap?: number           // 容器的子元素间距（px）
  spacing?: string       // 间距语义档位
  [key: string]: unknown // 允许 LLM 输出的其他自定义属性
}

/** useHint：语义化样式提示，由 LLM 输出，渲染层查表转换为 CSS */
export interface UseHint {
  spacing?: 'tight' | 'normal' | 'loose' | 'none'  // 间距档位
  align?: 'start' | 'center' | 'end' | 'stretch'   // 交叉轴对齐
  justify?: 'start' | 'center' | 'end' | 'between' | 'around'  // 主轴对齐
  style?: 'minimal' | 'card' | 'elevated' | 'bordered'  // 视觉风格
  theme?: 'light' | 'dark' | 'primary' | 'accent'  // 主题色
  state?: 'default' | 'active' | 'disabled' | 'loading'  // 状态
  width?: 'narrow' | 'medium' | 'wide' | 'full'    // 宽度档位
  height?: 'short' | 'medium' | 'tall' | 'full'    // 高度档位
}

/** CSS 样式对象：与 React CSSProperties 结构一致，框架无关 */
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
  [key: string]: string | undefined  // 允许任意 CSS 属性
}

/** 组件定义：LLM 输出的扁平组件描述，children 为子组件 id 数组 */
export interface ComponentDef {
  id: string              // 组件唯一 id
  componentType: ComponentType  // 组件类型
  props: ComponentProps   // 组件属性
  children?: string[]     // 子组件 id 列表（扁平指针结构）
  useHint?: UseHint       // 语义化样式提示（可选）
  styles?: CSSProperties  // 精细样式覆盖（优先级最高，可选）
  dataBinding?: string    // 数据绑定路径，如 /userName（Input 必填）
  template?: ListTemplate // List 专用：模板组件 + 数据绑定
}

/** List 模板配置：指定模板组件 id 和数据数组路径 */
export interface ListTemplate {
  componentId: string   // 模板组件 id
  dataBinding: string   // 数据数组路径，如 /items
}

/** Surface 状态：一个画布的完整运行时状态 */
export interface SurfaceState {
  surfaceId: string                         // 画布 id
  components: Map<string, ComponentDef>     // 组件定义集合（id → 定义）
  dataModel: Record<string, unknown>        // 数据模型（UI 状态）
  dataBindings: Map<string, string>         // 组件 id → 数据路径绑定
  rootId?: string                           // 根组件 id
}

/** 元素引用：选中组件时传递给后端的上下文信息 */
export interface ElementReference {
  componentId: string                    // 组件 id
  type: string                           // 组件类型
  path: string                           // 组件路径
  currentProperties: Record<string, unknown>  // 当前属性
  currentUseHint?: UseHint               // 当前 useHint
  currentStyles?: CSSProperties          // 当前 styles
}

/** 组件交互动作：用户操作组件时触发 */
export interface ComponentAction {
  componentId: string                 // 触发动作的组件 id
  action: 'click' | 'submit' | 'change'  // 动作类型
  payload?: unknown                   // 动作携带的数据
}

/** 5 种协议消息类型 */
export interface CreateSurfaceMessage {
  type: 'createSurface'
  surfaceId: string
}

export interface SurfaceUpdateMessage {
  type: 'surfaceUpdate'
  surfaceId: string
  components: ComponentDef[]
}

export interface DataModelUpdateMessage {
  type: 'dataModelUpdate'
  surfaceId: string
  path?: string    // 数据路径，如 /userName；为空时整体替换 dataModel
  value: unknown   // 数据值
}

export interface BeginRenderingMessage {
  type: 'beginRendering'
  surfaceId: string
  root: string     // 根组件 id
}

export interface DeleteSurfaceMessage {
  type: 'deleteSurface'
  surfaceId: string
}

/** 协议消息联合类型 */
export type A2UIMessage =
  | CreateSurfaceMessage
  | SurfaceUpdateMessage
  | DataModelUpdateMessage
  | BeginRenderingMessage
  | DeleteSurfaceMessage
