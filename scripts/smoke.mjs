import { chromium } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const front = path.join(project, 'testdata/front.jpg')
const back = path.join(project, 'testdata/back.jpg')
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const url = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'

if (!existsSync(front) || !existsSync(back)) {
  console.error('testdata missing')
  process.exit(1)
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (err) => console.error('PAGEERROR', err.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE', msg.text())
})

console.log('open', url)
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(800)

const title = await page.title()
console.log('title:', title)
const body = await page.locator('body').innerText()
if (!body.includes('IDA4 Web') && !body.includes('身份证')) {
  console.error('UI text missing. body=', body.slice(0, 200))
}

// model reachable
const modelRes = await page.request.get(`${url.replace(/\/$/, '')}/models/cv_resnet18_card_correction.onnx`)
console.log('model status', modelRes.status(), 'len', (await modelRes.body()).length)
const ortWasm = await page.request.get(`${url.replace(/\/$/, '')}/ort/ort-wasm-simd-threaded.wasm`)
console.log('ort wasm status', ortWasm.status(), 'len', (await ortWasm.body()).length)

// wait for model preload modal to finish
const modelDeadline = Date.now() + 120000
while (Date.now() < modelDeadline) {
  const mask = await page.locator('.modal-mask').count()
  const btn = page.getByRole('button', { name: /生成|模型加载中/ })
  const label = await btn.first().innerText().catch(() => '')
  if (mask === 0 && /生成/.test(label)) break
  await page.waitForTimeout(400)
}
console.log('model ready, proceed generate')

// upload front/back via hidden gallery inputs
const galleryInputs = page.locator('input[type=file]:not([capture])')
const count = await galleryInputs.count()
console.log('gallery inputs', count)
if (count < 2) throw new Error('missing gallery inputs')
await galleryInputs.nth(0).setInputFiles(front)
await galleryInputs.nth(1).setInputFiles(back)
await page.waitForTimeout(500)

const previews = await page.locator('.slot-body img').count()
console.log('slot previews', previews)

// generate
await page.getByRole('button', { name: '生成' }).click()
console.log('clicked generate, waiting…')

// wait up to 180s for completion
const start = Date.now()
let ok = false
while (Date.now() - start < 180000) {
  const status = await page.locator('.status-line').innerText()
  const sheet = await page.locator('.preview-frame img').count()
  if (sheet > 0 && /完成|生成完成/.test(status)) {
    ok = true
    console.log('status:', status.trim())
    break
  }
  if (/失败/.test(status)) {
    console.error('generate failed status:', status)
    const err = await page.locator('.error').innerText().catch(() => '')
    console.error('error:', err)
    break
  }
  if ((Date.now() - start) % 5000 < 400) {
    console.log('waiting…', status.replace(/\n/g, ' ').slice(0, 120))
  }
  await page.waitForTimeout(400)
}

const finalStatus = await page.locator('.status-line').innerText().catch(() => '')
const sheetCount = await page.locator('.preview-frame img').count()
const cardCount = await page.locator('.card-previews img').count()
const errorText = await page.locator('.error').innerText().catch(() => '')
console.log({ ok, finalStatus, sheetCount, cardCount, errorText })
await page.screenshot({ path: path.join(project, 'testdata/smoke.png'), fullPage: true })
await browser.close()
if (!ok || sheetCount < 1) process.exit(1)
console.log('SMOKE OK')
