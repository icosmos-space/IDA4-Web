import type { GenerateOptions, Raster, WatermarkStyle } from './types'
import { A4, defaultPhotocopy, defaultWatermark } from './types'
import {
  applyPhotocopyLook,
  createRaster,
  grayscale,
  rasterToCanvas,
  rotateBy,
  scaleToCard,
} from './imageOps'

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi)
}

function styleCard(src: Raster, cardW: number, cardH: number, opts: GenerateOptions): Raster {
  let out = scaleToCard(src, cardW, cardH)
  if (opts.photocopyLook) out = applyPhotocopyLook(out, opts.dpi, defaultPhotocopy())
  if (opts.grayscale) out = grayscale(out)
  return out
}

function drawCard(
  canvas: HTMLCanvasElement,
  srcCanvas: HTMLCanvasElement,
  slotX: number,
  slotY: number,
  cardW: number,
  cardH: number,
  angle = 0,
  offsetX = 0,
  offsetY = 0,
): void {
  const ctx = canvas.getContext('2d')!
  ctx.save()
  const cx = slotX + cardW / 2 + offsetX
  const cy = slotY + cardH / 2 + offsetY
  ctx.translate(cx, cy)
  if (angle) ctx.rotate((angle * Math.PI) / 180)
  ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2)
  ctx.restore()
}

export function applyWatermark(srcCanvas: HTMLCanvasElement, style: Partial<WatermarkStyle> = {}): HTMLCanvasElement {
  const s = { ...defaultWatermark(), ...style }
  const text = (s.text || defaultWatermark().text).trim()
  const fontSize = s.fontSizePx > 0 ? s.fontSizePx : 36
  const lineSpacing = s.lineSpacing > 0 ? s.lineSpacing : 96
  const opacity = s.opacity > 0 ? s.opacity : 56
  const angle = s.angleDegrees
  const letterSpacing = s.letterSpacing

  const stamp = document.createElement('canvas')
  const sctx = stamp.getContext('2d')!
  sctx.font = `500 ${fontSize}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
  const chars = Array.from(text)
  const widths = chars.map((c) => sctx.measureText(c).width)
  const total =
    widths.reduce((a, b) => a + b, 0) +
    (chars.length > 1 ? letterSpacing * (chars.length - 1) : 0)
  const height = Math.ceil(fontSize * 1.4)
  const pad = 8
  stamp.width = Math.max(1, Math.ceil(total + pad * 2))
  stamp.height = height + pad * 2
  const sctx2 = stamp.getContext('2d')!
  sctx2.font = `500 ${fontSize}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
  sctx2.fillStyle = `rgba(120,120,120,${opacity / 255})`
  sctx2.textBaseline = 'top'
  let x = pad
  const y = pad
  chars.forEach((c, i) => {
    sctx2.fillText(c, x, y)
    x += widths[i]
    if (i < chars.length - 1) x += letterSpacing
  })

  // rotate stamp
  const rotated = document.createElement('canvas')
  const rad = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  rotated.width = Math.ceil(stamp.width * cos + stamp.height * sin)
  rotated.height = Math.ceil(stamp.width * sin + stamp.height * cos)
  const rctx = rotated.getContext('2d')!
  rctx.translate(rotated.width / 2, rotated.height / 2)
  rctx.rotate(rad)
  rctx.drawImage(stamp, -stamp.width / 2, -stamp.height / 2)

  const out = document.createElement('canvas')
  out.width = srcCanvas.width
  out.height = srcCanvas.height
  const octx = out.getContext('2d')!
  octx.drawImage(srcCanvas, 0, 0)

  const stepX = Math.max(48, rotated.width + Math.max(24, letterSpacing * 4))
  const stepY = Math.max(48, rotated.height + lineSpacing)
  let row = 0
  for (let y = -rotated.height; y < out.height + rotated.height; y += stepY) {
    const offsetX = row % 2 === 1 ? stepX / 2 : 0
    for (let x = -rotated.width + offsetX; x < out.width + rotated.width; x += stepX) {
      octx.drawImage(rotated, x, y)
    }
    row++
  }
  return out
}

export function renderA4Sheet(
  front: Raster,
  back: Raster,
  cardWidthMM: number,
  cardHeightMM: number,
  opts: GenerateOptions,
): HTMLCanvasElement {
  const dpi = opts.dpi > 0 ? opts.dpi : 300
  const pageW = mmToPx(A4.widthMM, dpi)
  const pageH = mmToPx(A4.heightMM, dpi)
  const cardW = mmToPx(cardWidthMM, dpi)
  const cardH = mmToPx(cardHeightMM, dpi)

  const canvas = document.createElement('canvas')
  canvas.width = pageW
  canvas.height = pageH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pageW, pageH)

  const marginPx = mmToPx(opts.marginMM, dpi)
  const gapPx = mmToPx(opts.gapMM, dpi)
  const centerX = Math.floor((pageW - cardW) / 2)

  const frontStyled = styleCard(front, cardW, cardH, opts)
  const backStyled = styleCard(back, cardW, cardH, opts)
  const frontCanvas = rasterToCanvas(frontStyled)
  const backCanvas = rasterToCanvas(backStyled)

  const totalH = cardH * 2 + gapPx
  let startY = Math.floor((pageH - totalH) / 2)
  if (startY < marginPx) startY = marginPx

  if (opts.randomTilt) {
    const maxTilt = opts.maxTiltDegrees > 0 ? opts.maxTiltDegrees : 3
    const maxOffMM = opts.maxOffsetMM > 0 ? opts.maxOffsetMM : 2.5
    const maxOff = mmToPx(maxOffMM, dpi)
    const rand = (m: number) => (Math.random() * 2 - 1) * m
    drawCard(
      canvas,
      rasterToCanvas(rotateBy(frontStyled, rand(maxTilt))),
      centerX,
      startY,
      cardW,
      cardH,
      0,
      Math.round(rand(maxOff)),
      Math.round(rand(maxOff)),
    )
    // rotateBy already applied angle; draw without extra rotate
    drawCard(
      canvas,
      rasterToCanvas(rotateBy(backStyled, rand(maxTilt))),
      centerX,
      startY + cardH + gapPx,
      cardW,
      cardH,
      0,
      Math.round(rand(maxOff)),
      Math.round(rand(maxOff)),
    )
  } else {
    drawCard(canvas, frontCanvas, centerX, startY, cardW, cardH)
    drawCard(canvas, backCanvas, centerX, startY + cardH + gapPx, cardW, cardH)
  }

  if (opts.watermarkEnabled) {
    return applyWatermark(canvas, {
      text: opts.watermarkText,
      fontSizePx: opts.watermarkFontSize * (dpi / 300),
      angleDegrees: opts.watermarkAngle,
      letterSpacing: opts.watermarkLetterSpacing * (dpi / 300),
      lineSpacing: opts.watermarkLineSpacing * (dpi / 300),
      opacity: 56,
    })
  }
  return canvas
}

export function sheetToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality)
  })
}

export { createRaster }
