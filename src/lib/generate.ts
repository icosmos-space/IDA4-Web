import type { GenerateOptions } from './types'
import { ID_CARD, defaultOptions } from './types'
import { decodeImageBlob } from './imageOps'
import { processCardImage } from './cardCorrection'
import { loadCardCorrectionSession } from './ort'
import { renderA4Sheet } from './layout'
import { canvasToPdfBlob } from './pdf'

export interface GenerateResult {
  sheet: HTMLCanvasElement
  /** Downscaled full-page preview (data URL), for UI display */
  sheetPreviewUrl: string
  frontPreview: string
  backPreview: string
  pdfBlob: Blob
  durationMs: number
  engineUsed: string
  warnings: string[]
}

export type ProgressFn = (message: string, ratio: number) => void

function canvasPreview(canvas: HTMLCanvasElement, maxW = 720): string {
  const scale = Math.min(1, maxW / canvas.width)
  const c = document.createElement('canvas')
  c.width = Math.round(canvas.width * scale)
  c.height = Math.round(canvas.height * scale)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
}

/** Full A4 for PDF; preview uses a downscaled data URL so the whole page is visible. */
function sheetPreviewUrl(canvas: HTMLCanvasElement): string {
  const maxH = 1400
  const scale = Math.min(1, maxH / canvas.height)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(canvas.width * scale))
  c.height = Math.max(1, Math.round(canvas.height * scale))
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.88)
}

export async function generateIDCardPdf(
  frontBlob: Blob,
  backBlob: Blob,
  optionsPartial: Partial<GenerateOptions> = {},
  onProgress: ProgressFn = () => {},
): Promise<GenerateResult> {
  const opts = { ...defaultOptions(), ...optionsPartial }
  const warnings: string[] = []
  const started = performance.now()
  let engineUsed = opts.engine

  if (opts.engine === 'card_correction') {
    onProgress('正在加载 ONNX 模型…', 0.05)
    try {
      await loadCardCorrectionSession()
    } catch (err) {
      if (!opts.allowFallback) throw err
      warnings.push(String(err instanceof Error ? err.message : err))
      opts.engine = 'native'
      engineUsed = 'native'
      warnings.push('ONNX 不可用，已降级为边缘检测')
    }
  }

  onProgress('正在解码图片…', 0.15)
  const [frontRaw, backRaw] = await Promise.all([
    decodeImageBlob(frontBlob),
    decodeImageBlob(backBlob),
  ])

  onProgress(`正在矫正国徽面（${engineUsed}）…`, 0.3)
  const front = await processCardImage(frontRaw, {
    aspectRatio: ID_CARD.aspect,
    enhance: opts.enhance,
    allowFallback: opts.allowFallback,
    engine: opts.engine,
    side: 'front',
  })

  onProgress(`正在矫正人像面（${engineUsed}）…`, 0.55)
  const back = await processCardImage(backRaw, {
    aspectRatio: ID_CARD.aspect,
    enhance: opts.enhance,
    allowFallback: opts.allowFallback,
    engine: opts.engine,
    side: 'back',
  })

  onProgress('正在排版 A4…', 0.75)
  const sheet = renderA4Sheet(front, back, ID_CARD.widthMM, ID_CARD.heightMM, opts)

  onProgress('正在生成 PDF…', 0.9)
  const pdfBlob = await canvasToPdfBlob(sheet, '身份证复印件')

  onProgress('完成', 1)
  return {
    sheet,
    sheetPreviewUrl: sheetPreviewUrl(sheet),
    frontPreview: canvasPreview(frontPreviewCanvas(front)),
    backPreview: canvasPreview(frontPreviewCanvas(back)),
    pdfBlob,
    durationMs: performance.now() - started,
    engineUsed,
    warnings,
  }
}

function frontPreviewCanvas(raster: { width: number; height: number; data: Uint8ClampedArray }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = raster.width
  c.height = raster.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
  return c
}
