import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createA2UI } from '@a2ui/core'
import type { ComponentDef, ElementReference } from '@a2ui/core'
import { createRenderContext } from '@a2ui/react'
import { generateDiff, applyDiff } from '../diff'
import { compressImage } from '../image'
import { fetchSSE } from '../sse'
import { buildSnapshot } from '../snapshot'

const SERVER_URL = 'http://127.0.0.1:3000'
const DEFAULT_SESSION_ID = 'default'
const DEFAULT_SURFACE_ID = 's1'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  hasImage?: boolean
}

let messageUid = 0
const nextMessageId = () => `m${++messageUid}`

export function usePlayground() {
  // 主运行时持久化，增量修改时复用。
  const runtime = useRef(createA2UI()).current
  // runtime 内部状态变更对 React 不可见，用 treeVersion 手动驱动重算。
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

  const trees = useMemo(() => {
    void treeVersion
    return runtime.buildTrees()
  }, [treeVersion, runtime])

  const feedFullJsonl = useCallback((jsonl: string, target = runtime) => {
    target.feed(jsonl)
    target.end()
  }, [runtime])

  // 组件事件回传 /api/action。
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

  const renderCtx = useMemo(() => createRenderContext({
    onAction: (action) => {
      setStatus(`事件：${action.action} @${action.componentId}`)
      void sendAction(action)
    },
    onDataChange: (componentId, value) => {
      runtime.store.writeBinding(DEFAULT_SURFACE_ID, componentId, value)
    },
    getData: (path) => {
      for (const [surfaceId] of runtime.store.surfaces) {
        const val = runtime.store.getDataByPath(surfaceId, path)
        if (val !== undefined) return val
      }
      return undefined
    },
  }), [runtime, sendAction])

  function extractErrorMessage(err: Error): string {
    let friendlyMessage = err.message
    try {
      const errorObj = JSON.parse(friendlyMessage)
      if (errorObj?.message) friendlyMessage = String(errorObj.message)
    } catch {
      /* 不是 JSON，原样展示 */
    }
    return friendlyMessage.replace(/^<\d+>\s*(?:InternalError\.\w+\.\w+:\s*)?/, '')
  }

  // 选中元素时走前端 diff 增量修改，否则全新生成并重建 runtime。
  const sendMessage = useCallback(async () => {
    const [curLoading, curCompressing] = [loading, compressing]
    if (curLoading || curCompressing) return
    const promptText = inputText.trim()
    if (!promptText && !imageBase64) {
      setStatus('请输入指令或上传图片')
      return
    }

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
    setStatus(
      imageBase64
        ? '图片理解中…'
        : hasSelection
          ? '增量修改中…'
          : '生成中…',
    )

    try {
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

      const responseJsonl = await fetchSSE(`${SERVER_URL}/api/chat`, {
        text: promptText || '生成一个界面',
        messages: messagesPayload,
        selectedElement: hasSelection ? selectedElement : undefined,
        currentProtocol: buildSnapshot(runtime.store),
      })

      let hasApplied = false
      if (hasSelection) {
        // 增量：临时 runtime 解析新协议 → diff → apply 到主 runtime。
        const tempRuntime = createA2UI()
        feedFullJsonl(responseJsonl, tempRuntime)
        for (const [surfaceId, surfaceState] of tempRuntime.store.surfaces) {
          if (!surfaceState.rootId || surfaceState.components.size === 0) continue
          const oldComponents =
            runtime.store.getSurfaceState(surfaceId)?.components ?? new Map()
          const diffOps = generateDiff(oldComponents, surfaceState.components)
          applyDiff(diffOps, surfaceId, runtime.store)
          hasApplied = true
        }
      } else {
        // 全量：用 Object.assign 复用 runtime 引用，保持 renderCtx 中的引用有效。
        const freshRuntime = createA2UI()
        Object.assign(runtime, freshRuntime)
        feedFullJsonl(responseJsonl, runtime)
        setSelectedId(null)
        setSelectedElement(null)
      }

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
      setLoading(false)
      setImageBase64(null)
      setImageName('')
    }
  }, [
    loading, compressing, inputText, imageBase64, selectedElement,
    runtime, feedFullJsonl,
  ])

  const clearCanvas = useCallback(() => {
    runtime.store.clearAll()
    setSelectedId(null)
    setSelectedElement(null)
    setTreeVersion((v) => v + 1)
    setStatus('画布已清空')
  }, [runtime])

  function findComponentDef(id: string): ComponentDef | undefined {
    for (const surfaceState of runtime.store.surfaces.values()) {
      const componentDef = surfaceState.components.get(id)
      if (componentDef) return componentDef
    }
    return undefined
  }

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

  useEffect(() => {
    applySelectionHighlight()
  })

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
    setInputText((prev) => prev + ` @${componentDef.componentType}[${componentDef.id}]`)
  }, [])

  // 画布事件委托：点击组件 → 反查定义 → 选中。
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return
    const componentEl = target.closest('[data-component-id]') as HTMLElement | null
    if (!componentEl) return
    const id = componentEl.getAttribute('data-component-id')
    if (!id) return
    const componentDef = findComponentDef(id)
    if (!componentDef) return
    onClickComponent(componentDef)
  }, [onClickComponent])

  const clearSelection = useCallback(() => {
    setSelectedElement(null)
    setSelectedId(null)
  }, [])

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
