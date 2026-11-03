// 图片压缩：按最长边缩放 + JPEG 质量阶梯，控制体积避免超 bodyParser 上限。

export interface CompressedImage {
  base64: string
  dataUrl: string
  width: number
  height: number
}

export async function compressImage(
  file: File,
  maxEdge = 1024,
  quality = 0.8,
  maxBytes = 800 * 1024,
): Promise<CompressedImage> {
  const img = await loadImage(file)

  const edgeSteps = [maxEdge, Math.round(maxEdge * 0.75), Math.round(maxEdge * 0.5)]
  const qualitySteps = [quality, 0.6, 0.4, 0.3].filter((q) => q <= quality)

  for (const edge of edgeSteps) {
    const { width, height } = fitSize(img.width, img.height, edge)
    for (const q of qualitySteps) {
      const out = renderJpeg(img, width, height, q)
      if (out.base64.length <= maxBytes) return out
    }
  }

  // 最低档兜底，避免死循环。
  const { width, height } = fitSize(img.width, img.height, edgeSteps[edgeSteps.length - 1])
  return renderJpeg(img, width, height, qualitySteps[qualitySteps.length - 1])
}

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

// 多模态模型要求图片宽高均 > 10px。
export const MIN_EDGE = 11

export function fitSize(width: number, height: number, edge: number): { width: number; height: number } {
  const max = Math.max(width, height)
  if (max > edge) {
    const ratio = edge / max
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  const min = Math.min(width, height)
  if (min < MIN_EDGE) {
    const ratio = MIN_EDGE / min
    width = Math.max(MIN_EDGE, Math.round(width * ratio))
    height = Math.max(MIN_EDGE, Math.round(height * ratio))
  }
  return { width, height }
}

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
