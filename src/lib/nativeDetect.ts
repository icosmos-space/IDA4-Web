import type { Point, Quad, Raster } from './types'
import { orderQuad, pointDist, quadArea, quadAspect } from './geometry'
import { resizeRaster } from './imageOps'

const MAX_DETECT = 1000

function toGray(src: Raster): Float32Array {
  const g = new Float32Array(src.width * src.height)
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (0.299 * src.data[p] + 0.587 * src.data[p + 1] + 0.114 * src.data[p + 2])
  }
  return g
}

function boxBlur(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[y * w + x] = gray[y * w + x]
        continue
      }
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += gray[(y + dy) * w + (x + dx)]
        }
      }
      out[y * w + x] = sum / 9
    }
  }
  return out
}

function sobelMagnitudes(gray: Float32Array, w: number, h: number): Float32Array {
  const mags = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1]
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]
      mags[i] = Math.hypot(gx, gy)
    }
  }
  return mags
}

function otsuThreshold(mags: Float32Array): number {
  if (mags.length === 0) return 0
  const bins = 256
  const hist = new Array<number>(bins).fill(0)
  let maxVal = 0
  for (const m of mags) if (m > maxVal) maxVal = m
  if (maxVal <= 0) return 0
  for (const m of mags) {
    if (m <= 0) continue
    let idx = Math.floor((m / maxVal) * (bins - 1))
    if (idx >= bins) idx = bins - 1
    hist[idx]++
  }
  const total = hist.reduce((a, b) => a + b, 0)
  if (total === 0) return maxVal * 0.4
  let sumAll = 0
  for (let i = 0; i < bins; i++) sumAll += i * hist[i]
  let sumB = 0
  let wB = 0
  let maxVar = -1
  let threshold = 0
  for (let t = 0; t < bins; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const varBetween = wB * wF * (mB - mF) * (mB - mF)
    if (varBetween > maxVar) {
      maxVar = varBetween
      threshold = t
    }
  }
  return (threshold / (bins - 1)) * maxVal
}

function dilateEdgeMask(mags: Float32Array, w: number, h: number, thresh: number): boolean[] {
  const mask = new Array<boolean>(w * h)
  for (let i = 0; i < mags.length; i++) mask[i] = mags[i] >= thresh
  const out = mask.slice()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          out[(y + dy) * w + (x + dx)] = true
        }
      }
    }
  }
  return out
}

function collectMaskPoints(mask: boolean[], w: number, h: number): Point[] {
  const pts: Point[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) pts.push({ x, y })
    }
  }
  return pts
}

function collectEdgePoints(mags: Float32Array, w: number, h: number, thresh: number): Point[] {
  const pts: Point[] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (mags[y * w + x] >= thresh) pts.push({ x, y })
    }
  }
  return pts
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points.slice()
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function cornersFromHull(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null
  if (hull.length === 4) return hull
  let tl = hull[0]
  let br = hull[0]
  let tr = hull[0]
  let bl = hull[0]
  let tls = Infinity
  let brs = -Infinity
  let trd = Infinity
  let bld = -Infinity
  for (const p of hull) {
    const s = p.x + p.y
    const d = p.x - p.y
    if (s < tls) {
      tls = s
      tl = p
    }
    if (s > brs) {
      brs = s
      br = p
    }
    if (d < trd) {
      trd = d
      tr = p
    }
    if (d > bld) {
      bld = d
      bl = p
    }
  }
  // Match Go native_contour: TR = min(x-y), BL = max(x-y) in cornersFromHull
  return [tl, tr, br, bl]
}

function quadFromPointsScaled(pts: Point[], scale: number): Quad {
  const inv = scale > 0 ? 1 / scale : 1
  const scaled = pts.map((p) => ({
    x: Math.round(p.x * inv),
    y: Math.round(p.y * inv),
  }))
  return orderQuad(scaled)
}

export function findDocumentQuad(img: Raster, targetAspect: number): Quad {
  const aspect = targetAspect > 0 ? targetAspect : 85.6 / 54
  let working = img
  let scale = 1
  const maxDim = Math.max(img.width, img.height)
  if (maxDim > MAX_DETECT) {
    scale = MAX_DETECT / maxDim
    working = resizeRaster(img, Math.max(1, Math.floor(img.width * scale)), Math.max(1, Math.floor(img.height * scale)))
  }
  const invScale = 1 / scale
  const gray = toGray(working)
  const blurred = boxBlur(gray, working.width, working.height)
  const mags = sobelMagnitudes(blurred, working.width, working.height)
  const w = working.width
  const h = working.height
  if (w < 8 || h < 8) throw new Error('image too small')

  let thresh = otsuThreshold(mags) * 0.85
  if (thresh <= 0) thresh = 20
  const mask = dilateEdgeMask(mags, w, h, thresh)
  let pts = collectMaskPoints(mask, w, h)
  if (pts.length < 40) pts = collectEdgePoints(mags, w, h, thresh)
  if (pts.length < 20) throw new Error('insufficient edge points')

  const hull = convexHull(pts)
  const corners = cornersFromHull(hull)
  if (!corners || corners.length !== 4) throw new Error('cannot derive quadrilateral')

  const quad = orderQuad(corners)
  const imgArea = w * h
  if (quadArea(quad) < imgArea * 0.08) throw new Error('detected area too small')
  const a = quadAspect(quad)
  if (Math.abs(a - aspect) / aspect > 0.45) throw new Error('aspect ratio mismatch')
  return quadFromPointsScaled(corners, invScale)
}

export function isFallbackQuad(quad: Quad, img: Raster): boolean {
  const w = img.width
  const h = img.height
  const tol = 2
  if (
    Math.abs(quad[0].x) <= tol &&
    Math.abs(quad[0].y) <= tol &&
    Math.abs(quad[1].x - w) <= tol &&
    Math.abs(quad[1].y) <= tol &&
    Math.abs(quad[2].x - w) <= tol &&
    Math.abs(quad[2].y - h) <= tol &&
    Math.abs(quad[3].x) <= tol &&
    Math.abs(quad[3].y - h) <= tol
  ) {
    return true
  }
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const cover =
    ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (w * h)
  return cover >= 0.95
}

export function estimateQuadOutput(quad: Quad): { width: number; height: number } {
  const top = pointDist(quad[0], quad[1])
  const bottom = pointDist(quad[2], quad[3])
  const left = pointDist(quad[0], quad[3])
  const right = pointDist(quad[1], quad[2])
  return {
    width: Math.max(1, Math.round((top + bottom) / 2)),
    height: Math.max(1, Math.round((left + right) / 2)),
  }
}
