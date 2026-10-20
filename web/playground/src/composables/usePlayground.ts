// usePlayground：Playground 的核心状态与业务逻辑，
// 从 App.vue 抽离，使组件只关注视图渲染与事件绑定。
// 命名规范：变量/函数 camelCase，常量 UPPER_SNAKE_CASE，
// 类型/接口 PascalCase，布尔变量 is/has/can/should 前缀。

import { ref, computed, onUpdated } from 'vue'
import { createA2UI } from '@a2ui/core'
import type { ComponentDef, ElementReference } from '@a2ui/core'
import { createRenderContext } from '@a2ui/vue'
import { generateDiff, applyDiff } from '../diff'
import { compressImage } from '../image'
import { fetchSSE } from '../sse'
import { buildSnapshot } from '../snapshot'

// ---- 常量（原魔法字符串） ----
const SERVER_URL = 'http://127.0.0.1:3000'
const DEFAULT_SESSION_ID = 'default'
const DEFAULT_SURFACE_ID = 's1'

/** 对话消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  hasImage?: boolean
}

// 消息自增 ID 计数器，保证每条对话消息的 key 唯一
let messageUid = 0
const nextMessageId = () => `m${++messageUid}`

export function usePlayground() {
  // ---------- runtime ----------
  // 主运行时（持久，增量修改时复用）：持有 store（surface/components/dataModel），
  // 负责协议解析与组件树构建。初次生成时重建，增量修改时 diff 后复用。
  const runtime = createA2UI()
  // 组件树版本号：每次协议变更后自增，触发 computed(trees) 重新计算，
  // 因为 runtime 内部状态变更对 Vue 不可见，需要手动驱动响应式更新。
  const treeVersion = ref(0)

  // ---------- 状态 ----------
  // 状态栏文本：展示当前操作进度 / 结果 / 错误信息
  const status = ref('')
  // 是否正在请求服务端（发送对话 / 处理事件），为 true 时禁用发送按钮
  const loading = ref(false)
  // 是否正在压缩图片，为 true 时禁用发送按钮并显示"压缩中…"
  const compressing = ref(false)
  // 对话消息列表（用户 + 助手），渲染为聊天气泡
  const messages = ref<ChatMessage[]>([])
  // 输入框文本，双向绑定到 textarea
  const inputText = ref('')
  // 当前选中的组件 id（用于高亮 DOM），与 selectedElement 同步
  const selectedId = ref<string | null>(null)
  // 当前选中组件的完整引用信息（类型 / 属性 / 样式），发送时传给服务端做增量修改
  const selectedElement = ref<ElementReference | null>(null)
  // 待发送图片的 base64（压缩后），发送后清空
  const imageBase64 = ref<string | null>(null)
  // 待发送图片的文件名，展示在输入区旁
  const imageName = ref('')

  // 所有 surface 的组件树：依赖 treeVersion 手动触发重算，
  // 遍历 runtime.store.surfaces 构建 VNode 树供渲染层消费。
  const trees = computed(() => {
    void treeVersion.value
    return runtime.buildTrees()
  })

  const renderCtx = createRenderContext({
    // 组件事件回传（按钮点击等离散事件）：更新状态提示 + 调 /api/action 触发新一轮生成
    onAction: (action) => {
      status.value = `事件：${action.action} @${action.componentId}`
      void sendAction(action)
    },
    // 双向绑定写侧（输入框值变化等）：直接写入 store 的 dataModel，
    // 本地生效不触发重绘，下次发送时 currentProtocol 快照会带上最新值。
    onDataChange: (componentId, value) => {
      runtime.store.writeBinding(DEFAULT_SURFACE_ID, componentId, value)
    },
  })

  /** 一次性传入完整 JSONL，让 Buffer 内部按换行符切分。
   * 不要逐行 feed——每行不带 \n 传入时 Buffer 看不到行边界，
   * 会把所有内容拼成一个无法解析的字符串，永远凑不出完整消息（死锁）。 */
  function feedFullJsonl(jsonl: string, target = runtime) {
    target.feed(jsonl)
    target.end()
  }

  // ---------- 对话发送 ----------
  /** 发送一条对话：选中元素时走前端 diff 增量修改，否则全新生成并重建 runtime */
  async function sendMessage() {
    if (loading.value || compressing.value) return
    const promptText = inputText.value.trim() // 先捕获，再清空
    if (!promptText && !imageBase64.value) {
      status.value = '请输入指令或上传图片'
      return
    }

    inputText.value = ''
    messages.value.push({
      id: nextMessageId(),
      role: 'user',
      content: promptText || '[图片]',
      hasImage: !!imageBase64.value,
    })

    const hasSelection = !!selectedElement.value
    loading.value = true
    status.value = imageBase64.value
      ? '图片理解中…'
      : hasSelection
        ? '增量修改中…'
        : '生成中…'

    try {
      const messagesPayload = imageBase64.value
        ? [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText || '根据图片生成界面' },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${imageBase64.value}` },
                },
              ],
            },
          ]
        : undefined

      const responseJsonl = await fetchSSE(`${SERVER_URL}/api/chat`, {
        text: promptText || '生成一个界面',
        messages: messagesPayload,
        selectedElement: hasSelection ? selectedElement.value : undefined,
        currentProtocol: buildSnapshot(runtime.store),
      })

      let hasApplied = false
      if (hasSelection) {
        // 增量修改：将新协议喂入临时 runtime 解析，再与主 runtime 做 diff，
        // 只 apply 变化的组件（add/remove/update），避免全量重建导致选中态丢失。
        const tempRuntime = createA2UI()
        feedFullJsonl(responseJsonl, tempRuntime)
        for (const [surfaceId, surfaceState] of tempRuntime.store.surfaces) {
          // 完整性校验：未 ready 或没有组件的结果不应用——
          // 防止 LLM 只吐补丁（如 dataModelUpdate）时，diff 把旧组件全部 remove，界面变空。
          if (!surfaceState.rootId || surfaceState.components.size === 0) continue
          // 取出主 runtime 中同 surface 的旧组件 Map 作为 diff 基准
          const oldComponents =
            runtime.store.getSurfaceState(surfaceId)?.components ?? new Map()
          const diffOps = generateDiff(oldComponents, surfaceState.components)
          applyDiff(diffOps, surfaceId, runtime.store)
          hasApplied = true
        }
      } else {
        // 初次生成（无选中）：直接重建 runtime，丢弃旧状态。
        // 用 Object.assign 复用同一个 runtime 引用，避免 renderCtx 持有的旧引用失效。
        const freshRuntime = createA2UI()
        Object.assign(runtime, freshRuntime)
        feedFullJsonl(responseJsonl, runtime)
        // 重建后清空选中态，避免引用指向已不存在的组件
        selectedId.value = null
        selectedElement.value = null
      }

      treeVersion.value++
      messages.value.push({
        id: nextMessageId(),
        role: 'assistant',
        content: hasSelection
          ? hasApplied
            ? '已按选中元素增量修改'
            : '未生成完整界面，已保留当前界面'
          : '已生成界面',
      })
      status.value = hasSelection && !hasApplied ? '界面未变' : '完成'
    } catch (err) {
      const friendlyMessage = extractErrorMessage(err as Error)
      status.value = '错误: ' + friendlyMessage
      messages.value.push({
        id: nextMessageId(),
        role: 'assistant',
        content: '出错了：' + friendlyMessage,
      })
    } finally {
      loading.value = false
      imageBase64.value = null
      imageName.value = ''
    }
  }

  /** 从服务端 error 事件中提取可读 message（去掉 <400> 等前缀） */
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

  // ---------- 组件事件回传 ----------
  /** 组件事件回传 /api/action（按钮点击）：将动作转为用户消息走同一 Agent 链路，
   * 返回的新协议直接 feed 进主 runtime 并刷新组件树。 */
  async function sendAction(action: {
    componentId: string
    action: string
    payload?: unknown
  }) {
    try {
      const responseJsonl = await fetchSSE(`${SERVER_URL}/api/action`, {
        sessionId: DEFAULT_SESSION_ID,
        action,
        currentProtocol: buildSnapshot(runtime.store),
      })
      feedFullJsonl(responseJsonl)
      treeVersion.value++
    } catch (err) {
      status.value = '事件错误: ' + (err as Error).message
    }
  }

  // ---------- 画布 ----------
  /** 清空画布：重置运行时 store 中的所有 surface，保留对话历史 */
  function clearCanvas() {
    runtime.store.clearAll()
    selectedId.value = null
    selectedElement.value = null
    treeVersion.value++
    status.value = '画布已清空'
  }

  /** 按 id 在所有 surface 中反查组件定义（事件委托点击时用） */
  function findComponentDef(id: string): ComponentDef | undefined {
    for (const surfaceState of runtime.store.surfaces.values()) {
      const componentDef = surfaceState.components.get(id)
      if (componentDef) return componentDef
    }
    return undefined
  }

  /** 点击组件：高亮 + 在输入框插入 @Type[id] 引用 + 记录 ElementReference 供增量修改用 */
  function onClickComponent(componentDef: ComponentDef) {
    selectedId.value = componentDef.id
    // 组装服务端协议要求的 ElementReference 结构：组件标识 + 当前属性/样式快照
    selectedElement.value = {
      componentId: componentDef.id,
      type: componentDef.componentType,
      path: componentDef.id,
      currentProperties: (componentDef.props ?? {}) as Record<string, unknown>,
      currentUseHint: componentDef.useHint as ElementReference['currentUseHint'],
      currentStyles: componentDef.styles as ElementReference['currentStyles'],
    }
    // 在输入框追加引用标记，用户可在此基础上继续输入修改指令
    inputText.value += ` @${componentDef.componentType}[${componentDef.id}]`
    applySelectionHighlight()
  }

  /** 画布事件委托：点击任意组件 → 用 data-component-id 反查并选中。
   * 交互组件（INPUT/BUTTON）跳过，避免点击按钮时同时触发选中。 */
  function onCanvasClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    // 交互组件不触发选中，避免打断输入/点击
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return
    const componentEl = target.closest('[data-component-id]') as HTMLElement | null
    if (!componentEl) return
    const id = componentEl.getAttribute('data-component-id')
    if (!id) return
    const componentDef = findComponentDef(id)
    if (!componentDef) return
    onClickComponent(componentDef)
  }

  /** 重绘选中高亮：根据 selectedId 给对应组件元素打 a2ui-selected 类。
   * 每次组件树重绘后 DOM class 会丢失，需由 onUpdated 重新调用。 */
  function applySelectionHighlight() {
    const canvas = document.querySelector('.canvas') as HTMLElement | null
    if (!canvas) return
    canvas
      .querySelectorAll('.a2ui-selected')
      .forEach((element) => element.classList.remove('a2ui-selected'))
    if (selectedId.value) {
      const element = canvas.querySelector(
        `[data-component-id="${selectedId.value}"]`,
      ) as HTMLElement | null
      element?.classList.add('a2ui-selected')
    }
  }

  /** 取消选中元素：清空引用 + 移除 DOM 高亮 */
  function clearSelection() {
    selectedElement.value = null
    selectedId.value = null
    applySelectionHighlight()
  }

  // ---------- 图片 ----------
  /** 图片上传（压缩后转 base64） */
  async function onImageUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      compressing.value = true
      status.value = '图片压缩中…'
      const compressed = await compressImage(file, 1024, 0.8)
      imageBase64.value = compressed.base64
      imageName.value = file.name
      status.value = `图片已就绪（${compressed.width}×${compressed.height}）`
    } catch (err) {
      status.value = '图片处理失败: ' + (err as Error).message
    } finally {
      compressing.value = false
      // 重置 input value，允许重复选择同一文件
      ;(e.target as HTMLInputElement).value = ''
    }
  }

  // 每次组件树更新后重新应用高亮（重绘可能导致 DOM class 丢失）
  onUpdated(applySelectionHighlight)

  return {
    // ---- 响应式状态（供 App.vue 模板绑定） ----
    status,          // 状态栏文本
    loading,         // 请求中标记（禁用发送按钮）
    compressing,     // 图片压缩中标记
    messages,        // 对话消息列表
    inputText,       // 输入框文本
    selectedElement, // 当前选中组件引用（驱动徽章显示）
    imageName,       // 待发送图片文件名
    trees,           // 所有 surface 的组件树（渲染用）
    renderCtx,       // 渲染上下文（事件回传 + 数据绑定）
    // ---- 方法（供模板事件绑定） ----
    sendMessage,     // 发送对话（生成 / 增量修改）
    onImageUpload,   // 图片上传（压缩 → base64）
    onCanvasClick,   // 画布点击（事件委托选中组件）
    clearCanvas,     // 清空画布
    clearSelection,  // 取消选中
  }
}
