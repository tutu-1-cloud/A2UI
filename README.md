# A2UI 生成式 UI Agent

从零实现的「生成式 UI Agent」：用户用文字 / 图片 / 点击元素表达界面需求，Agent 让 LLM 输出 **A2UI v0.9 JSONL 协议**，通过**自定义 SSE** 流式推给前端，前端 SDK 解析成组件树并渲染成可交互页面；选中组件后的修改走**前端 diff**，只更新变化的组件。

## 技术栈

- monorepo（pnpm workspace）
- `packages/a2ui-core` —— 纯 TS，框架无关（Parser / Buffer / Store / TreeBuilder）
- `packages/a2ui-react` —— React 渲染层（`createElement` 递归渲染）
- `server/a2ui-server` —— Koa 服务端（SSE + LLM Agent + 字符级协议归一化）
- `web/playground` —— 调试前端（Vite + React，Hooks 驱动）

## 整体数据流

```
用户输入（文字 / 图片 / 点选组件）
        │
        ▼
POST /api/chat 或 /api/action（携带当前协议快照 currentProtocol）
        │
        ▼
agent/index.ts        LLM 流式调用（AsyncGenerator 逐 token yield）
        │
        ▼
agent/normalize.ts    字符级归一化（剥围栏/散文、补换行、滤对象内空白）
        │
        ▼
routes/stream.ts + transport/   SSE 事件包装（message/error/done）→ 写流
        │   （HTTP SSE 流）
        ▼
playground/sse.ts     客户端解析 SSE → 拼回完整 JSONL
        │
        ▼
a2ui-core buffer      按 \n 跨 chunk 拼包 → parser 逐行解析 → store 应用状态
        │
        ▼
treebuilder           扁平定义 → VNode 树（循环检测 + List 展开）
        │
        ▼
a2ui-react renderer   createElement 递归渲染成 DOM（点选修改走前端 diff 增量更新）
```

## 目录结构

```
packages/
  a2ui-core/src/            # types 协议类型 / parser 行解析 / buffer 流式拼包
                            # store 状态中枢 / treebuilder 建树+循环检测+List展开 / index 装配 createA2UI()
  a2ui-react/src/           # renderer 8 种组件渲染（createElement 递归）/ theme useHint→CSS 查表+三层合并 / index
  a2ui-vue/src/             # 旧 Vue 渲染层（已停用，保留供参考）
server/a2ui-server/src/
  agent/                    # index LLM 调用（文本/多模态自动选模）/ normalize 字符级归一化 / prompt 系统提示词
  routes/                   # chat / action / stream（两者共用的流式编排）
  transport/                # sse 底层写流 / protocol 事件包装（message/error/done）
  index.ts                  # Koa 装配与启动（/api/health /api/chat /api/action）
  session.ts                # 内存会话、多轮历史截断（最近 10 轮）
  openai.d.ts               # openai SDK 兜底类型声明
web/playground/src/
  main.tsx                  # React 入口（createRoot 挂载）
  App.tsx                   # 根组件：视图渲染与事件绑定（对话区 / 输入区 / 预览画布）
  hooks/usePlayground.ts    # 核心业务逻辑（runtime 管理、对话、点选、图片、SSE）
  diff.ts                   # 前端增量 diff（add / remove / update）
  snapshot.ts               # 当前界面完整协议快照（每次请求随传）
  sse.ts                    # SSE 客户端解析（手写 fetch reader）
  image.ts                  # 图片压缩（canvas 缩放 + JPEG 阶梯降质，无依赖）
  style.css
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 LLM：在 server/a2ui-server/.env 中填写（见下方）

# 3. 启动服务端（3000）与前端 playground（5173）
pnpm dev
```

分开启动：

```bash
pnpm --filter @a2ui/server dev          # http://127.0.0.1:3000
pnpm --filter @a2ui/playground dev      # http://127.0.0.1:5173
```

打开 http://127.0.0.1:5173 即可体验：文字/图片生成界面（SSE 流式渲染）、点击组件高亮并插入 `@Button[c1]` 引用后增量修改（前端 diff）、按钮事件回传 `/api/action`、一键清除画布（保留对话历史）。

## 配置 LLM（必需）

服务端只接真实 LLM（OpenAI 兼容接口），没有 Mock 模式。配置入口是 `server/a2ui-server/.env`（`.gitignore` 已忽略，不会提交）：

```env
OPENAI_API_KEY=sk-xxxxxxxx                    # 必填
OPENAI_BASE_URL=https://api.deepseek.com/v1   # OpenAI 兼容地址，留空用官方
OPENAI_MODEL=gpt-4o-mini                      # 纯文本模型
OPENAI_VL_MODEL=qwen-vl-plus                  # 含图片请求时自动切换的多模态模型
```

- 纯文本请求走 `OPENAI_MODEL`；消息带图片时自动切到 `OPENAI_VL_MODEL`。
- 配置生效后 `http://127.0.0.1:3000/api/health` 返回 `hasRealAgent: true`。

## 核心设计要点

- **协议 v0.9**：5 种消息（createSurface / surfaceUpdate / dataModelUpdate / beginRendering / deleteSurface）+ 8 种组件（Text / Button / Image / Input 原子 + Column / Row / Card / List 容器），扁平 `children` 指针结构。
- **三层流式管道**：服务端逐 chunk 归一化（边收边发）→ SSE 换行拆分 → 客户端 Buffer 跨 chunk 拼包。
- **增量修改**：前端上传协议快照 → LLM 输出完整协议 → 服务端 `isCompleteProtocol` 拦截补丁 → 前端 `generateDiff` 只应用 add / remove / update，未变组件 DOM 复用。
- **React 非受控输入**：Input 用 `defaultValue`（非受控），用户输入只经 `writeBinding` 本地回写 dataModel，不触发 `/api/action`，避免逐键重绘导致输入内容丢失。
- **事件回传**：组件动作转成 `[组件事件]` 文本走与 chat 相同的 Agent 链路。
- **多轮记忆**：服务端内存会话保留最近 10 轮；协议状态以客户端快照为准。
- **健壮性**：坏 JSONL 行丢弃不中断流、未知组件渲染占位不崩溃、循环引用检测跳过、LLM 发明的数据路径安全读写。
