/**
 * 树构建器：将扁平的组件定义（children 为 id 指针）递归解析为真正的树形结构。
 * List 组件特殊处理：根据 dataBinding 指向的数据数组，用 template 模板展开为多个克隆项。
 */

import type { ComponentDef } from './types'
import type { A2UIStore, VNode } from './store'

/** 树节点：VNode 的子树展开形式，children 为真实子节点数组 */
export interface TreeNode extends Omit<VNode, 'children'> {
  children: TreeNode[]              // 真实子节点数组（非 id 指针）
}

export class TreeBuilder {
  constructor(private store: A2UIStore) {}

  /** 构建所有画布的树，返回 surfaceId → TreeNode 映射 */
  build(surfaceId?: string): Map<string, TreeNode | null> {
    const result = new Map<string, TreeNode | null>()
    const ids = surfaceId ? [surfaceId] : Array.from(this.store.surfaces.keys())
    for (const sid of ids) {
      result.set(sid, this.buildSurface(sid))
    }
    return result
  }

  /** 构建单个画布的根树 */
  private buildSurface(surfaceId: string): TreeNode | null {
    const s = this.store.getSurfaceState(surfaceId)
    if (!s) return null

    // 将所有组件定义水合为 VNode 缓存，并建立数据绑定映射
    this.hydrateAll(surfaceId, s.components)

    const rootId = s.rootId
    if (!rootId) return null  // 尚未就绪，无根组件

    const visited = new Set<string>()
    return this.buildNode(surfaceId, rootId, visited)
  }

  /** 将组件定义集合全部转为 VNode 并缓存，同时建立 id → 数据路径绑定 */
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
   * 递归构建单个节点。
   * visiting Set 用于检测循环引用，避免无限递归。
   */
  private buildNode(
    surfaceId: string,
    id: string,
    visiting: Set<string>,
  ): TreeNode | null {
    const vnode = this.store.hydrateNodeMap.get(id)
    if (!vnode) return null

    // 循环引用检测：正在构建的祖先节点中已包含当前 id
    if (visiting.has(id)) {
      console.warn(`[TreeBuilder] 检测到循环引用，跳过: ${id}`)
      return null
    }

    visiting.add(id)

    // 创建树节点，children 留空由 buildChildren 填充
    const node: TreeNode = {
      ...vnode,
      children: [],
    }

    node.children = this.buildChildren(surfaceId, vnode, visiting)

    visiting.delete(id)  // 回溯，允许其他分支引用同一节点
    return node
  }

  /** 构建子节点列表，List 组件走模板展开逻辑 */
  private buildChildren(
    surfaceId: string,
    vnode: VNode,
    visiting: Set<string>,
  ): TreeNode[] {
    // List 组件且有模板配置时，按数据数组展开
    if (vnode.componentType === 'List' && vnode.template) {
      return this.expandList(surfaceId, vnode, visiting)
    }
    // 普通组件：将 children id 指针逐个解析为子节点
    return (vnode.children ?? [])
      .map((childId) => this.buildNode(surfaceId, childId, visiting))
      .filter((c): c is TreeNode => c !== null)
  }

  /**
   * List 展开：根据 dataBinding 指向的数组，用 template 模板克隆出 N 个项。
   * 合成 id 格式：{listId}__tpl__{templateId}__{index}，确保唯一。
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
        id: syntheticId,        // 合成唯一 id
        children: [],
        itemData: item,         // 绑定当前项数据
      }
      // 递归构建模板内部子树
      node.children = this.buildChildren(surfaceId, template, visiting)
      // 为合成项建立数据绑定，指向数组当前索引
      this.store.setDataBinding(surfaceId, syntheticId, `${dataBinding}/${index}`)
      return node
    })
  }
}
