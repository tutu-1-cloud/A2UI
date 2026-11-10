/**
 * Playground 主组件
 * 左侧聊天面板（输入/消息列表），右侧预览面板（渲染 A2UI 协议生成的界面）。
 */

import { renderVNode } from '@a2ui/react'
import { usePlayground } from './hooks/usePlayground'

export default function App() {
  // 从 usePlayground 获取所有状态和操作方法
  const {
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
  } = usePlayground()

  // Ctrl/⌘ + Enter 快捷发送
  function onKeydown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!loading && !compressing) void sendMessage()
    }
  }

  return (
    <div className="playground">
      {/* 顶部标题 */}
      <header className="header">
        <h1>A2UI Playground</h1>
        <p className="subtitle">对话式生成 UI · 点选编辑 · 多 surface</p>
      </header>

      <div className="main">
        {/* 左侧聊天面板 */}
        <section className="chat-panel">
          <div className="chat-list">
            {messages.length === 0 && (
              <p className="chat-empty">描述你想要的界面，或上传图片，开始对话</p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={['msg', msg.role === 'user' ? 'msg-user' : 'msg-assistant'].join(' ')}
              >
                {msg.hasImage && <span className="msg-img-tag">🖼 </span>}
                {msg.content}
              </div>
            ))}
          </div>

          {/* 选中组件徽章：显示 @Type[id] 和取消按钮 */}
          {selectedElement && (
            <div className="selected-element-badge">
              <span className="badge-label">
                @{selectedElement.type}[{selectedElement.componentId}]
              </span>
              <button className="badge-clear" title="取消选中" onClick={clearSelection}>×</button>
            </div>
          )}

          {/* 输入行：textarea + 图片上传 + 发送按钮 */}
          <div className="chat-input-row">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="chat-input"
              placeholder="描述界面，或点击预览组件插入 @引用…"
              onKeyDown={onKeydown}
            />
            <div className="chat-actions">
              {/* 图片上传：label 包裹隐藏的 file input */}
              <label className="btn btn-ghost">
                🖼 图片
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={onImageUpload}
                />
              </label>
              {imageName && <span className="image-hint">{imageName}</span>}
              <button
                className="btn btn-primary"
                disabled={loading || compressing}
                onClick={sendMessage}
              >
                {loading ? '处理中…' : compressing ? '压缩中…' : '发送'}
              </button>
            </div>
          </div>

          {/* 状态提示 */}
          <div className="status">{status}</div>
        </section>

        {/* 右侧预览面板 */}
        <section className="preview-panel">
          <div className="preview-head">
            <span className="preview-title">预览</span>
            <button
              className="btn btn-ghost btn-clear"
              title="清空当前画布"
              disabled={trees.size === 0}
              onClick={clearCanvas}
            >
              🗑 清除画布
            </button>
          </div>
          {/* 画布区域：点击事件委托用于选中组件 */}
          <div className="canvas" onClick={onCanvasClick}>
            {trees.size === 0 && (
              <p className="empty">发送消息后，界面会渲染在这里</p>
            )}
            {/* 遍历所有 surface，渲染对应的树 */}
            {Array.from(trees.entries()).map(([surfaceId, tree]) => (
              <div key={surfaceId} className="surface">
                <div className="surface-tag">surface: {surfaceId}</div>
                {tree ? renderVNode(tree, renderCtx) : (
                  <p className="empty">发送消息后，界面会渲染在这里</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
