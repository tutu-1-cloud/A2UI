import type { ComponentDef, CSSProperties, SurfaceState, UseHint } from './types'

export interface VNode {
  id: string
  componentType: string
  props: Record<string, unknown>
  children: string[]
  useHint?: UseHint
  styles?: CSSProperties
  dataBinding?: string
  template?: { componentId: string; dataBinding: string }
  parentId?: string
  itemData?: unknown
}

export class A2UIStore {
  surfaces = new Map<string, SurfaceState>()
  hydrateNodeMap = new Map<string, VNode>()

  private listeners = new Set<() => void>()

  // Surface 生命周期

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

  setReady(surfaceId: string, rootId: string) {
    const s = this.surfaces.get(surfaceId)
    if (!s) return
    s.rootId = rootId
    s.isReady = true
    this.notify()
  }

  // 订阅 / 通知

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  // 组件定义

  upsertComponent(surfaceId: string, def: ComponentDef) {
    const s = this.ensureSurface(surfaceId)
    s.components.set(def.id, def)
    this.notify()
  }

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

  // 数据模型

  updateDataModel(surfaceId: string, path: string | undefined, value: unknown) {
    const s = this.ensureSurface(surfaceId)
    if (!path || path === '/') {
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

  writeBinding(surfaceId: string, componentId: string, value: unknown): boolean {
    const s = this.surfaces.get(surfaceId)
    if (!s) return false
    const path = s.dataBindings.get(componentId)
    if (!path) return false
    this.updateDataModel(surfaceId, path, value)
    return true
  }

  setDataBinding(surfaceId: string, componentId: string, path: string) {
    const s = this.ensureSurface(surfaceId)
    s.dataBindings.set(componentId, path)
  }

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

// 工具函数

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// 数组不做逐项合并，整体替换——数据更新通常是整表替换。
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

// 支持数组索引穿透，如 /user/posts/0/title。
function getDataByPath(root: unknown, path: string): unknown {
  const segs = path.replace(/^\//, '').split('/').filter(Boolean)
  let cursor: unknown = root
  for (const seg of segs) {
    if (cursor == null) return undefined
    if (Array.isArray(cursor)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx)) return undefined
      cursor = cursor[idx]
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return cursor
}

// 缺失的中间节点自动创建；类型不符或非法下标时安全退出，不抛异常。
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
