/**
 * A2UI 状态中心（Store）
 * 按 surfaceId 隔离维护：组件定义、渲染节点缓存、数据模型、数据绑定映射。
 * 提供订阅/通知机制，驱动上层重渲染。
 */

import type { ComponentDef, CSSProperties, SurfaceState, UseHint } from './types'

/** 虚拟节点：组件定义的运行时展开形式，children 仍为 id 指针（TreeBuilder 会解析为真实子树） */
export interface VNode {
  id: string                                    // 节点 id
  componentType: string                         // 组件类型
  props: Record<string, unknown>                // 组件属性
  children: string[]                            // 子组件 id 列表
  useHint?: UseHint                             // 语义化样式提示
  styles?: CSSProperties                        // 精细样式覆盖
  dataBinding?: string                          // 数据绑定路径
  template?: { componentId: string; dataBinding: string }  // List 模板配置
  itemData?: unknown                            // List 项的数据（expandList 填充）
}

export class A2UIStore {
  /** 所有画布状态（surfaceId → SurfaceState） */
  surfaces = new Map<string, SurfaceState>()

  /** 渲染节点缓存：组件 id → VNode，由 TreeBuilder.hydrateAll 填充 */
  hydrateNodeMap = new Map<string, VNode>()

  /** 变更监听器集合 */
  private listeners = new Set<() => void>()

  // ========== Surface 生命周期 ==========

  /** 创建新画布，已存在则跳过 */
  createSurface(surfaceId: string) {
    this.ensureSurface(surfaceId)
  }

  /** 删除画布并通知 */
  deleteSurface(surfaceId: string) {
    this.surfaces.delete(surfaceId)
    this.notify()
  }

  /** 获取画布状态 */
  getSurfaceState(surfaceId: string): SurfaceState | undefined {
    return this.surfaces.get(surfaceId)
  }

  /** 清空画布所有状态（组件、数据模型、绑定、根节点） */
  clear(surfaceId: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.components.clear()
    s.dataModel = {}
    s.dataBindings.clear()
    s.rootId = undefined
    this.notify()
  }

  /** 清空所有画布 */
  clearAll() {
    for (const sid of this.surfaces.keys()) this.clear(sid)
  }

  /** 设置根组件 id，标记画布可渲染（收到 beginRendering 消息时调用） */
  setReady(surfaceId: string, rootId: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.rootId = rootId
    this.notify()
  }

  // ========== 订阅 / 通知 ==========

  /** 订阅状态变更，返回取消订阅函数 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 通知所有监听器 */
  private notify() {
    for (const listener of this.listeners) listener()
  }

  // ========== 组件定义 ==========

  /** 插入或更新组件定义 */
  upsertComponent(surfaceId: string, def: ComponentDef) {
    const s = this.ensureSurface(surfaceId)
    s.components.set(def.id, def)
    this.notify()
  }

  /** 删除组件及其渲染缓存和数据绑定 */
  deleteComponent(surfaceId: string, id: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.components.delete(id)
    this.hydrateNodeMap.delete(id)
    s.dataBindings.delete(id)
    this.notify()
  }

  // ========== 数据模型 ==========

  /**
   * 更新数据模型。
   * path 为空或 '/' 时整体合并/替换；否则按路径穿透更新（支持数组索引）。
   */
  updateDataModel(surfaceId: string, path: string | undefined, value: unknown) {
    const s = this.ensureSurface(surfaceId)
    if (!path || path === '/') {
      // 路径为空：值为对象则深合并，否则整体替换
      if (isPlainObject(value)) {
        s.dataModel = deepMerge(s.dataModel, value as Record<string, unknown>)
      } else {
        s.dataModel = value as Record<string, unknown>
      }
    } else {
      setByPath(s.dataModel, path, value)
    }
    this.notify()
  }

  /** 按路径读取数据模型值（支持数组索引穿透） */
  getDataByPath(surfaceId: string, path: string): unknown {
    const s = this.surfaces.get(surfaceId)
    if (!s) return undefined
    return getDataByPath(s.dataModel, path)
  }

  /**
   * Input 双向绑定写侧：通过组件 id 反查绑定路径，再写入数据模型。
   * 返回 true 表示写入成功（组件有绑定），false 表示未绑定。
   */
  writeBinding(surfaceId: string, componentId: string, value: unknown): boolean {
    const s = this.surfaces.get(surfaceId)
    if (!s) return false
    const path = s.dataBindings.get(componentId)
    if (!path) return false
    this.updateDataModel(surfaceId, path, value)
    return true
  }

  /** 设置组件 id → 数据路径的绑定映射 */
  setDataBinding(surfaceId: string, componentId: string, path: string) {
    const s = this.ensureSurface(surfaceId)
    s.dataBindings.set(componentId, path)
  }

  /** 确保画布存在，不存在则创建并返回 */
  private ensureSurface(surfaceId: string): SurfaceState {
    let s = this.surfaces.get(surfaceId)
    if (!s) {
      s = {
        surfaceId,
        components: new Map(),
        dataModel: {},
        dataBindings: new Map(),
      }
      this.surfaces.set(surfaceId, s)
    }
    return s
  }
}

// ========== 工具函数 ==========

/** 判断是否为纯对象（非 null、非数组） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 深合并两个对象。
 * 数组不做逐项合并，整体替换——数据更新通常是整表替换。
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [k, v] of Object.entries(source)) {
    const old = out[k]
    // 双方都是对象则递归合并，否则直接覆盖（含数组整体替换）
    if (isPlainObject(old) && isPlainObject(v)) {
      out[k] = deepMerge(old, v)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * 按路径读取数据，支持数组索引穿透，如 /user/posts/0/title。
 * 路径中任何节点为 null/undefined 或类型不匹配时返回 undefined。
 */
function getDataByPath(root: unknown, path: string): unknown {
  const segs = path.replace(/^\//, '').split('/').filter(Boolean)
  let cursor: unknown = root
  for (const seg of segs) {
    if (cursor == null) return undefined
    if (Array.isArray(cursor)) {
      // 数组按索引访问，非数字索引返回 undefined
      const idx = Number(seg)
      if (!Number.isInteger(idx)) return undefined
      cursor = cursor[idx]
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg]
    } else {
      // 非对象非数组，无法继续穿透
      return undefined
    }
  }
  return cursor
}

/**
 * 按路径写入数据，缺失的中间节点自动创建。
 * 类型不符或非法下标时安全退出，不抛异常。
 */
function setByPath(root: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.replace(/^\//, '').split('/').filter(Boolean)
  if (segs.length === 0) return
  let cursor: unknown = root

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const isLast = i === segs.length - 1

    if (isLast) {
      // 最后一段：直接写入
      if (Array.isArray(cursor)) {
        const idx = Number(seg)
        if (Number.isInteger(idx)) cursor[idx] = value
      } else if (typeof cursor === 'object' && cursor !== null) {
        ;(cursor as Record<string, unknown>)[seg] = value
      }
      return
    }

    // 中间段：确保子节点存在，不存在则创建（根据下一段是否数字决定数组或对象）
    let child: unknown
    if (Array.isArray(cursor)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx)) return
      child = cursor[idx]
      if (child == null || typeof child !== 'object') {
        child = Number.isInteger(Number(segs[i + 1])) ? [] : {}
        cursor[idx] = child
      }
    } else if (typeof cursor === 'object' && cursor !== null) {
      const obj = cursor as Record<string, unknown>
      child = obj[seg]
      if (child == null || typeof child !== 'object') {
        child = Number.isInteger(Number(segs[i + 1])) ? [] : {}
        obj[seg] = child
      }
    } else {
      return
    }
    cursor = child
  }
}
