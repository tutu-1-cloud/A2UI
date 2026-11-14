/**
 * Playground 核心 Hook
 * 管理 A2UI 运行时、对话消息、选中组件、图片上传、增量/全量生成等交互逻辑。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createA2UI } from '@a2ui/core'
import type { ComponentDef, ElementReference } from '@a2ui/core'
import { createRenderContext } from '@a2ui/react'
import { generateDiff, applyDiff } from '../diff'
import { compressImage } from '../image'
import { fetchSSE, type SSEEvent } from '../sse'
import { buildSnapshot } from '../snapshot'

const SERVER_URL = 'http://127.0.0.1:3000'        // 后端服务地址
const DEFAULT_SESSION_ID = 'default'              // 默认会话 id
const DEFAULT_SURFACE_ID = 's1'                   // 默认画布 id

/** A2UI 运行时实例（createA2UI 的返回值） */
type Engine = ReturnType<typeof createA2UI>

/** 聊天消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string   // 用户上传图片的 dataURL，用于聊天区回显缩略图
}

/** Agent 执行步骤（思考过程 / 思考 / 计划 / 工具调用 / 工具结果） */
export interface AgentStep {
  id: string
  kind: 'reasoning' | 'thought' | 'plan' | 'tool_call' | 'tool_result'
  text: string
  ok?: boolean
  live?: boolean   // 思考过程是否仍在进行（进行中保持展开）
}

let messageUid = 0
const nextMessageId = () => `m${++messageUid}`

/** 喂入完整 JSONL：解析全部消息并结束流 */
function feedJsonl(engine: Engine, jsonl: string): void {
  engine.feed(jsonl)
  engine.end()
}

/**
 * 把生成结果落到 runtime。
 * - 全量：重建 runtime（复用引用，保持 renderCtx 有效）
 * - 增量：临时 runtime 解析 → diff → apply，避免整树重建丢输入框等状态
 * @returns 增量场景下是否成功应用了完整界面
 */
function applyResponse(engine: Engine, jsonl: string, incremental: boolean): boolean {
  if (!incremental) {
    Object.assign(engine, createA2UI())
    feedJsonl(engine, jsonl)
    return true
  }

  const temp = createA2UI()
  feedJsonl(temp, jsonl)

  let applied = false
  for (const [surfaceId, state] of temp.store.surfaces) {
    // 完整性校验：必须有根组件且有组件，否则跳过（模型只吐补丁的情况）
    if (!state.rootId || state.components.size === 0) continue
    const oldComponents = engine.store.getSurfaceState(surfaceId)?.components ?? new Map()
    applyDiff(generateDiff(oldComponents, state.components), surfaceId, engine.store)
    applied = true
  }
  return applied
}

/** 构造多模态消息：有图片时 content 为 text + image_url 数组 */
function buildMessagesPayload(text: string, imageBase64: string | null) {
  if (!imageBase64) return undefined
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: text || '根据图片生成界面' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ],
    },
  ]
}

/** 从错误信息中提取可读消息（剥离 OpenAI 内部错误前缀） */
function extractErrorMessage(err: Error): string {
  let message = err.message
  try {
    // 错误体可能是 JSON，取其中的 message 字段
    const parsed = JSON.parse(message) as { message?: unknown }
    if (parsed?.message) message = String(parsed.message)
  } catch {
    /* 不是 JSON，原样展示 */
  }
  // 剥离 <数字> InternalError.xxx.xxx: 前缀
  return message.replace(/^<\d+>\s*(?:InternalError\.\w+\.\w+:\s*)?/, '')
}

/** 按组件 id 查找组件定义（遍历所有 surface） */
function findComponentDef(engine: Engine, id: string): ComponentDef | undefined {
  for (const state of engine.store.surfaces.values()) {
    const def = state.components.get(id)
    if (def) return def
  }
  return undefined
}

/** 应用选中高亮：移除旧高亮，为当前选中组件添加 a2ui-selected class */
function applySelectionHighlight(selectedId: string | null): void {
  const canvas = document.querySelector('.canvas')
  if (!canvas) return

  canvas.querySelectorAll('.a2ui-selected').forEach((el) => el.classList.remove('a2ui-selected'))
  if (!selectedId) return

  const target = canvas.querySelector(`[data-component-id="${selectedId}"]`)
  target?.classList.add('a2ui-selected')
}

/** 把 SSE 过程事件转成可展示的步骤 */
function toAgentStep(evt: SSEEvent, seq: number): AgentStep {
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(evt.data) as Record<string, unknown>
  } catch {
    /* 非 JSON 时按原始文本展示 */
  }

  if (evt.event === 'thought') {
    return { id: `st${seq}`, kind: 'thought', text: String(payload.text ?? evt.data) }
  }

  if (evt.event === 'plan') {
    const steps = Array.isArray(payload.steps) ? (payload.steps as unknown[]).map(String) : []
    return { id: `st${seq}`, kind: 'plan', text: steps.join(' → ') }
  }

  const name = String(payload.name ?? 'tool')
  if (evt.event === 'tool_call') {
    const args = payload.args ? JSON.stringify(payload.args) : ''
    return { id: `st${seq}`, kind: 'tool_call', text: `${name}${args ? ` ${args}` : ''}` }
  }

  const ok = payload.ok !== false
  const result = String(payload.result ?? '').replace(/\s+/g, ' ').slice(0, 160)
  return { id: `st${seq}`, kind: 'tool_result', ok, text: `${name} → ${result}` }
}

export function usePlayground() {
  // 主运行时用 useRef 持久化，增量修改时复用引用，避免重渲染重建导致状态丢失
  const runtime = useRef(createA2UI()).current
  // runtime 内部状态变更对 React 不可见，用 treeVersion 手动驱动重算渲染树
  const [treeVersion, setTreeVersion] = useState(0)

  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [inputText, setInputText] = useState('')
  const [selectedElement, setSelectedElement] = useState<ElementReference | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')

  // 选中 id 由选中元素派生，避免两份状态不同步
  const selectedId = selectedElement?.componentId ?? null

  // 渲染树：treeVersion 变化时重新构建
  const trees = useMemo(() => {
    void treeVersion
    return runtime.buildTrees()
  }, [treeVersion, runtime])

  // Agent 步骤序号：对话与组件动作两个入口共用，保证 step id 不重复
  const stepSeqRef = useRef(0)

  /** 清空上一轮的 Agent 步骤并重置序号 */
  const resetSteps = useCallback(() => {
    stepSeqRef.current = 0
    setSteps([])
  }, [])

  /** 收集单个 Agent 过程事件，追加到步骤面板 */
  const collectStep = useCallback((evt: SSEEvent) => {
    // 思考过程是流式片段：追加到上一条 reasoning 上，避免每段都新建一行
    if (evt.event === 'reasoning') {
      let text = ''
      try {
        text = String((JSON.parse(evt.data) as { text?: string }).text ?? '')
      } catch {
        /* 非 JSON 忽略 */
      }
      if (!text) return

      setSteps((prev) => {
        const last = prev[prev.length - 1]
        if (last?.kind === 'reasoning') {
          return [...prev.slice(0, -1), { ...last, text: last.text + text, live: true }]
        }
        return [...prev, { id: `st${++stepSeqRef.current}`, kind: 'reasoning', text, live: true }]
      })
      return
    }

    setSteps((prev) => [...prev, toAgentStep(evt, ++stepSeqRef.current)])
  }, [])

  /** 收起所有思考过程（本轮生成结束后调用） */
  const collapseReasoning = useCallback(() => {
    setSteps((prev) =>
      prev.map((s) => (s.kind === 'reasoning' && s.live ? { ...s, live: false } : s)),
    )
  }, [])

  /**
   * 组件动作回传：调 /api/action，将动作转为文本指令走同一 LLM 链路。
   * 响应直接喂入主 runtime（动作场景不做 diff）。
   */
  const sendAction = useCallback(async (action: {
    componentId: string
    action: string
    payload?: unknown
  }) => {
    resetSteps()
    try {
      const responseJsonl = await fetchSSE(
        `${SERVER_URL}/api/action`,
        {
          sessionId: DEFAULT_SESSION_ID,
          action,
          currentProtocol: buildSnapshot(runtime.store),
        },
        collectStep,
      )
      feedJsonl(runtime, responseJsonl)
      setTreeVersion((v) => v + 1)
    } catch (err) {
      setStatus('事件错误: ' + (err as Error).message)
    } finally {
      collapseReasoning()
    }
  }, [runtime, resetSteps, collectStep, collapseReasoning])

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

  /**
   * 发送消息：核心交互函数。
   * - 有选中元素 → 增量修改（diff 到主 runtime）
   * - 无选中元素 → 全量生成（重建 runtime）
   */
  const sendMessage = useCallback(async () => {
    if (loading || compressing) return

    const promptText = inputText.trim()
    if (!promptText && !imageBase64) {
      setStatus('请输入指令或上传图片')
      return
    }

    // 清空输入框并记录用户消息（有图片时带 dataURL 回显）
    setInputText('')
    setMessages((prev) => [
      ...prev,
      {
        id: nextMessageId(),
        role: 'user',
        content: promptText || '[图片]',
        imageUrl: imageBase64 ? `data:image/jpeg;base64,${imageBase64}` : undefined,
      },
    ])

    const hasSelection = !!selectedElement
    setLoading(true)
    resetSteps()
    setStatus(imageBase64 ? '图片理解中…' : hasSelection ? '增量修改中…' : '生成中…')

    try {
      // 调用后端获取 A2UI 协议 JSONL，过程事件实时追加到步骤面板
      const responseJsonl = await fetchSSE(
        `${SERVER_URL}/api/chat`,
        {
          text: promptText || '生成一个界面',
          messages: buildMessagesPayload(promptText, imageBase64),
          selectedElement: hasSelection ? selectedElement : undefined,
          currentProtocol: buildSnapshot(runtime.store),
        },
        collectStep,
      )

      const hasApplied = applyResponse(runtime, responseJsonl, hasSelection)
      if (!hasSelection) setSelectedElement(null)

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
        { id: nextMessageId(), role: 'assistant', content: '出错了：' + friendlyMessage },
      ])
    } finally {
      // 无论成功失败都重置状态；思考过程到此收起
      collapseReasoning()
      setLoading(false)
      setImageBase64(null)
      setImageName('')
    }
  }, [
    loading, compressing, inputText, imageBase64, selectedElement,
    runtime, resetSteps, collectStep, collapseReasoning,
  ])

  /** 清空画布：同时重置后端会话历史与前端消息列表，确保下一轮从空白开始 */
  const clearCanvas = useCallback(async () => {
    runtime.store.clearAll()
    setSelectedElement(null)
    setMessages([])
    resetSteps()
    setTreeVersion((v) => v + 1)

    try {
      await fetch(`${SERVER_URL}/api/session/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: DEFAULT_SESSION_ID }),
      })
      setStatus('画布与会话已清空')
    } catch (err) {
      setStatus('画布已清空，但会话重置失败：' + (err as Error).message)
    }
  }, [runtime, resetSteps])

  /** 选中组件：设置选中状态并在输入框追加 @Type[id] 引用 */
  const onClickComponent = useCallback((componentDef: ComponentDef) => {
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

  /**
   * 画布点击事件委托：找到被点击的组件元素，反查组件定义，触发选中。
   * 点击 INPUT/BUTTON 时不拦截（保留原生交互）。
   */
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // 输入框和按钮有自己的交互行为，不触发选中
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return

    const componentEl = target.closest('[data-component-id]')
    const id = componentEl?.getAttribute('data-component-id')
    if (!id) return

    const componentDef = findComponentDef(runtime, id)
    if (componentDef) onClickComponent(componentDef)
  }, [runtime, onClickComponent])

  /** 取消选中 */
  const clearSelection = useCallback(() => {
    setSelectedElement(null)
  }, [])

  /** 图片上传：压缩后暂存 base64，发送时随消息一起提交 */
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

  // 选中状态或画布变化后更新高亮
  useEffect(() => {
    applySelectionHighlight(selectedId)
  }, [selectedId, treeVersion])

  return {
    status,
    loading,
    compressing,
    messages,
    steps,
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
