/**
 * 协议归一化器（字符级流式处理）
 * LLM 输出可能包含 markdown 围栏、散文解释、格式化空白等。
 * 归一化器逐字符扫描，剥离围栏/散文，对象内去空白，对象间补换行。
 */

export interface ProtocolNormalizer {
  push: (chunk: string) => string  // 喂入 chunk，返回归一化后的文本
  flush: () => void                // 流结束时调用，检查是否有未闭合对象
}

/**
 * 创建协议归一化器。
 * 使用深度计数器 depth 跟踪 JSON 对象/数组嵌套层级：
 * - depth > 0：在对象内部，过滤格式化空白（换行/回车/制表/空格），保留字符串内字符
 * - depth = 0：在对象外部，只放行 { 开始新对象和空白，丢弃围栏/散文
 */
export function createProtocolNormalizer(): ProtocolNormalizer {
  let depth = 0          // JSON 嵌套深度，0 表示对象外
  let inString = false   // 是否在字符串内
  let escaped = false    // 字符串内是否处于转义状态
  let needBoundary = false  // 下一个对象前是否需要补换行

  function push(chunk: string): string {
    let out = ''

    for (const c of chunk) {
      if (depth > 0) {
        // 对象内：过滤格式化空白，否则客户端按 \n 切分会拆坏单个对象
        if (!inString && (c === '\n' || c === '\r' || c === '\t' || c === ' ')) {
          continue
        }
        out += c
        // 字符串状态机：处理转义和引号
        if (inString) {
          if (escaped) escaped = false
          else if (c === '\\') escaped = true
          else if (c === '"') inString = false
          continue
        }
        if (c === '"') inString = true
        else if (c === '{' || c === '[') depth++
        else if (c === '}' || c === ']') {
          depth--
          // 对象闭合后，下一个对象前需要补换行
          if (depth === 0) needBoundary = true
        }
      } else {
        // 对象外：只放行 { 开始新对象，其余（围栏/散文）丢弃
        if (c === '{') {
          if (needBoundary) out += '\n'
          out += c
          depth = 1
          inString = false
          escaped = false
          needBoundary = false
        } else if (c === '\n' || c === '\r') {
          out += c
          needBoundary = false
        } else if (c === ' ' || c === '\t') {
          out += c
        }
      }
    }

    return out
  }

  function flush() {
    // 流结束时若仍有未闭合对象，警告并丢弃（客户端 Buffer 也会丢弃非法 JSON）
    if (depth > 0) {
      console.warn('[normalizer] 流结束时对象未闭合，已透传的半截 JSON 将被客户端丢弃')
    }
  }

  return { push, flush }
}

/**
 * 归一化整段协议文本：剥离 markdown 围栏与散文。
 * Agent 自检与 validate_protocol 工具共用，避免两处实现漂移。
 */
export function normalizeProtocolText(raw: string): string {
  const normalizer = createProtocolNormalizer()
  const text = normalizer.push(raw)
  normalizer.flush()
  return text
}

/** 协议校验结果 */
export interface ProtocolCheck {
  ok: boolean          // 是否完全合法
  fatal: boolean       // 致命错误（渲染不出东西），否则只是部分组件不可达
  message: string      // 可读报告
}

/**
 * 校验协议结构：必需消息、root、children 可达性。
 * 供 Agent 循环在协议下发前兜底，避免把坏界面推给前端。
 */
export function checkProtocol(jsonl: string): ProtocolCheck {
  const fail = (message: string, fatal = true): ProtocolCheck => ({ ok: false, fatal, message })

  const lines = jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return fail('协议为空')

  interface RawComponent {
    id?: string
    children?: string[]
    template?: { componentId?: string }
  }
  let components: RawComponent[] = []
  let rootId = ''
  let hasSurfaceUpdate = false
  let hasBeginRendering = false

  for (let i = 0; i < lines.length; i++) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(lines[i]) as Record<string, unknown>
    } catch {
      return fail(`第 ${i + 1} 行不是合法 JSON：${lines[i].slice(0, 120)}`)
    }
    if (msg.type === 'surfaceUpdate') {
      hasSurfaceUpdate = true
      components = (msg.components as RawComponent[]) ?? []
    }
    if (msg.type === 'beginRendering') {
      hasBeginRendering = true
      rootId = String(msg.root ?? '')
    }
  }

  if (!hasSurfaceUpdate || !hasBeginRendering) return fail('缺少 surfaceUpdate 或 beginRendering 消息')
  if (components.length === 0) return fail('surfaceUpdate 的 components 为空')
  if (!rootId) return fail('beginRendering 缺少 root 字段')

  const byId = new Map<string, RawComponent>()
  for (const component of components) {
    if (!component.id) return fail('存在缺少 id 的组件定义')
    if (byId.has(component.id)) return fail(`组件 id 重复：${component.id}`)
    byId.set(component.id, component)
  }
  if (!byId.has(rootId)) return fail(`root "${rootId}" 不在 components 中`)

  // 从 root 沿 children 深度遍历，找出挂接不到的游离组件
  const reachable = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as string
    if (reachable.has(id)) continue
    reachable.add(id)
    const component = byId.get(id)
    if (!component) return fail(`children 中引用了不存在的组件：${id}`)
    for (const childId of component.children ?? []) stack.push(childId)
    // List 模板通过 template 引用而非 children，同样属于可达组件
    const templateId = component.template?.componentId
    if (templateId) stack.push(templateId)
  }

  const orphans = components.map((c) => c.id as string).filter((id) => !reachable.has(id))
  if (orphans.length) {
    // 树本身能渲染，只是有部分组件挂不上去
    return fail(`以下组件无法从 root 到达（不会显示）：${orphans.join('、')}`, false)
  }
  return { ok: true, fatal: false, message: `校验通过：${components.length} 个组件，root=${rootId}` }
}
