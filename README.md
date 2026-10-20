# A2UI 生成式 UI Agent

一个从零实现的「生成式 UI Agent」：用户用文字、图片或点选组件表达界面需求，服务端驱动 LLM 输出 **A2UI v0.9 JSONL 协议**，经自定义 SSE 流式推送到前端，前端 SDK 实时解析成组件树并渲染为可交互页面；点选组件后的修改走前端 diff，只更新变化的部分。

## 核心特性

- **对话生成界面**：自然语言描述需求，SSE 流式渲染，界面逐 chunk 出现
- **图片生成界面**：上传截图/设计稿，多模态模型分析布局并还原为组件树（自动切换 VL 模型）
- **点选增量修改**：点击画布中的组件插入 `@Button[btn_1]` 引用，LLM 返回完整协议，前端 diff 只更新变化的组件——输入框内容与选中态不丢
- **组件事件回传**：按钮点击等事件转成 `[组件事件]` 消息走同一 Agent 链路，生成的界面真正可交互
- **多轮记忆**：服务端内存会话保留最近 10 轮对话注入 prompt；协议状态以前端快照为准，两端不漂移
- **鲁棒的流式管道**：字符级归一化修 LLM 不守规范的输出（围栏/散文/漏换行），客户端 Buffer 跨 chunk 拼包，坏行丢弃不中断

## 工作原理

```
用户输入（文字 / 图片 / 点选组件 / 组件事件）
        │
        ▼
POST /api/chat 或 /api/action（携带当前协议快照）
        │
        ▼
LLM 流式输出 → 字符级归一化（修成合法 JSONL）
        │
        ▼
自定义 SSE（message / error / done 事件）
        │
        ▼
前端 Buffer 拼包 → Parser 解析 → Store 应用 → TreeBuilder 建树
        │
        ▼
Vue h() 渲染成 DOM（点选修改走前端 diff 增量更新）
```

闭环特征：数据出去时是「用户意图」（文本 / 快照 / 动作），回来时永远是「完整协议」——这是支持增量 diff 和多轮对话的基础。

## A2UI v0.9 协议简介

每行一条 JSON 消息（JSONL），共 5 种：

| 消息 | 作用 |
|------|------|
| `createSurface` | 创建画布 |
| `surfaceUpdate` | 批量更新组件定义（扁平结构，children 为 id 指针） |
| `dataModelUpdate` | 更新数据模型（按路径写入） |
| `beginRendering` | 指定根组件，开始渲染 |
| `deleteSurface` | 删除画布 |

组件 8 种：原子 `Text / Button / Image / Input`，容器 `Column / Row / Card / List`。样式分两层：`useHint` 语义化提示（间距、对齐、主题色等）+ `styles` 精细覆盖，优先级 `styles > useHint > 默认`。

## 技术栈与目录结构

pnpm workspace monorepo，四层分离：

```
packages/
  a2ui-core/      # 协议内核（纯 TS，框架无关）
                  #   types 协议类型 / parser 行解析 / buffer 流式拼包
                  #   store 状态中枢 / treebuilder 建树 + 循环检测 + List 展开
  a2ui-vue/       # Vue 3 渲染层：renderer（h 递归渲染 8 种组件）/ theme（useHint → CSS）
server/
  a2ui-server/    # Koa 服务端
                  #   agent/    LLM 调用 + 字符级归一化 + system prompt
                  #   routes/   chat / action / stream（共用流式编排）
                  #   transport/ SSE 写流 + 事件包装
web/
  playground/     # 调试前端（Vite + Vue 3）
                  #   composables/usePlayground 核心业务逻辑
                  #   sse / diff / snapshot / image 工具模块
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 LLM：在 server/a2ui-server/src/agent/index.ts 顶部的
#    LLM_CONFIG 里填 apiKey / baseURL / model / vlModel

# 3. 同时启动服务端（3000）与 playground（5173）
pnpm dev
```

打开 http://127.0.0.1:5173 即可体验。

也可分开启动：

```bash
pnpm --filter @a2ui/server dev       # http://127.0.0.1:3000
pnpm --filter @a2ui/playground dev   # http://127.0.0.1:5173
```

## 配置 LLM（必需）

服务端只接真实 LLM（OpenAI 兼容接口），无 Mock 模式。配置入口是 `server/a2ui-server/src/agent/index.ts` 顶部的 `LLM_CONFIG`：

```ts
const LLM_CONFIG = {
  apiKey: 'sk-xxxxxxxx',                    // 你的 API Key
  baseURL: 'https://api.deepseek.com/v1',   // OpenAI 兼容地址，留空用官方
  model: 'gpt-4o-mini',                     // 纯文本模型
  vlModel: 'qwen3-vl-plus',                 // 含图片请求时自动切换
}
```

- 纯文本请求走 `model`；消息带图片时自动切到 `vlModel`
- 使用国内兼容服务（DeepSeek、通义千问、Moonshot 等）时，`baseURL` 与模型名一起改
- 配置生效后 http://127.0.0.1:3000/api/health 返回 `hasRealAgent: true`
