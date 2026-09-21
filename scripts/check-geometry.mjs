/**
 * Quick Node checks for affine/homography mapping used by card correction.
 * Run: node scripts/check-geometry.mjs
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

// Inline critical math (mirrors src/lib/geometry.ts) for node without bundler
function solveLinear(n, a, b) {
  const aug = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row
    }
    const tmp = aug[col]; aug[col] = aug[pivot]; aug[pivot] = tmp
    if (Math.abs(aug[col][col]) < 1e-12) continue
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n]
    for (let j = i + 1; j < n; j++) sum -= aug[i][j] * x[j]
    x[i] = Math.abs(aug[i][i]) < 1e-12 ? 0 : sum / aug[i][i]
  }
  return x
}

function get3rdPoint(ax, ay, bx, by) {
  const directX = ax - bx
  const directY = ay - by
  return { x: bx - directY, y: by + directX }
}

function computeAffine3(src, dst) {
  const a = []
  const b = []
  for (let i = 0; i < 3; i++) {
    const { x, y } = src[i]
    a.push([x, y, 1, 0, 0, 0]); b.push(dst[i].x)
    a.push([0, 0, 0, x, y, 1]); b.push(dst[i].y)
  }
  const sol = solveLinear(6, a, b)
  return [sol[0], sol[1], sol[2], sol[3], sol[4], sol[5], 0, 0, 1]
}

function applyMat3(m, x, y) {
  const den = m[6] * x + m[7] * y + m[8]
  return {
    x: (m[0] * x + m[1] * y + m[2]) / den,
    y: (m[3] * x + m[4] * y + m[5]) / den,
  }
}

function getAffineTransformInv(cx, cy, scale, outW, outH) {
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

// Simulate: 1600x1000 image, heatmap 192, card corners roughly in original space
const srcW = 1600
const srcH = 1000
const cx = srcW / 2
const cy = srcH / 2
const scale = Math.max(srcW, srcH)
const out = 192
const inv = getAffineTransformInv(cx, cy, scale, out, out)

// Center of original should map near heatmap center after forward affine; inverse of center → original center
const c = applyMat3(inv, out / 2, out / 2)
console.log('inverse(center) expect ~(800,500):', c)

// Image is letterboxed into max-dim square. For 1600x1000:
// ratio=768/1600, newH=480, topPad=(768-480)/2=144 → heatmap y=36 for original y=0
// Heatmap x=96 → original x=center=800
const top = applyMat3(inv, out / 2, 36)
console.log('inverse(image-top heatmap) expect ~(800,0):', top)

const good =
  Math.abs(c.x - 800) < 1.5 &&
  Math.abs(c.y - 500) < 1.5 &&
  Math.abs(top.x - 800) < 2 &&
  Math.abs(top.y - 0) < 3
console.log(good ? 'AFFINE OK' : 'AFFINE BAD')
if (!good) process.exit(1)
