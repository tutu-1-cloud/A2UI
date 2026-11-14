/**
 * Agent 工具注册表：每个工具 = JSON Schema 定义 + 执行函数。
 * 工具结果连同文本一起回喂 LLM；需要额外过程事件的工具可返回 plan。
 */

import { checkProtocol, normalizeProtocolText } from './normalize'
import type { ToolSchema } from './llm'

/** 工具执行上下文：由 Agent 入口按请求注入 */
export interface ToolContext {
  currentProtocol?: unknown   // 当前画布协议快照
}

/** 工具执行结果：文本回喂 LLM，plan 额外产出一条过程事件 */
export interface ToolResult {
  text: string
  plan?: string[]
}

export interface AgentTool {
  schema: ToolSchema
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolResult>
}

/** 提交任务计划：复杂需求先列步骤，再逐项完成 */
const setPlan: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'set_plan',
      description:
        '动手生成前提交任务计划。仅当需求包含多个模块、或预计组件数超过 6 个时调用；提交后按计划逐项完成，最后一次性输出完整协议。',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '2-6 条任务，每条一句话，按执行顺序排列',
          },
        },
        required: ['steps'],
      },
    },
  },
  async execute(args) {
    const steps = Array.isArray(args.steps)
      ? (args.steps as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : []
    if (steps.length === 0) return '计划为空，请提供至少 1 条任务'
    return { text: `计划已记录（${steps.length} 步）：${steps.join('；')}`, plan: steps }
  },
}

/** 读取当前画布快照：增量修改的前提，避免模型靠猜测改界面 */
const readCurrentUi: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'read_current_ui',
      description:
        '读取当前画布上的 A2UI 协议快照。修改已有界面（局部调整、样式变更、增删组件）前必须先调用；画布为空时返回空提示。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  async execute(_args, ctx) {
    if (!ctx.currentProtocol) return '当前画布为空，没有任何组件。'
    return String(ctx.currentProtocol)
  },
}

/** 协议自检：模型输出前确认结构合法，减少“组件定义了却不显示” */
const validateProtocol: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'validate_protocol',
      description:
        '校验一段 A2UI JSONL 协议是否合法：必需消息是否齐全、root 是否存在、每个组件是否都能从 root 沿 children 到达。返回校验报告，发现问题时按提示修正后重新调用。',
      parameters: {
        type: 'object',
        properties: {
          jsonl: { type: 'string', description: '完整协议文本，每行一条 JSON 消息' },
        },
        required: ['jsonl'],
      },
    },
  },
  async execute(args) {
    // 先归一化，避免模型把协议包在 markdown 围栏里被误判为非法
    return checkProtocol(normalizeProtocolText(String(args.jsonl ?? ''))).message
  },
}

/** 全部内置工具 */
export const AGENT_TOOLS: AgentTool[] = [setPlan, readCurrentUi, validateProtocol]

/** 按名称查找工具 */
export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.schema.function.name === name)
}
