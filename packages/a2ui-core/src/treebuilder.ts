// TreeBuilder：把扁平的组件定义构建成 VNode 树。
// 两阶段建树：hydrateAll 为每个定义创建 VNode 实例入 hydrateNodeMap
// （此时 children 只是 id 指针）→ buildNode 递归关联父子并做循环引用检测。
// List 按 dataBinding + template 逐项克隆展开，合成唯一 id。
// 支持多 surface：build(surfaceId?) 按 surface 建树。

import type { ComponentDef } from './types'
import type { A2UIStore, VNode } from './store'

/** 树节点（渲染用）：children 从「id 指针」关联成「节点引用」 */
export interface TreeNode extends Omit<VNode, 'children'> {
  children: TreeNode[]
  componentId: string
  // List 展开后：是否为模板克隆出来的项
  isListItem?: boolean
}

export class TreeBuilder {
  constructor(private store: A2UIStore) {}

  /**
   * 建树。不传 surfaceId 时，返回所有 surface 的根节点 Map；
   * 传了则只建该 surface（单 surface 场景常用）。
   */
  build(surfaceId?: string): Map<string, TreeNode | null> {
    const result = new Map<string, TreeNode | null>()
    const ids = surfaceId ? [surfaceId] : Array.from(this.store.surfaces.keys())
    for (const sid of ids) {
      result.set(sid, this.buildSurface(sid))
    }
    return result
  }

  /** 单 surface 便捷方法：返回该 surface 的根节点（无则 null） */
  buildSingle(surfaceId: string): TreeNode | null {
    return this.buildSurface(surfaceId)
  }

  private buildSurface(surfaceId: string): TreeNode | null {
    const s = this.store.getSurfaceState(surfaceId)
    if (!s) return null

    // 阶段1：为每个组件定义创建 VNode 实例
    this.hydrateAll(surfaceId, s.components)

    const rootId = s.rootId
    if (!rootId) return null

    const visited = new Set<string>()
    return this.buildNode(surfaceId, rootId, visited, undefined)
  }

  /** 阶段1：遍历 components → 创建 VNode → 存 hydrateNodeMap */
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

  /**
   * 阶段2 + 3：递归建树，带循环引用检测。
   * 若子 id 已在当前递归路径上，视为循环引用，跳过并告警。
   */
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

  /**
   * 构建子节点列表：List 走模板展开，其余沿 children 指针递归。
   */
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

  /**
   * List 展开：template + dataBinding
   *   dataBinding 指向数组 → 每项用 template.componentId 作为模板渲染
   *   合成唯一 id:${parentId}__tpl__${templateId}__${index}
   */
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
      // 记录 List 项的数据绑定：合成 id → `${dataBinding}/${index}`
      this.store.setDataBinding(surfaceId, syntheticId, `${dataBinding}/${index}`)
      return node
    })
  }
}
