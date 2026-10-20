<script setup lang="ts">
// A2UI Playground 根组件：左侧对话区 + 右侧预览区。
// 所有业务逻辑（runtime / 对话 / 选中 / 图片 / SSE）封装在 usePlayground 中，
// 本组件只负责视图渲染与事件绑定。
import { renderVNode } from '@a2ui/vue'
import { usePlayground } from './composables/usePlayground'

// 从 composable 解构出状态与方法，供模板直接绑定
const {
  status,          // 状态栏文本
  loading,         // 请求中（禁用发送按钮）
  compressing,     // 图片压缩中
  messages,        // 对话消息列表
  inputText,       // 输入框文本（v-model）
  selectedElement, // 当前选中组件引用（驱动徽章显示）
  imageName,       // 待发送图片文件名
  trees,           // 所有 surface 的组件树
  renderCtx,       // 渲染上下文（事件回传 + 数据绑定）
  sendMessage,     // 发送对话
  onImageUpload,   // 图片上传
  onCanvasClick,   // 画布点击（事件委托选中组件）
  clearCanvas,     // 清空画布
  clearSelection,  // 取消选中
} = usePlayground()

/** 输入框键盘事件：Ctrl/⌘ + Enter 快捷发送 */
function onKeydown(e: KeyboardEvent) {
  // Ctrl/⌘ + Enter 发送
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    if (!loading.value && !compressing.value) void sendMessage()
  }
}
</script>

<template>
  <div class="playground">
    <!-- 顶部标题栏 -->
    <header class="header">
      <h1>A2UI Playground</h1>
      <p class="subtitle">对话式生成 UI · 点选编辑 · 多 surface</p>
    </header>

    <div class="main">
      <!-- ========== 左侧：对话区 ========== -->
      <section class="chat-panel">
        <!-- 消息列表：空状态提示 / 逐条渲染气泡 -->
        <div class="chat-list">
          <p v-if="messages.length === 0" class="chat-empty">
            描述你想要的界面，或上传图片，开始对话
          </p>
          <div
            v-for="msg in messages"
            :key="msg.id"
            :class="['msg', msg.role === 'user' ? 'msg-user' : 'msg-assistant']"
          >
            <!-- 有图片的消息前缀图片标记 -->
            <span v-if="msg.hasImage" class="msg-img-tag">🖼 </span>
            {{ msg.content }}
          </div>
        </div>

        <!-- 元素引用徽章：选中组件后显示 @Type[id]，点 × 取消选中 -->
        <div v-if="selectedElement" class="selected-element-badge">
          <span class="badge-label">
            @{{ selectedElement.type }}[{{ selectedElement.componentId }}]
          </span>
          <button class="badge-clear" title="取消选中" @click="clearSelection">×</button>
        </div>

        <!-- 输入区：文本框 + 图片上传 + 发送按钮 -->
        <div class="chat-input-row">
          <textarea
            v-model="inputText"
            class="chat-input"
            placeholder="描述界面，或点击预览组件插入 @引用…"
            @keydown="onKeydown"
          />
          <div class="chat-actions">
            <!-- 图片上传：label 包裹隐藏的 file input，点击 label 触发选择 -->
            <label class="btn btn-ghost">
              🖼 图片
              <input
                type="file"
                accept="image/*"
                style="display: none"
                @change="onImageUpload"
              />
            </label>
            <!-- 已选图片文件名提示 -->
            <span v-if="imageName" class="image-hint">{{ imageName }}</span>
            <!-- 发送按钮：loading/compressing 时禁用并切换文案 -->
            <button
              class="btn btn-primary"
              :disabled="loading || compressing"
              @click="sendMessage"
            >
              {{ loading ? '处理中…' : compressing ? '压缩中…' : '发送' }}
            </button>
          </div>
        </div>

        <!-- 状态栏：展示进度 / 结果 / 错误 -->
        <div class="status">{{ status }}</div>
      </section>

      <!-- ========== 右侧：预览区 ========== -->
      <section class="preview-panel">
        <div class="preview-head">
          <span class="preview-title">预览</span>
          <!-- 清除画布：无 surface 时禁用 -->
          <button
            class="btn btn-ghost btn-clear"
            title="清空当前画布"
            :disabled="trees.size === 0"
            @click="clearCanvas"
          >
            🗑 清除画布
          </button>
        </div>
        <!-- 画布容器：事件委托点击组件选中；遍历所有 surface 各自渲染 -->
        <div class="canvas" @click="onCanvasClick">
          <p v-if="trees.size === 0" class="empty">发送消息后，界面会渲染在这里</p>
          <div v-for="[surfaceId, tree] in trees" :key="surfaceId" class="surface">
            <div class="surface-tag">surface: {{ surfaceId }}</div>
            <!-- 动态组件：renderVNode 将 A2UI 组件树转为 VNode 渲染 -->
            <component v-if="tree" :is="renderVNode(tree, renderCtx)" />
            <p v-else class="empty">发送消息后，界面会渲染在这里</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
