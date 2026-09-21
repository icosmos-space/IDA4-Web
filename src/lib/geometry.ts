import type { Point, Quad, Raster } from './types'

export type Mat3 = [number, number, number, number, number, number, number, number, number]

export function pointDist(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

export function orderQuad(pts: Point[]): Quad {
  if (pts.length !== 4) {
    return [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]
  }
  let tl = pts[0]
  let br = pts[0]
  let tr = pts[0]
  let bl = pts[0]
  let tls = Infinity
  let brs = -Infinity
  let trd = -Infinity
  let bld = Infinity
  for (const p of pts) {
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
    if (d > trd) {
      trd = d
      tr = p
    }
    if (d < bld) {
      bld = d
      bl = p
    }
  }

  let q: Quad = [{ ...tl }, { ...tr }, { ...br }, { ...bl }]

  const topY = (q[0].y + q[1].y) / 2
  const bottomY = (q[2].y + q[3].y) / 2
  if (topY > bottomY) {
    q = [q[3], q[2], q[1], q[0]]
  }

  const leftX = (q[0].x + q[3].x) / 2
  const rightX = (q[1].x + q[2].x) / 2
  if (leftX > rightX) {
    q = [q[1], q[0], q[3], q[2]]
  }
  return q
}

export function fullImageQuad(img: Raster): Quad {
  return [
    { x: 0, y: 0 },
    { x: img.width, y: 0 },
    { x: img.width, y: img.height },
    { x: 0, y: img.height },
  ]
}

export function quadAspect(q: Quad): number {
  const top = pointDist(q[0], q[1])
  const bottom = pointDist(q[2], q[3])
  const left = pointDist(q[0], q[3])
  const right = pointDist(q[1], q[2])
  const w = (top + bottom) / 2
  const h = (left + right) / 2
  if (h < 1) return 0
  let aspect = w / h
  if (aspect < 1) aspect = 1 / aspect
  return aspect
}

export function quadArea(q: Quad): number {
  let area = 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    area += q[i].x * q[j].y - q[j].x * q[i].y
  }
  return Math.abs(area) / 2
}

export function solveLinear(n: number, a: number[][], b: number[]): number[] {
  const aug: number[][] = []
  for (let i = 0; i < n; i++) {
    aug.push([...a[i], b[i]])
  }
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row
    }
    const tmp = aug[col]
    aug[col] = aug[pivot]
    aug[pivot] = tmp
    if (Math.abs(aug[col][col]) < 1e-12) continue
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n]
    for (let j = i + 1; j < n; j++) sum -= aug[i][j] * x[j]
    x[i] = Math.abs(aug[i][i]) < 1e-12 ? 0 : sum / aug[i][i]
  }
  return x
}

export function computeHomography(src: Quad, dst: Quad): Mat3 {
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const u = dst[i].x
    const v = dst[i].y
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const h = solveLinear(8, a, b)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function invertMat3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ]
}

export function applyMat3(m: Mat3, x: number, y: number): Point | null {
  const den = m[6] * x + m[7] * y + m[8]
  if (Math.abs(den) < 1e-12) return null
  return {
    x: (m[0] * x + m[1] * y + m[2]) / den,
    y: (m[3] * x + m[4] * y + m[5]) / den,
  }
}

/** Third affine basis point (perpendicular), matching cv2/ModelScope get_affine_transform. */
function get3rdPoint(ax: number, ay: number, bx: number, by: number): Point {
  const directX = ax - bx
  const directY = ay - by
  return { x: bx - directY, y: by + directX }
}

function computeAffine3(src: [Point, Point, Point], dst: [Point, Point, Point]): Mat3 {
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 3; i++) {
    const { x, y } = src[i]
    a.push([x, y, 1, 0, 0, 0])
    b.push(dst[i].x)
    a.push([0, 0, 0, x, y, 1])
    b.push(dst[i].y)
  }
  const sol = solveLinear(6, a, b)
  return [sol[0], sol[1], sol[2], sol[3], sol[4], sol[5], 0, 0, 1]
}

/** Inverse CenterNet affine (ModelScope get_affine_transform inv=1). */
export function getAffineTransformInv(cx: number, cy: number, scale: number, outW: number, outH: number): Mat3 {
  const srcW = scale
  const dstW = outW
  const dstH = outH
  const srcDirX = 0
  const srcDirY = srcW * -0.5
  const dstDirX = 0
  const dstDirY = dstW * -0.5
  const src0 = { x: cx, y: cy }
  const src1 = { x: cx + srcDirX, y: cy + srcDirY }
  const dst0 = { x: dstW * 0.5, y: dstH * 0.5 }
  const dst1 = { x: dstW * 0.5 + dstDirX, y: dstH * 0.5 + dstDirY }
  const src2 = get3rdPoint(src0.x, src0.y, src1.x, src1.y)
  const dst2 = get3rdPoint(dst0.x, dst0.y, dst1.x, dst1.y)
  return computeAffine3([dst0, dst1, dst2], [src0, src1, src2])
}

export function transformPred(pt: Point, cx: number, cy: number, scale: number, outW: number, outH: number): Point {
  const m = getAffineTransformInv(cx, cy, scale, outW, outH)
  return applyMat3(m, pt.x, pt.y) ?? pt
}

export function capWarpSize(w: number, h: number, maxLong: number): [number, number] {
  if (maxLong < 32) maxLong = 32
  const long = Math.max(w, h)
  if (long <= maxLong) return [Math.max(1, w), Math.max(1, h)]
  const scale = maxLong / long
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]
}

export const MAX_WARP_LONG_EDGE = 1280

export function quadOutputSize(q: Quad): [number, number] {
  const top = pointDist(q[0], q[1])
  const bottom = pointDist(q[2], q[3])
  const left = pointDist(q[0], q[3])
  const right = pointDist(q[1], q[2])
  let width = Math.round((top + bottom) / 2)
  let height = Math.round((left + right) / 2)
  if (width < 1) width = 1
  if (height < 1) height = 1
  return capWarpSize(width, height, MAX_WARP_LONG_EDGE)
}
