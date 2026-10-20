// 图片压缩工具：上传前把图片缩放到合理尺寸、转 JPEG 并限制体积。
// 目的：多模态 LLM 按图片尺寸计 token，压缩显著加快首 token；
// 同时保证请求体不超过服务端 bodyParser 上限（避免 413）。
// 策略：先按最长边缩放再转 JPEG，仍超限则按「尺寸 × 质量」阶梯降质。
// 用 <img> + <canvas> + toDataURL 实现，纯前端、无依赖。

export interface CompressedImage {
  /** 不含 data: 前缀的纯 base64 */
  base64: string
  /** 完整 data URL（如 data:image/jpeg;base64,...） */
  dataUrl: string
  /** 压缩后的宽高 */
  width: number
  height: number
}

/**
 * 压缩图片。
 * @param file 原始文件
 * @param maxEdge 最长边上限（px），也是降质阶梯的第一档尺寸
 * @param quality 初始 JPEG 质量 0~1，也是质量阶梯的第一档
 * @param maxBytes 输出 base64 体积上限（字节），超限自动降质
 */
export async function compressImage(
  file: File,
  maxEdge = 1024,
  quality = 0.8,
  maxBytes = 800 * 1024,
): Promise<CompressedImage> {
  const img = await loadImage(file)

  // 降质阶梯：尺寸逐级缩（1024→768→512），质量逐级降（0.8→0.6→0.4→0.3）
  const edgeSteps = [maxEdge, Math.round(maxEdge * 0.75), Math.round(maxEdge * 0.5)]
  const qualitySteps = [quality, 0.6, 0.4, 0.3].filter((q) => q <= quality)

  // 从最高档往下试，首次 ≤ maxBytes 即返回
  for (const edge of edgeSteps) {
    const { width, height } = fitSize(img.width, img.height, edge)
    for (const q of qualitySteps) {
      const out = renderJpeg(img, width, height, q)
      if (out.base64.length <= maxBytes) return out
    }
  }

  // 最低档仍超限（极少见，如极端纹理图）：返回最低档结果兜底，避免死循环
  const { width, height } = fitSize(img.width, img.height, edgeSteps[edgeSteps.length - 1])
  return renderJpeg(img, width, height, qualitySteps[qualitySteps.length - 1])
}

/** 解码图片文件，拿到原始尺寸 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

/** 多模态模型要求图片宽高均大于 10px，低于此值的图片会被服务端拒绝 */
export const MIN_EDGE = 11

/**
 * 计算目标尺寸：
 *   - 最长边不超过 edge（缩小）
 *   - 最短边不低于 MIN_EDGE（不满足时等比放大）
 * 纯函数，便于单元测试。
 */
export function fitSize(width: number, height: number, edge: number): { width: number; height: number } {
  const max = Math.max(width, height)
  if (max > edge) {
    const ratio = edge / max
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  // 模型限制：宽高均须 > 10px。若缩放后任一边过小，等比放大到满足下限。
  const min = Math.min(width, height)
  if (min < MIN_EDGE) {
    const ratio = MIN_EDGE / min
    width = Math.max(MIN_EDGE, Math.round(width * ratio))
    height = Math.max(MIN_EDGE, Math.round(height * ratio))
  }
  return { width, height }
}

/** 用 canvas 按指定尺寸 + 质量绘制并导出 JPEG */
function renderJpeg(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): CompressedImage {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法获取 canvas 上下文')
  ctx.drawImage(img, 0, 0, width, height)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64 = dataUrl.split(',')[1] ?? ''
  return { base64, dataUrl, width, height }
}
