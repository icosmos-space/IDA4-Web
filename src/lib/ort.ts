import type * as OrtNS from 'onnxruntime-web'

const MODEL_FILE = 'cv_resnet18_card_correction.onnx'

export type OrtModule = typeof OrtNS

let ortMod: OrtModule | null = null
let sessionPromise: Promise<OrtNS.InferenceSession> | null = null
let initPromise: Promise<OrtModule> | null = null

function basePrefix(): string {
  const base = import.meta.env.BASE_URL || './'
  return base.endsWith('/') ? base : `${base}/`
}

export function resolvePublicUrl(rel: string): string {
  return new URL(rel, document.baseURI).href
}

export function modelPath(): string {
  return resolvePublicUrl(`${basePrefix()}models/${MODEL_FILE}`)
}

export function ortBase(): string {
  return resolvePublicUrl(`${basePrefix()}ort/`)
}

/**
 * Load onnxruntime-web ESM build from public/ort so wasm/mjs resolve next to themselves.
 * Avoids Vite bundling ORT assets under /assets/ (broken relative imports).
 */
export async function initOrt(): Promise<OrtModule> {
  if (ortMod) return ortMod
  if (!initPromise) {
    initPromise = (async () => {
      const base = ortBase()
      const entry = `${base}ort.all.min.mjs`
      const mod = (await import(/* @vite-ignore */ entry)) as { default?: OrtModule } & OrtModule
      const ort = (mod.default ?? mod) as OrtModule
      ort.env.wasm.numThreads = 1
      ort.env.wasm.simd = true
      ort.env.wasm.proxy = false
      ort.env.wasm.wasmPaths = base
      ortMod = ort
      return ort
    })().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

export async function loadCardCorrectionSession(): Promise<OrtNS.InferenceSession> {
  const ort = await initOrt()
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const url = modelPath()
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`模型下载失败：${MODEL_FILE} (${res.status})`)
      }
      const buf = await res.arrayBuffer()
      if (buf.byteLength < 1024) {
        throw new Error('模型文件无效或过小')
      }
      return ort.InferenceSession.create(buf, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    })().catch((err) => {
      sessionPromise = null
      throw err
    })
  }
  return sessionPromise
}

export function resetSession(): void {
  sessionPromise = null
}
