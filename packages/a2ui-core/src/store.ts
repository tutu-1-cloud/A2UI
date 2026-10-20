// A2UIStore：状态中枢（纯手写，不依赖第三方状态库）。
// 按 surface 隔离维护：components（组件定义/模板）、dataModel（UI 状态）、
// dataBindings（组件 id → 数据路径）；hydrateNodeMap 存组件实例（渲染后的 VNode）。
// 订阅/派发为手写实现：Set 存监听器 + notify 全量通知（不带 path）。

import type { ComponentDef, CSSProperties, SurfaceState, UseHint } from './types'

export interface VNode {
  /** 组件实例 id（List 项会生成合成 id，如 `${模板id}__tpl__${模板}__${序号}`） */
  id: string
  /** 组件类型 */
  componentType: string
  /** 组件属性 */
  props: Record<string, unknown>
  /** 子组件 id 列表（悬空指针，建树时再关联为真正的节点） */
  children: string[]
  /** 语义化样式提示 */
  useHint?: UseHint
  /** 精细样式覆盖 */
  styles?: CSSProperties
  /** 数据绑定路径 */
  dataBinding?: string
  /** List 专用：模板定义 */
  template?: { componentId: string; dataBinding: string }
  /** 父节点 id（建树时回填） */
  parentId?: string
  /** List 展开后注入的当前项数据 */
  itemData?: unknown
}

export class A2UIStore {
  // surfaceId → 该 surface 的状态
  surfaces = new Map<string, SurfaceState>()
  // 渲染实例（跨 surface 共享，key 为组件 id；单 surface 场景够用）
  hydrateNodeMap = new Map<string, VNode>()

  private listeners = new Set<() => void>()

  // ---------- Surface 生命周期 ----------

  createSurface(surfaceId: string, version = '0.9') {
    if (this.surfaces.has(surfaceId)) return
    this.surfaces.set(surfaceId, {
      surfaceId,
      version,
      components: new Map(),
      dataModel: {},
      dataBindings: new Map(),
      isReady: false,
    })
  }

  deleteSurface(surfaceId: string) {
    this.surfaces.delete(surfaceId)
    this.notify()
  }

  getSurfaceState(surfaceId: string): SurfaceState | undefined {
    return this.surfaces.get(surfaceId)
  }

  /** 获取指定 surface 的所有组件定义 */
  getComponents(surfaceId: string): ComponentDef[] {
    const s = this.surfaces.get(surfaceId)
    return s ? Array.from(s.components.values()) : []
  }

  clear(surfaceId: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.components.clear()
    s.dataModel = {}
    s.dataBindings.clear()
    s.rootId = undefined
    s.isReady = false
    this.notify()
  }

  clearAll() {
    for (const sid of this.surfaces.keys()) this.clear(sid)
  }

  /** beginRendering：记录根组件并标记就绪 */
  setReady(surfaceId: string, rootId: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.rootId = rootId
    s.isReady = true
    this.notify()
  }

  // ---------- 订阅 / 通知 ----------

  /** 订阅：数据变化时通知渲染层，返回取消订阅函数 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  // ---------- 组件定义操作（指定 surface） ----------
  // 更新或插入组件定义
  upsertComponent(surfaceId: string, def: ComponentDef) {
    const s = this.ensureSurface(surfaceId)
    s.components.set(def.id, def)
    this.notify()
  }
  /** 删除组件：同时清掉组件定义、渲染实例（hydrateNodeMap）和数据绑定 */
  deleteComponent(surfaceId: string, id: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.components.delete(id)
    this.hydrateNodeMap.delete(id)
    s.dataBindings.delete(id)
    this.notify()
  }

  getComponent(surfaceId: string, id: string): ComponentDef | undefined {
    return this.surfaces.get(surfaceId)?.components.get(id)
  }

  // ---------- 数据模型操作（deep merge + 数组索引） ----------

  updateDataModel(surfaceId: string, path: string | undefined, value: unknown) {
    const s = this.ensureSurface(surfaceId)
    if (!path || path === '/') {
      // 整体更新走 deep merge（而非覆盖）
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

  getDataByPath(surfaceId: string, path: string): unknown {
    const s = this.surfaces.get(surfaceId)
    if (!s) return undefined
    return getDataByPath(s.dataModel, path)
  }

  /**
   * 双向绑定写侧：根据组件 id 找到其绑定的 dataBinding 路径，
   * 把新值写回 dataModel，并通知重渲染。
   */
  writeBinding(surfaceId: string, componentId: string, value: unknown): boolean {
    const s = this.surfaces.get(surfaceId)
    if (!s) return false
    const path = s.dataBindings.get(componentId)
    if (!path) return false
    this.updateDataModel(surfaceId, path, value)
    return true
  }

  // ---------- 绑定 ----------

  setDataBinding(surfaceId: string, componentId: string, path: string) {
    const s = this.ensureSurface(surfaceId)
    s.dataBindings.set(componentId, path)
  }

  // ---------- 内部工具 ----------

  /** 取 surface，不存在则创建（兼容未显式 createSurface 的流） */
  private ensureSurface(surfaceId: string): SurfaceState {
    let s = this.surfaces.get(surfaceId)
    if (!s) {
      s = {
        surfaceId,
        version: '0.9',
        components: new Map(),
        dataModel: {},
        dataBindings: new Map(),
        isReady: false,
      }
      this.surfaces.set(surfaceId, s)
    }
    return s
  }
}

// ---------- 工具函数 ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 递归深合并：对象逐 key 合并，其余（数组/基本类型）直接覆盖。
 * 注意：数组不做逐项合并，而是整体替换——因为数据更新通常「整表替换」而非「拼数组」。
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [k, v] of Object.entries(source)) {
    const old = out[k]
    if (isPlainObject(old) && isPlainObject(v)) {
      out[k] = deepMerge(old, v)
    } else {
      out[k] = v
    }
  }
  return out
}

/** 路径读取，支持数组索引（如 /user/posts/0/title 能穿透数组） */
function getDataByPath(root: unknown, path: string): unknown {
  const segs = path.replace(/^\//, '').split('/').filter(x=>Boolean(x))
  let cursor: unknown = root
  for (const seg of segs) {
    // 路径提前到头（遇到 undefined/null），直接返回 undefined
    if (cursor == null) return undefined
    if (Array.isArray(cursor)) {
      // 当前是数组：把这一段当数字下标，非数字则视为非法路径
      const idx = Number(seg)
      if (!Number.isInteger(idx)) return undefined
      cursor = cursor[idx]
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg]
    } else {
      // 当前是基本类型，无法继续下钻
      return undefined
    }
  }
  return cursor
}

/**
 * 路径写入，支持数组索引；缺失的中间节点会自动创建。
 * 任何无法下钻的情况（类型不符、非法下标）安全退出，不抛异常——
 * LLM 可能发明 /components/1/styles/xxx 之类指向不存在结构的路径。
 */
function setByPath(root: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.replace(/^\//, '').split('/').filter(Boolean)
  if (segs.length === 0) return
  let cursor: unknown = root

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const isLast = i === segs.length - 1

    if (isLast) {
      if (Array.isArray(cursor)) {
        const idx = Number(seg)
        if (Number.isInteger(idx)) cursor[idx] = value
      } else if (typeof cursor === 'object' && cursor !== null) {
        ;(cursor as Record<string, unknown>)[seg] = value
      }
      return
    }

    // 下钻；子节点缺失或不是容器时，按「下一段是否为下标」补数组/对象
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
      // 被基本类型挡住，无法继续下钻
      return
    }
    cursor = child
  }
}
