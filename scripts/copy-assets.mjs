import { cp, mkdir, access } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(root, '..')
const ortSrc = path.join(project, 'node_modules', 'onnxruntime-web', 'dist')
const ortDest = path.join(project, 'public', 'ort')
const modelSrcCandidates = [
  path.resolve(project, '../IDA4/ida4/models/cv_resnet18_card_correction.onnx'),
  'D:/gospace/src/github.com/icosmos-space/IDA4/ida4/models/cv_resnet18_card_correction.onnx',
]
const modelDestDir = path.join(project, 'public', 'models')
const modelDest = path.join(modelDestDir, 'cv_resnet18_card_correction.onnx')

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!existsSync(ortSrc)) {
    console.error('onnxruntime-web dist not found. Run npm install first.')
    process.exit(1)
  }
  await mkdir(ortDest, { recursive: true })
  await cp(ortSrc, ortDest, {
    recursive: true,
    filter: (src) => {
      if (existsSync(src) && statSync(src).isDirectory()) return true
      const base = path.basename(src)
      return (
        base.endsWith('.wasm') ||
        base.endsWith('.mjs') ||
        base.endsWith('.js') ||
        base.endsWith('.min.js') ||
        base.includes('ort-wasm') ||
        base.includes('ort.webgpu') ||
        base.includes('ort.all')
      )
    },
  })
  console.log('Copied onnxruntime-web dist → public/ort')

  await mkdir(modelDestDir, { recursive: true })
  if (!(await exists(modelDest))) {
    for (const src of modelSrcCandidates) {
      if (await exists(src)) {
        await cp(src, modelDest)
        console.log(`Copied model: ${src} → public/models/`)
        break
      }
    }
    if (!(await exists(modelDest))) {
      console.warn('Model not found. Place cv_resnet18_card_correction.onnx under public/models/')
    }
  } else {
    console.log('Model already present: public/models/cv_resnet18_card_correction.onnx')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
