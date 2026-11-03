import type { ComponentDef } from './types'
import type { A2UIStore, VNode } from './store'

export interface TreeNode extends Omit<VNode, 'children'> {
  children: TreeNode[]
  componentId: string
  isListItem?: boolean
}

export class TreeBuilder {
  constructor(private store: A2UIStore) {}

  build(surfaceId?: string): Map<string, TreeNode | null> {
    const result = new Map<string, TreeNode | null>()
    const ids = surfaceId ? [surfaceId] : Array.from(this.store.surfaces.keys())
    for (const sid of ids) {
      result.set(sid, this.buildSurface(sid))
    }
    return result
  }

  buildSingle(surfaceId: string): TreeNode | null {
    return this.buildSurface(surfaceId)
  }

  private buildSurface(surfaceId: string): TreeNode | null {
    const s = this.store.getSurfaceState(surfaceId)
    if (!s) return null

    this.hydrateAll(surfaceId, s.components)

    const rootId = s.rootId
    if (!rootId) return null

    const visited = new Set<string>()
    return this.buildNode(surfaceId, rootId, visited, undefined)
  }

  private hydrateAll(surfaceId: string, components: Map<string, ComponentDef>) {
    for (const [id, def] of components) {
      const vnode: VNode = {
        id,
        componentType: def.componentType,
        props: def.props ?? {},
        children: def.children ?? [],
        useHint: def.useHint,
        styles: def.styles,
        dataBinding: def.dataBinding,
        template: def.template,
      }
      this.store.hydrateNodeMap.set(id, vnode)
      if (def.dataBinding) {
        this.store.setDataBinding(surfaceId, id, def.dataBinding)
      }
    }
  }

  // 递归建树，visiting 用于检测循环引用。
  private buildNode(
    surfaceId: string,
    id: string,
    visiting: Set<string>,
    parentId: string | undefined,
  ): TreeNode | null {
    const vnode = this.store.hydrateNodeMap.get(id)
    if (!vnode) return null

    if (visiting.has(id)) {
      console.warn(`[TreeBuilder] 检测到循环引用，跳过: ${id}`)
      return null
    }

    visiting.add(id)

    const node: TreeNode = {
      ...vnode,
      children: [],
      componentId: id,
      parentId,
    }

    node.children = this.buildChildren(surfaceId, vnode, visiting, id)

    visiting.delete(id)
    return node
  }

  private buildChildren(
    surfaceId: string,
    vnode: VNode,
    visiting: Set<string>,
    parentId: string,
  ): TreeNode[] {
    if (vnode.componentType === 'List' && vnode.template) {
      return this.expandList(surfaceId, vnode, visiting)
    }
    return (vnode.children ?? [])
      .map((childId) => this.buildNode(surfaceId, childId, visiting, parentId))
      .filter((c): c is TreeNode => c !== null)
  }

  // List 按 dataBinding 指向的数组展开，每项用 template 克隆，合成唯一 id。
  private expandList(surfaceId: string, listVNode: VNode, visiting: Set<string>): TreeNode[] {
    const { componentId: templateId, dataBinding } = listVNode.template!
    const template = this.store.hydrateNodeMap.get(templateId)
    const arr = this.store.getDataByPath(surfaceId, dataBinding)
    if (!template || !Array.isArray(arr)) return []

    return arr.map((item, index) => {
      const syntheticId = `${listVNode.id}__tpl__${templateId}__${index}`
      const node: TreeNode = {
        ...template,
        id: syntheticId,
        componentId: templateId,
        children: [],
        parentId: listVNode.id,
        itemData: item,
        isListItem: true,
      }
      node.children = this.buildChildren(surfaceId, template, visiting, syntheticId)
      this.store.setDataBinding(surfaceId, syntheticId, `${dataBinding}/${index}`)
      return node
    })
  }
}
