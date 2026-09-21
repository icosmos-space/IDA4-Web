import type { Quad, Raster } from './types'
import { applyMat3, getAffineTransformInv } from './geometry'
import {
  cropToAspect,
  enhance as enhanceImg,
  finalizeCardGeometry,
  normalizeDocument,
  resizeRaster,
  rotateCanvas,
  standardizeSize,
  warpHomography,
} from './imageOps'
import { initOrt, loadCardCorrectionSession } from './ort'
import { findDocumentQuad } from './nativeDetect'

const CARD_CORR_SIZE = 768
const CARD_CORR_OUT = 192
const CARD_CORR_TOP_K = 10
const CARD_CORR_SCORE = 0.5
const MEAN = [0.408, 0.447, 0.47]
const STD = [0.289, 0.274, 0.278]

export interface CardCorrDet {
  quad: Quad
  score: number
  angle: number
}

export interface PipelineConfigLocal {
  aspectRatio: number
  enhance: boolean
  allowFallback: boolean
  engine: 'card_correction' | 'native'
  side: string
}

function maxInt(a: number, b: number): number {
  return a > b ? a : b
}

function sigmoidInPlace(arr: Float32Array): Float32Array {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = 1 / (1 + Math.exp(-arr[i]))
  }
  return arr
}

export function cardCorrPreprocess(src: Raster): Float32Array {
  const srcW = src.width
  const srcH = src.height
  const m = maxInt(srcW, srcH)
  const ratio = CARD_CORR_SIZE / m
  const newW = Math.max(1, Math.floor(ratio * srcW))
  const newH = Math.max(1, Math.floor(ratio * srcH))
  const resized = resizeRaster(src, newW, newH)
  const left = Math.floor((CARD_CORR_SIZE - newW) / 2)
  const top = Math.floor((CARD_CORR_SIZE - newH) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = CARD_CORR_SIZE
  canvas.height = CARD_CORR_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, CARD_CORR_SIZE, CARD_CORR_SIZE)
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = newW
  srcCanvas.height = newH
  srcCanvas.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(resized.data), newW, newH),
    0,
    0,
  )
  ctx.drawImage(srcCanvas, left, top)

  const img = ctx.getImageData(0, 0, CARD_CORR_SIZE, CARD_CORR_SIZE)
  const plane = CARD_CORR_SIZE * CARD_CORR_SIZE
  const out = new Float32Array(3 * plane)
  const d = img.data
  for (let y = 0; y < CARD_CORR_SIZE; y++) {
    for (let x = 0; x < CARD_CORR_SIZE; x++) {
      const i = y * CARD_CORR_SIZE + x
      const p = i * 4
      out[i] = (d[p + 2] / 255 - MEAN[0]) / STD[0]
      out[plane + i] = (d[p + 1] / 255 - MEAN[1]) / STD[1]
      out[plane * 2 + i] = (d[p] / 255 - MEAN[2]) / STD[2]
    }
  }
  return out
}

function nHeatNMS(heat: Float32Array, h: number, w: number, kernel: number): void {
  const pad = (kernel - 1) / 2
  const orig = Float32Array.from(heat)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = orig[i]
      let keep = true
      outer: for (let ky = y - pad; ky <= y + pad; ky++) {
        for (let kx = x - pad; kx <= x + pad; kx++) {
          if (ky < 0 || kx < 0 || ky >= h || kx >= w) continue
          if (orig[ky * w + kx] > v) {
            keep = false
            break outer
          }
        }
      }
      if (!keep) heat[i] = 0
    }
  }
}

export function cardCorrDecodeBest(
  hm: Float32Array,
  wh: Float32Array,
  reg: Float32Array,
  cls: Float32Array,
  cx: number,
  cy: number,
  scale: number,
): CardCorrDet {
  nHeatNMS(hm, CARD_CORR_OUT, CARD_CORR_OUT, 3)
  const hw = CARD_CORR_OUT * CARD_CORR_OUT
  type Peak = { score: number; idx: number; x: number; y: number }
  const peaks: Peak[] = []
  for (let i = 0; i < hw; i++) {
    const s = hm[i]
    if (s < CARD_CORR_SCORE) continue
    peaks.push({ score: s, idx: i, x: i % CARD_CORR_OUT, y: Math.floor(i / CARD_CORR_OUT) })
  }
  if (peaks.length === 0) {
    let bestI = 0
    let bestS = hm[0]
    for (let i = 1; i < hw; i++) {
      if (hm[i] > bestS) {
        bestS = hm[i]
        bestI = i
      }
    }
    if (bestS < 0.1) throw new Error('card_correction: no card detected')
    peaks.push({
      score: bestS,
      idx: bestI,
      x: bestI % CARD_CORR_OUT,
      y: Math.floor(bestI / CARD_CORR_OUT),
    })
  }
  peaks.sort((a, b) => b.score - a.score)
  const inv = getAffineTransformInv(cx, cy, scale, CARD_CORR_OUT, CARD_CORR_OUT)

  let bestScore = -1
  let bestQuad: Quad | null = null
  let bestAngle = 0
  for (const p of peaks.slice(0, CARD_CORR_TOP_K)) {
    const rx = reg[0 * hw + p.idx]
    const ry = reg[1 * hw + p.idx]
    const xs = p.x + rx
    const ys = p.y + ry
    const pts: Quad = [
      applyMat3(inv, xs - wh[0 * hw + p.idx], ys - wh[1 * hw + p.idx])!,
      applyMat3(inv, xs - wh[2 * hw + p.idx], ys - wh[3 * hw + p.idx])!,
      applyMat3(inv, xs - wh[4 * hw + p.idx], ys - wh[5 * hw + p.idx])!,
      applyMat3(inv, xs - wh[6 * hw + p.idx], ys - wh[7 * hw + p.idx])!,
    ]
    let angle = 0
    let bestCls = -1
    for (let c = 0; c < 4; c++) {
      const v = cls[c * hw + p.idx]
      if (v > bestCls) {
        bestCls = v
        angle = c
      }
    }
    if (p.score > bestScore) {
      bestScore = p.score
      bestQuad = pts
      bestAngle = angle
    }
  }
  if (!bestQuad) throw new Error('card_correction: decode failed')
  return { quad: bestQuad, score: bestScore, angle: bestAngle }
}

export function applyCardOrientation(img: Raster, angle: number): Raster {
  switch (angle) {
    case 1:
      return rotateCanvas(img, 90)
    case 2:
      return rotateCanvas(img, 180)
    case 3:
      return rotateCanvas(img, 270)
    default:
      return img
  }
}

export async function correctCard(img: Raster): Promise<Raster> {
  const ort = await initOrt()
  const session = await loadCardCorrectionSession()
  const srcW = img.width
  const srcH = img.height
  const cx = srcW / 2
  const cy = srcH / 2
  const scale = maxInt(srcW, srcH)

  const input = cardCorrPreprocess(img)
  const tensor = new ort.Tensor('float32', input, [1, 3, CARD_CORR_SIZE, CARD_CORR_SIZE])
  const inputName = session.inputNames[0] ?? 'image'
  const results = await session.run({ [inputName]: tensor })

  const hmT = results['hm'] ?? results[session.outputNames[0]]
  const whT = results['wh'] ?? results[session.outputNames[1]]
  const regT = results['reg'] ?? results[session.outputNames[2]]
  const clsT = results['cls'] ?? results[session.outputNames[3]]
  if (!hmT || !whT || !regT || !clsT) {
    throw new Error('card_correction: unexpected outputs')
  }

  const hm = sigmoidInPlace(Float32Array.from(hmT.data as Float32Array))
  const wh = Float32Array.from(whT.data as Float32Array)
  const reg = Float32Array.from(regT.data as Float32Array)
  const cls = sigmoidInPlace(Float32Array.from(clsT.data as Float32Array))

  const det = cardCorrDecodeBest(hm, wh, reg, cls, cx, cy, scale)
  const warped = warpHomography(img, det.quad)
  return applyCardOrientation(warped, det.angle)
}

function coverRatio(quad: Quad, img: Raster): number {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  return (
    ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) /
    (img.width * img.height)
  )
}

function fullQuad(src: Raster): Quad {
  return [
    { x: 0, y: 0 },
    { x: src.width, y: 0 },
    { x: src.width, y: src.height },
    { x: 0, y: src.height },
  ]
}

export async function processCardImage(src: Raster, cfg: PipelineConfigLocal): Promise<Raster> {
  if (cfg.engine === 'card_correction') {
    try {
      const corrected = await correctCard(src)
      let out = finalizeCardGeometry(corrected, cfg.aspectRatio)
      if (cfg.enhance) out = enhanceImg(out)
      return standardizeSize(out, cfg.aspectRatio, 0)
    } catch (err) {
      if (!cfg.allowFallback) throw err instanceof Error ? err : new Error(String(err))
    }
  }

  let quad: Quad
  let fallback = false
  try {
    quad = findDocumentQuad(src, cfg.aspectRatio)
  } catch {
    if (!cfg.allowFallback) throw new Error('detect corners failed')
    quad = fullQuad(src)
    fallback = true
  }
  if (!fallback && coverRatio(quad, src) >= 0.95) fallback = true

  const warped = warpHomography(src, quad)
  let result = fallback
    ? normalizeDocument(cropToAspect(warped, cfg.aspectRatio), cfg.aspectRatio, cfg.side)
    : normalizeDocument(warped, cfg.aspectRatio, cfg.side)
  if (cfg.enhance) result = enhanceImg(result)
  return standardizeSize(result, cfg.aspectRatio, 0)
}
