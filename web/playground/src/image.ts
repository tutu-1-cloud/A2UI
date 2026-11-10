/**
 * 图片压缩工具
 * 按最长边缩放 + JPEG 质量阶梯降质，控制体积避免超后端 bodyParser 上限（20mb）。
 * 多模态模型要求图片宽高均 > 10px。
 */

/** 压缩结果：base64、dataUrl、宽高 */
export interface CompressedImage {
  base64: string
  dataUrl: string
  width: number
  height: number
}

/**
 * 压缩图片。
 * 策略：先按最长边缩放，再逐级降低 JPEG 质量，直到体积达标。
 * 所有档位都试过仍超限时，返回最低档结果（兜底）。
 *
 * @param file 图片文件
 * @param maxEdge 最长边上限（默认 1024px）
 * @param quality 起始 JPEG 质量（默认 0.8）
 * @param maxBytes 最大字节数（默认 800KB）
 */
export async function compressImage(
  file: File,
  maxEdge = 1024,
  quality = 0.8,
  maxBytes = 800 * 1024,
): Promise<CompressedImage> {
  const img = await loadImage(file)

  // 尺寸档位：maxEdge → 75% → 50%
  const edgeSteps = [maxEdge, Math.round(maxEdge * 0.75), Math.round(maxEdge * 0.5)]
  // 质量档位：从起始质量逐步降低，不高于起始值
  const qualitySteps = [quality, 0.6, 0.4, 0.3].filter((q) => q <= quality)

  // 遍历尺寸 × 质量组合，返回第一个达标的结果
  for (const edge of edgeSteps) {
    const { width, height } = fitSize(img.width, img.height, edge)
    for (const q of qualitySteps) {
      const out = renderJpeg(img, width, height, q)
      if (out.base64.length <= maxBytes) return out
    }
  }

  // 所有档位都超限，返回最低档兜底，避免死循环
  const { width, height } = fitSize(img.width, img.height, edgeSteps[edgeSteps.length - 1])
  return renderJpeg(img, width, height, qualitySteps[qualitySteps.length - 1])
}

/** 加载图片为 HTMLImageElement */
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

/** 多模态模型要求图片宽高均 > 10px */
export const MIN_EDGE = 11

/**
 * 按最长边等比缩放，确保短边不小于 MIN_EDGE。
 * @param width 原始宽度
 * @param height 原始高度
 * @param edge 最长边上限
 */
export function fitSize(width: number, height: number, edge: number): { width: number; height: number } {
  const max = Math.max(width, height)
  if (max > edge) {
    const ratio = edge / max
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  // 短边不小于 MIN_EDGE，过小则等比放大
  const min = Math.min(width, height)
  if (min < MIN_EDGE) {
    const ratio = MIN_EDGE / min
    width = Math.max(MIN_EDGE, Math.round(width * ratio))
    height = Math.max(MIN_EDGE, Math.round(height * ratio))
  }
  return { width, height }
}

/** 用 canvas 绘制并导出 JPEG base64 */
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
  // 去掉 data:image/jpeg;base64, 前缀，只保留 base64 部分
  const base64 = dataUrl.split(',')[1] ?? ''
  return { base64, dataUrl, width, height }
}
