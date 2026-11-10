/**
 * Playground 核心 Hook
 * 管理 A2UI 运行时、对话消息、选中组件、图片上传、增量/全量生成等所有交互逻辑。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createA2UI } from '@a2ui/core'
import type { ComponentDef, ElementReference } from '@a2ui/core'
import { createRenderContext } from '@a2ui/react'
import { generateDiff, applyDiff } from '../diff'
import { compressImage } from '../image'
import { fetchSSE } from '../sse'
import { buildSnapshot } from '../snapshot'

const SERVER_URL = 'http://127.0.0.1:3000'        // 后端服务地址
const DEFAULT_SESSION_ID = 'default'              // 默认会话 id
const DEFAULT_SURFACE_ID = 's1'                   // 默认画布 id

/** 聊天消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  hasImage?: boolean
}

let messageUid = 0
const nextMessageId = () => `m${++messageUid}`

export function usePlayground() {
  // 主运行时用 useRef 持久化，增量修改时复用引用，避免重渲染重建导致状态丢失
  const runtime = useRef(createA2UI()).current
  // runtime 内部状态变更对 React 不可见，用 treeVersion 手动驱动重算渲染树
  const [treeVersion, setTreeVersion] = useState(0)

  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedElement, setSelectedElement] = useState<ElementReference | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')

  // 渲染树：treeVersion 变化时重新构建
  const trees = useMemo(() => {
    void treeVersion
    return runtime.buildTrees()
  }, [treeVersion, runtime])

  /** 喂入完整 JSONL 到指定 runtime（feed + end） */
  const feedFullJsonl = useCallback((jsonl: string, target = runtime) => {
    target.feed(jsonl)
    target.end()
  }, [runtime])

  /**
   * 组件动作回传：调 /api/action，将动作转为文本指令走同一 LLM 链路。
   * 响应直接喂入主 runtime（动作场景不做 diff）。
   */
  const sendAction = useCallback(async (action: {
    componentId: string
    action: string
    payload?: unknown
  }) => {
    try {
      const responseJsonl = await fetchSSE(`${SERVER_URL}/api/action`, {
        sessionId: DEFAULT_SESSION_ID,
        action,
        currentProtocol: buildSnapshot(runtime.store),
      })
      feedFullJsonl(responseJsonl)
      setTreeVersion((v) => v + 1)
    } catch (err) {
      setStatus('事件错误: ' + (err as Error).message)
    }
  }, [runtime, feedFullJsonl])

  /** 渲染上下文：提供动作回调、数据变更回调、数据读取 */
  const renderCtx = useMemo(() => createRenderContext({
    onAction: (action) => {
      setStatus(`事件：${action.action} @${action.componentId}`)
      void sendAction(action)
    },
    onDataChange: (componentId, value) => {
      // Input 值变更：写入数据模型绑定，不触发重绘
      runtime.store.writeBinding(DEFAULT_SURFACE_ID, componentId, value)
    },
    getData: (path) => {
      // 遍历所有 surface 查找数据
      for (const [surfaceId] of runtime.store.surfaces) {
        const val = runtime.store.getDataByPath(surfaceId, path)
        if (val !== undefined) return val
      }
      return undefined
    },
  }), [runtime, sendAction])

  /** 从错误信息中提取友好的可读消息（剥离 OpenAI 内部错误前缀） */
  function extractErrorMessage(err: Error): string {
    let friendlyMessage = err.message
    try {
      // 尝试解析 JSON 错误体，提取 message 字段
      const errorObj = JSON.parse(friendlyMessage)
      if (errorObj?.message) friendlyMessage = String(errorObj.message)
    } catch {
      /* 不是 JSON，原样展示 */
    }
    // 剥离 <数字> InternalError.xxx.xxx: 前缀
    return friendlyMessage.replace(/^<\d+>\s*(?:InternalError\.\w+\.\w+:\s*)?/, '')
  }

  /**
   * 发送消息：核心交互函数。
   * - 有选中元素 → 增量修改（临时 runtime 解析 → diff → apply 到主 runtime）
   * - 无选中元素 → 全量生成（重建 runtime，复用引用保持 renderCtx 有效）
   */
  const sendMessage = useCallback(async () => {
    const [curLoading, curCompressing] = [loading, compressing]
    if (curLoading || curCompressing) return
    const promptText = inputText.trim()
    // 文字和图片都没有时提示用户
    if (!promptText && !imageBase64) {
      setStatus('请输入指令或上传图片')
      return
    }

    // 清空输入框并添加用户消息
    setInputText('')
    setMessages((prev) => [
      ...prev,
      {
        id: nextMessageId(),
        role: 'user',
        content: promptText || '[图片]',
        hasImage: !!imageBase64,
      },
    ])

    const hasSelection = !!selectedElement
    setLoading(true)
    // 根据场景设置状态提示
    setStatus(
      imageBase64
        ? '图片理解中…'
        : hasSelection
          ? '增量修改中…'
          : '生成中…',
    )

    try {
      // 构造多模态消息：有图片时 content 为数组（text + image_url）
      const messagesPayload = imageBase64
        ? [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText || '根据图片生成界面' },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
              ],
            },
          ]
        : undefined

      // 调用后端 /api/chat 获取 A2UI 协议 JSONL
      const responseJsonl = await fetchSSE(`${SERVER_URL}/api/chat`, {
        text: promptText || '生成一个界面',
        messages: messagesPayload,
        selectedElement: hasSelection ? selectedElement : undefined,
        currentProtocol: buildSnapshot(runtime.store),
      })

      let hasApplied = false
      if (hasSelection) {
        // 增量修改：临时 runtime 解析新协议 → 对比 diff → apply 到主 runtime
        const tempRuntime = createA2UI()
        feedFullJsonl(responseJsonl, tempRuntime)
        for (const [surfaceId, surfaceState] of tempRuntime.store.surfaces) {
          // 完整性校验：必须有 rootId 且有组件，否则跳过（LLM 只吐补丁的情况）
          if (!surfaceState.rootId || surfaceState.components.size === 0) continue
          const oldComponents =
            runtime.store.getSurfaceState(surfaceId)?.components ?? new Map()
          const diffOps = generateDiff(oldComponents, surfaceState.components)
          applyDiff(diffOps, surfaceId, runtime.store)
          hasApplied = true
        }
      } else {
        // 全量生成：用 Object.assign 复用 runtime 引用，保持 renderCtx 中的引用有效
        const freshRuntime = createA2UI()
        Object.assign(runtime, freshRuntime)
        feedFullJsonl(responseJsonl, runtime)
        // 清空选中状态
        setSelectedId(null)
        setSelectedElement(null)
      }

      // 触发重渲染并添加助手消息
      setTreeVersion((v) => v + 1)
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: 'assistant',
          content: hasSelection
            ? hasApplied
              ? '已按选中元素增量修改'
              : '未生成完整界面，已保留当前界面'
            : '已生成界面',
        },
      ])
      setStatus(hasSelection && !hasApplied ? '界面未变' : '完成')
    } catch (err) {
      // 错误处理：提取友好消息并展示
      const friendlyMessage = extractErrorMessage(err as Error)
      setStatus('错误: ' + friendlyMessage)
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: 'assistant',
          content: '出错了：' + friendlyMessage,
        },
      ])
    } finally {
      // 无论成功失败都重置状态
      setLoading(false)
      setImageBase64(null)
      setImageName('')
    }
  }, [
    loading, compressing, inputText, imageBase64, selectedElement,
    runtime, feedFullJsonl,
  ])

  /** 清空画布：清除所有 surface 状态 */
  const clearCanvas = useCallback(() => {
    runtime.store.clearAll()
    setSelectedId(null)
    setSelectedElement(null)
    setTreeVersion((v) => v + 1)
    setStatus('画布已清空')
  }, [runtime])

  /** 按组件 id 查找组件定义（遍历所有 surface） */
  function findComponentDef(id: string): ComponentDef | undefined {
    for (const surfaceState of runtime.store.surfaces.values()) {
      const componentDef = surfaceState.components.get(id)
      if (componentDef) return componentDef
    }
    return undefined
  }

  /** 应用选中高亮：移除旧高亮，为当前选中组件添加 a2ui-selected class */
  function applySelectionHighlight() {
    const canvas = document.querySelector('.canvas') as HTMLElement | null
    if (!canvas) return
    canvas
      .querySelectorAll('.a2ui-selected')
      .forEach((element) => element.classList.remove('a2ui-selected'))
    if (selectedId) {
      const element = canvas.querySelector(
        `[data-component-id="${selectedId}"]`,
      ) as HTMLElement | null
      element?.classList.add('a2ui-selected')
    }
  }

  // 每次渲染后更新选中高亮
  useEffect(() => {
    applySelectionHighlight()
  })

  /** 选中组件：设置选中状态并在输入框追加 @Type[id] 引用 */
  const onClickComponent = useCallback((componentDef: ComponentDef) => {
    setSelectedId(componentDef.id)
    setSelectedElement({
      componentId: componentDef.id,
      type: componentDef.componentType,
      path: componentDef.id,
      currentProperties: (componentDef.props ?? {}) as Record<string, unknown>,
      currentUseHint: componentDef.useHint as ElementReference['currentUseHint'],
      currentStyles: componentDef.styles as ElementReference['currentStyles'],
    })
    // 在输入框末尾追加 @引用
    setInputText((prev) => prev + ` @${componentDef.componentType}[${componentDef.id}]`)
  }, [])

  /**
   * 画布点击事件委托：找到被点击的组件元素，反查组件定义，触发选中。
   * 点击 INPUT/BUTTON 时不拦截（保留原生交互）。
   */
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // 输入框和按钮有自己的交互行为，不触发选中
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return
    const componentEl = target.closest('[data-component-id]') as HTMLElement | null
    if (!componentEl) return
    const id = componentEl.getAttribute('data-component-id')
    if (!id) return
    const componentDef = findComponentDef(id)
    if (!componentDef) return
    onClickComponent(componentDef)
  }, [onClickComponent])

  /** 取消选中 */
  const clearSelection = useCallback(() => {
    setSelectedElement(null)
    setSelectedId(null)
  }, [])

  /**
   * 图片上传处理：压缩图片并设置 base64。
   * 压缩后设置 imageBase64 和 imageName，状态显示图片尺寸。
   */
  const onImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setCompressing(true)
      setStatus('图片压缩中…')
      const compressed = await compressImage(file, 1024, 0.8)
      setImageBase64(compressed.base64)
      setImageName(file.name)
      setStatus(`图片已就绪（${compressed.width}×${compressed.height}）`)
    } catch (err) {
      setStatus('图片处理失败: ' + (err as Error).message)
    } finally {
      setCompressing(false)
      // 清空 input value，允许重复选择同一文件
      e.target.value = ''
    }
  }, [])

  return {
    status,
    loading,
    compressing,
    messages,
    inputText,
    setInputText,
    selectedElement,
    imageName,
    trees,
    renderCtx,
    sendMessage,
    onImageUpload,
    onCanvasClick,
    clearCanvas,
    clearSelection,
  }
}
