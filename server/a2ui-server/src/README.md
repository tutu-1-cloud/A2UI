
# A2UI Server 输出示例

本文档说明 `a2ui-server` 的 HTTP 响应格式，以 `/api/chat` 为例（`/api/action` 格式相同）。

## 协议分层

服务器输出分两层，不要混淆：

| 层级 | 职责 | 事件/消息类型 |
|------|------|--------------|
| **传输层（SSE）** | 事件封装、流式分包 | `message` / `error` / `done` |
| **应用层（A2UI JSONL）** | 界面协议数据 | `createSurface` / `surfaceUpdate` / `dataModelUpdate` / `beginRendering` / `deleteSurface` |

- 传输层事件由 `transport/protocol.ts` 的 `formatAGUIEvent` 生成。

- 应用层 JSONL 由 LLM 产出，经 `agent/normalize.ts` 归一化后，作为 `message` 事件的 `data` 下发。

---

## 一、SSE 原始字节流示例

请求 `POST /api/chat`，body 为 `{ "sessionId": "default", "text": "一个标题加一个按钮" }`，响应体（原始文本）如下：

```
event: message
id: 1
data: {"type":"createSurface","surfaceId":"s1"}

event: message
id: 2
data: {"type":"surfaceUpdate","surfaceId":"s1","components":[{"id":"c1","componentType":"Column","children":["c2","c3"]},{"id":"c2","componentType":"Text","props":{"text":"你好，A2UI"}},{"id":"c3","componentType":"Button","props":{"text":"点击我"}}]}

event: message
id: 3
data: {"type":"beginRendering","surfaceId":"s1","root":"c1"}

event: done
data: {}
