/**
 * Playground 应用入口
 * 使用 React 18 的 createRoot 渲染 App 组件。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

// 挂载根组件到 #app 节点
createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
