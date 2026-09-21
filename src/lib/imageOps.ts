import type { PhotocopyStyle, Point, Quad, Raster } from './types'
import { applyMat3, computeHomography, invertMat3, quadOutputSize, orderQuad } from './geometry'
import { defaultPhotocopy } from './types'

export function createRaster(width: number, height: number, fill?: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill) {
    const [r, g, b, a] = fill
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data }
}

export function cloneRaster(src: Raster): Raster {
  return {
    width: src.width,
    height: src.height,
    data: new Uint8ClampedArray(src.data),
  }
}

export function rasterToCanvas(src: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')!
  const img = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function canvasToRaster(canvas: HTMLCanvasElement): Raster {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: img.width,
    height: img.height,
    data: img.data,
  }
}

export async function decodeImageBlob(blob: Blob): Promise<Raster> {
  const bitmap = await createImageBitmap(blob)
  const w = bitmap.width
  const h = bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvasToRaster(canvas)
}

export function sampleBilinearRGBA(src: Raster, x: number, y: number): [number, number, number] {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) {
    return [255, 255, 255]
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  let x1 = x0 + 1
  let y1 = y0 + 1
  if (x1 >= src.width) x1 = src.width - 1
  if (y1 >= src.height) y1 = src.height - 1
  const dx = x - x0
  const dy = y - y0
  const p = src.data
  const i00 = (y0 * src.width + x0) * 4
  const i10 = (y0 * src.width + x1) * 4
  const i01 = (y1 * src.width + x0) * 4
  const i11 = (y1 * src.width + x1) * 4
  const r =
    (1 - dx) * (1 - dy) * p[i00] + dx * (1 - dy) * p[i10] + (1 - dx) * dy * p[i01] + dx * dy * p[i11]
  const g =
    (1 - dx) * (1 - dy) * p[i00 + 1] +
    dx * (1 - dy) * p[i10 + 1] +
    (1 - dx) * dy * p[i01 + 1] +
    dx * dy * p[i11 + 1]
  const b =
    (1 - dx) * (1 - dy) * p[i00 + 2] +
    dx * (1 - dy) * p[i10 + 2] +
    (1 - dx) * dy * p[i01 + 2] +
    dx * dy * p[i11 + 2]
  return [r, g, b]
}

export function warpHomography(src: Raster, quad: Quad): Raster {
  const [outW, outH] = quadOutputSize(quad)
  if (outW < 2 || outH < 2) {
    throw new Error('invalid quad size')
  }
  const dstPts: Quad = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ]
  const h = computeHomography(quad, dstPts)
  const inv = invertMat3(h)
  if (!inv) throw new Error('singular homography')

  const dst = createRaster(outW, outH, [255, 255, 255, 255])
  for (let y = 0; y < outH; y++) {
    const row = y * outW * 4
    for (let x = 0; x < outW; x++) {
      const pt = applyMat3(inv, x, y)
      const off = row + x * 4
      if (!pt) {
        dst.data[off] = 255
        dst.data[off + 1] = 255
        dst.data[off + 2] = 255
        dst.data[off + 3] = 255
        continue
      }
      const [r, g, b] = sampleBilinearRGBA(src, pt.x, pt.y)
      dst.data[off] = r
      dst.data[off + 1] = g
      dst.data[off + 2] = b
      dst.data[off + 3] = 255
    }
  }
  return dst
}

export function rotateCanvas(src: Raster, degrees: 90 | 180 | 270): Raster {
  const srcCanvas = rasterToCanvas(src)
  const dst = document.createElement('canvas')
  if (degrees === 180) {
    dst.width = src.width
    dst.height = src.height
  } else {
    dst.width = src.height
    dst.height = src.width
  }
  const ctx = dst.getContext('2d', { willReadFrequently: true })!
  ctx.translate(dst.width / 2, dst.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(srcCanvas, -src.width / 2, -src.height / 2)
  return canvasToRaster(dst)
}

export function rotateBy(src: Raster, deg: number, background = '#ffffff'): Raster {
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.ceil(src.width * cos + src.height * sin)
  const h = Math.ceil(src.width * sin + src.height * cos)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  ctx.translate(w / 2, h / 2)
  ctx.rotate(rad)
  ctx.drawImage(rasterToCanvas(src), -src.width / 2, -src.height / 2)
  return canvasToRaster(canvas)
}

export function resizeRaster(src: Raster, width: number, height: number): Raster {
  if (src.width === width && src.height === height) return cloneRaster(src)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(rasterToCanvas(src), 0, 0, canvas.width, canvas.height)
  return canvasToRaster(canvas)
}

export function cropCenter(src: Raster, cropW: number, cropH: number): Raster {
  const cw = Math.max(1, Math.min(src.width, Math.round(cropW)))
  const ch = Math.max(1, Math.min(src.height, Math.round(cropH)))
  const x = Math.max(0, Math.floor((src.width - cw) / 2))
  const y = Math.max(0, Math.floor((src.height - ch) / 2))
  const dst = createRaster(cw, ch)
  for (let row = 0; row < ch; row++) {
    const srcOff = ((y + row) * src.width + x) * 4
    const dstOff = row * cw * 4
    dst.data.set(src.data.subarray(srcOff, srcOff + cw * 4), dstOff)
  }
  return dst
}

export function cropToAspect(src: Raster, aspect: number): Raster {
  if (aspect <= 0) return cloneRaster(src)
  const w = src.width
  const h = src.height
  const current = w / h
  let cropW: number
  let cropH: number
  if (current > aspect) {
    cropH = h
    cropW = Math.round(cropH * aspect)
  } else {
    cropW = w
    cropH = Math.round(cropW / aspect)
  }
  return cropCenter(src, cropW, cropH)
}

export function ensureLandscape(src: Raster, aspect: number): Raster {
  if (aspect <= 1) return src
  if (src.width >= src.height) return src
  return rotateCanvas(src, 270)
}

export function standardizeSize(src: Raster, aspect: number, width = 1011): Raster {
  const ar = aspect > 0 ? aspect : 85.6 / 54.0
  const w = width > 0 ? width : 1011
  const h = Math.max(1, Math.round(w / ar))
  const out = ensureLandscape(src, ar)
  return resizeRaster(out, w, h)
}

/** Fit entire source into card slot (letterbox on white) — never crop for display/layout. */
export function scaleToCard(src: Raster, cardW: number, cardH: number): Raster {
  if (cardW < 1 || cardH < 1) return src
  if (src.width === cardW && src.height === cardH) return src
  const canvas = document.createElement('canvas')
  canvas.width = cardW
  canvas.height = cardH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cardW, cardH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const scale = Math.min(cardW / src.width, cardH / src.height)
  const dw = src.width * scale
  const dh = src.height * scale
  ctx.drawImage(rasterToCanvas(src), (cardW - dw) / 2, (cardH - dh) / 2, dw, dh)
  return canvasToRaster(canvas)
}

export function grayscale(src: Raster): Raster {
  const dst = cloneRaster(src)
  const d = dst.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = lum
    d[i + 1] = lum
    d[i + 2] = lum
  }
  return dst
}

/** Light contrast + sharpen, approximating imaging.AdjustContrast(+10) + Sharpen(0.5). */
export function enhance(src: Raster): Raster {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.filter = 'contrast(1.12) saturate(1.05)'
  ctx.drawImage(rasterToCanvas(src), 0, 0)
  const enhanced = canvasToRaster(canvas)

  // 3x3 unsharp-ish
  const w = enhanced.width
  const h = enhanced.height
  const srcD = enhanced.data
  const out = createRaster(w, h)
  const k = [-0.05, -0.05, -0.05, -0.05, 1.2, -0.05, -0.05, -0.05, -0.05]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let ki = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, ki++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx))
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          const i = (yy * w + xx) * 4
          const kv = k[ki]
          r += srcD[i] * kv
          g += srcD[i + 1] * kv
          b += srcD[i + 2] * kv
        }
      }
      const o = (y * w + x) * 4
      out.data[o] = r
      out.data[o + 1] = g
      out.data[o + 2] = b
      out.data[o + 3] = 255
    }
  }
  return out
}

function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi
}

function smoothstep(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

function roundedRectSDF(x: number, y: number, w: number, h: number, r: number): number {
  if (r < 0) r = 0
  const maxR = Math.min(w, h) / 2
  if (r > maxR) r = maxR
  const cx = x - w / 2
  const cy = y - h / 2
  const qx = Math.abs(cx) - (w / 2 - r)
  const qy = Math.abs(cy) - (h / 2 - r)
  const outer = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inner = Math.min(Math.max(qx, qy), 0)
  return outer + inner - r
}

function edgeDarkFactor(
  inDist: number,
  edgeLine: number,
  vignette: number,
  lineStrength: number,
  vignetteStrength: number,
): number {
  if (inDist <= 0) return 1
  if (edgeLine < 0.5) edgeLine = 0.5
  if (vignette < edgeLine) vignette = edgeLine
  let lineT = 1 - inDist / edgeLine
  if (lineT < 0) lineT = 0
  const lineDark = lineStrength * smoothstep(lineT)
  let vigT = 1 - (inDist - edgeLine) / (vignette - edgeLine)
  if (vigT < 0) vigT = 0
  const vigDark = vignetteStrength * smoothstep(vigT) * smoothstep(inDist / vignette)
  return Math.min(0.85, lineDark + vigDark)
}

export function applyPhotocopyLook(src: Raster, dpi: number, style: PhotocopyStyle = defaultPhotocopy()): Raster {
  const d = dpi > 0 ? dpi : 300
  const w = src.width
  const h = src.height
  if (w < 2 || h < 2) return src
  const radius = mmToPx(style.cornerRadiusMM, d)
  const edgeLine = mmToPx(style.edgeLineMM, d)
  const vignette = mmToPx(style.edgeVignetteMM, d)
  const dst = createRaster(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sdf = roundedRectSDF(x + 0.5, y + 0.5, w, h, radius)
      const o = (y * w + x) * 4
      if (sdf > 0) {
        dst.data[o] = 255
        dst.data[o + 1] = 255
        dst.data[o + 2] = 255
        dst.data[o + 3] = 255
        continue
      }
      const i = o
      const dark = edgeDarkFactor(-sdf, edgeLine, vignette, style.edgeLineStrength, style.vignetteStrength)
      const mul = 1 - dark
      dst.data[o] = src.data[i] * mul
      dst.data[o + 1] = src.data[i + 1] * mul
      dst.data[o + 2] = src.data[i + 2] * mul
      dst.data[o + 3] = src.data[i + 3]
    }
  }
  return dst
}

function photoScore(src: Raster, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 <= x0 || y1 <= y0) return 0
  let skin = 0
  let dark = 0
  let edge = 0
  let n = 0
  let prevLum = 0
  let hasPrev = false
  for (let y = y0; y < y1; y += 2) {
    hasPrev = false
    for (let x = x0; x < x1; x += 2) {
      const i = (y * src.width + x) * 4
      const r = src.data[i]
      const g = src.data[i + 1]
      const b = src.data[i + 2]
      n++
      if (r > 225 && g > 225 && b > 225) {
        hasPrev = false
        continue
      }
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum < 205) dark++
      if (r > 55 && g > 35 && b > 15 && r >= g && g >= b * 0.65 && r - b > 12) skin++
      if (hasPrev) {
        const d = Math.abs(lum - prevLum)
        if (d > 18) edge++
      }
      prevLum = lum
      hasPrev = true
    }
  }
  if (n < 1) return 0
  return ((dark * 0.45 + skin * 1.6 + edge * 0.9) / n) * 100
}

function leftPhotoAdvantage(src: Raster): number {
  const w = src.width
  const h = src.height
  if (w < 32 || h < 32) return 0
  const l0 = Math.floor(w * 0.06)
  const l1 = Math.floor(w * 0.36)
  const r0 = Math.floor(w * 0.64)
  const r1 = Math.floor(w * 0.94)
  const y0 = Math.floor(h * 0.12)
  const y1 = Math.floor(h * 0.9)
  return photoScore(src, l0, y0, l1, y1) - photoScore(src, r0, y0, r1, y1)
}

function redMass(src: Raster, x0: number, y0: number, x1: number, y1: number): number {
  let mass = 0
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * src.width + x) * 4
      const r = src.data[i]
      const g = src.data[i + 1]
      const b = src.data[i + 2]
      if (r > 120 && r > g * 1.25 && r > b * 1.15) {
        mass += (r - Math.max(g, b)) / 255
      }
    }
  }
  return mass
}

export function fixUpsideDown(src: Raster): Raster {
  const w = src.width
  const h = src.height
  if (w < 16 || h < 16) return src
  const tl = redMass(src, 0, 0, w / 2, h / 2)
  const br = redMass(src, w / 2, h / 2, w, h)
  if (br > 80 && br > tl * 1.5) return rotateCanvas(src, 180)
  return src
}

export function fixPortraitOrientation(src: Raster): Raster {
  const c0 = src
  const c180 = rotateCanvas(src, 180)
  if (leftPhotoAdvantage(c180) > leftPhotoAdvantage(c0)) return c180
  return c0
}

export function normalizePortraitUpright(src: Raster, aspect: number): Raster {
  const ar = aspect > 0 ? aspect : 85.6 / 54
  const rots = [src, rotateCanvas(src, 90), rotateCanvas(src, 180), rotateCanvas(src, 270)]
  let best: Raster | null = null
  let bestScore = -Infinity
  for (const r of rots) {
    const c = ensureLandscape(r, ar)
    if (c.width < 8 || c.height < 8) continue
    const cur = c.width / c.height
    const arPen = Math.abs(cur - ar) / ar
    const score = leftPhotoAdvantage(c) - arPen * 80
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best ?? ensureLandscape(src, ar)
}

export function finalizeCardGeometry(src: Raster, aspect: number): Raster {
  const ar = aspect > 0 ? aspect : 85.6 / 54
  let out = ensureLandscape(src, ar)
  if (out.width < 2 || out.height < 2) return out
  const cur = out.width / out.height
  const diff = Math.abs(cur - ar) / ar
  if (diff > 0.15) out = cropToAspect(out, ar)
  return out
}

export function normalizeDocument(src: Raster, aspect: number, side: string): Raster {
  const ar = aspect > 0 ? aspect : 85.6 / 54
  let out: Raster
  if (side === 'back') {
    out = normalizePortraitUpright(src, ar)
  } else if (side === 'front') {
    out = ensureLandscape(src, ar)
    out = fixUpsideDown(out)
  } else {
    out = ensureLandscape(src, ar)
    out = fixPortraitOrientation(out)
    out = fixUpsideDown(out)
  }
  return finalizeCardGeometry(out, ar)
}

export function orderQuadPoints(pts: Point[]): Quad {
  return orderQuad(pts)
}
