<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { GenerateOptions, Side } from '../lib/types'
import { defaultOptions } from '../lib/types'
import { DOCUMENT_NAME, effectsHint, formatDuration, isImageFile, readFilePreview } from '../lib/utils'
import { generateIDCardPdf } from '../lib/generate'
import { downloadBlob, tryShareFiles } from '../lib/pdf'
import { initOrt } from '../lib/ort'
import type { SideState } from '../lib/utils'

const mounted = ref(false)
const openFold = ref<'effects' | 'watermark' | null>(null)
const status = ref('')
const error = ref('')
const busy = ref(false)
const progress = ref(0)
const sheetUrl = ref('')
const frontPreview = ref('')
const backPreview = ref('')
const pdfBlob = ref<Blob | null>(null)
const engineUsed = ref('')
const lastMs = ref(0)

const cameraInputs = {
  front: ref<HTMLInputElement | null>(null),
  back: ref<HTMLInputElement | null>(null),
}
const galleryInputs = {
  front: ref<HTMLInputElement | null>(null),
  back: ref<HTMLInputElement | null>(null),
}

const data = reactive({
  front: { file: null, preview: '', name: '' } as SideState,
  back: { file: null, preview: '', name: '' } as SideState,
  opts: defaultOptions() as GenerateOptions,
})

const readyCount = computed(() => {
  let n = 0
  if (data.front.file) n++
  if (data.back.file) n++
  return n
})

const canGenerate = computed(() => readyCount.value === 2 && !busy.value)

const engineLabel = computed(() => (data.opts.engine === 'card_correction' ? '票证矫正（ONNX）' : '纯边缘检测'))

function sideState(side: Side): SideState {
  return side === 'front' ? data.front : data.back
}

function sideTitle(side: Side): string {
  return side === 'front' ? '国徽面' : '人像面'
}

function toggleFold(key: 'effects' | 'watermark') {
  openFold.value = openFold.value === key ? null : key
}

function clearOutput() {
  if (sheetUrl.value && sheetUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(sheetUrl.value)
  }
  sheetUrl.value = ''
  frontPreview.value = ''
  backPreview.value = ''
  pdfBlob.value = null
}

function clearSide(side: Side, event?: Event) {
  event?.stopPropagation()
  const t = sideState(side)
  t.file = null
  t.preview = ''
  t.name = ''
  clearOutput()
  status.value = `${sideTitle(side)}已清除`
}

async function applyFile(side: Side, file: File | null | undefined) {
  if (!file) return
  if (!isImageFile(file)) {
    error.value = '请选择图片文件'
    return
  }
  error.value = ''
  const t = sideState(side)
  t.file = file
  t.name = file.name
  t.preview = await readFilePreview(file)
  clearOutput()
  status.value = `${sideTitle(side)}已选择`
}

function openPicker(side: Side, mode: 'camera' | 'gallery') {
  const input = (mode === 'camera' ? cameraInputs : galleryInputs)[side].value
  input?.click()
}

function onPick(side: Side, mode: 'camera' | 'gallery', event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  void applyFile(side, file)
  input.value = ''
  void mode
}

async function generate() {
  if (!canGenerate.value) return
  busy.value = true
  error.value = ''
  status.value = '准备中…'
  progress.value = 0
  clearOutput()
  try {
    const result = await generateIDCardPdf(
      data.front.file!,
      data.back.file!,
      { ...data.opts },
      (msg, ratio) => {
        status.value = msg
        progress.value = ratio
      },
    )
    sheetUrl.value = URL.createObjectURL(
      await new Promise<Blob>((resolve, reject) => {
        result.sheet.toBlob((b) => (b ? resolve(b) : reject(new Error('sheet encode failed'))), 'image/jpeg', 0.92)
      }),
    )
    frontPreview.value = result.frontPreview
    backPreview.value = result.backPreview
    pdfBlob.value = result.pdfBlob
    engineUsed.value = result.engineUsed
    lastMs.value = result.durationMs
    progress.value = 1
    status.value = `生成完成 · ${formatDuration(result.durationMs)}${result.warnings.length ? ' · ' + result.warnings[0] : ''}`
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    status.value = '生成失败'
  } finally {
    busy.value = false
  }
}

async function download() {
  if (!pdfBlob.value) return
  const file = new File([pdfBlob.value], '身份证复印件.pdf', { type: 'application/pdf' })
  const shared = await tryShareFiles(file, '身份证复印件', DOCUMENT_NAME)
  if (!shared) {
    downloadBlob(pdfBlob.value, '身份证复印件.pdf')
    status.value = 'PDF 已下载'
  } else {
    status.value = '已打开系统分享'
  }
}

function printPdf() {
  if (!pdfBlob.value) return
  const url = URL.createObjectURL(pdfBlob.value)
  const w = window.open(url, '_blank')
  if (!w) {
    error.value = '请允许弹出窗口以打印，或先下载 PDF'
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

onMounted(() => {
  requestAnimationFrame(() => {
    mounted.value = true
  })
  // Prefetch ORT wasm path existence silently
  void initOrt()
})
</script>

<template>
  <div class="page" :class="{ ready: mounted }">
    <header class="top anim" style="--i: 0">
      <div class="brand">
        <div class="logo">ID</div>
        <div>
          <h1>IDA4 Web</h1>
          <p>身份证 A4 复印件 · 浏览器 ONNX</p>
        </div>
      </div>
      <div class="doc-name">{{ DOCUMENT_NAME }}</div>
    </header>

    <section class="slots anim" style="--i: 1">
      <article
        v-for="(side, index) in (['front', 'back'] as Side[])"
        :key="side"
        class="slot"
        :class="{ filled: !!sideState(side).preview }"
      >
        <div class="slot-head">
          <strong>{{ sideTitle(side) }}</strong>
          <button v-if="sideState(side).preview" type="button" class="icon-btn" @click="clearSide(side, $event)">
            清除
          </button>
        </div>
        <button type="button" class="slot-body" @click="openPicker(side, 'gallery')">
          <img v-if="sideState(side).preview" :src="sideState(side).preview" :alt="sideTitle(side)" />
          <div v-else class="empty">
            <span class="empty-icon">📷</span>
            <span>点击选择照片</span>
          </div>
        </button>
        <div class="slot-actions">
          <button type="button" class="btn secondary" @click="openPicker(side, 'camera')">拍照</button>
          <button type="button" class="btn secondary" @click="openPicker(side, 'gallery')">相册</button>
        </div>
        <input
          :ref="(el) => { cameraInputs[side].value = el as HTMLInputElement | null }"
          class="hidden"
          type="file"
          accept="image/*"
          capture="environment"
          @change="onPick(side, 'camera', $event)"
        />
        <input
          :ref="(el) => { galleryInputs[side].value = el as HTMLInputElement | null }"
          class="hidden"
          type="file"
          accept="image/*"
          @change="onPick(side, 'gallery', $event)"
        />
        <span class="slot-index">{{ index + 1 }}</span>
      </article>
    </section>

    <section class="panel anim" style="--i: 2">
      <div class="engine-row">
        <span class="label">检测引擎</span>
        <select v-model="data.opts.engine" class="select">
          <option value="card_correction">票证矫正（ONNX）</option>
          <option value="native">纯边缘检测</option>
        </select>
      </div>

      <div class="fold" :class="{ open: openFold === 'effects' }">
        <button type="button" class="fold-head" @click="toggleFold('effects')">
          <span>效果</span>
          <span class="hint mono">{{ effectsHint(data.opts) }}</span>
        </button>
        <div v-show="openFold === 'effects'" class="fold-body">
          <label class="check"><input v-model="data.opts.enhance" type="checkbox" />图像增强</label>
          <label class="check"><input v-model="data.opts.allowFallback" type="checkbox" />失败降级</label>
          <label class="check"><input v-model="data.opts.randomTilt" type="checkbox" />随机倾斜</label>
          <label class="check"><input v-model="data.opts.photocopyLook" type="checkbox" />圆角黑边</label>
          <label class="check"><input v-model="data.opts.grayscale" type="checkbox" />黑白化</label>
        </div>
      </div>

      <div class="fold" :class="{ open: openFold === 'watermark' }">
        <button type="button" class="fold-head" @click="toggleFold('watermark')">
          <span>水印</span>
          <span class="hint mono">{{ data.opts.watermarkEnabled ? '开' : '关' }}</span>
        </button>
        <div v-show="openFold === 'watermark'" class="fold-body">
          <label class="check"><input v-model="data.opts.watermarkEnabled" type="checkbox" />开启水印</label>
          <input
            v-model="data.opts.watermarkText"
            class="text-input"
            maxlength="32"
            placeholder="例如：仅供办理业务使用"
            :disabled="!data.opts.watermarkEnabled"
          />
          <div class="slider-row">
            <div class="slider-head"><span>字号</span><span class="mono">{{ data.opts.watermarkFontSize }}</span></div>
            <input v-model.number="data.opts.watermarkFontSize" type="range" min="16" max="72" step="1" :disabled="!data.opts.watermarkEnabled" />
          </div>
          <div class="slider-row">
            <div class="slider-head"><span>角度</span><span class="mono">{{ data.opts.watermarkAngle }}°</span></div>
            <input v-model.number="data.opts.watermarkAngle" type="range" min="-60" max="60" step="1" :disabled="!data.opts.watermarkEnabled" />
          </div>
          <div class="slider-row">
            <div class="slider-head"><span>字间距</span><span class="mono">{{ data.opts.watermarkLetterSpacing }}</span></div>
            <input v-model.number="data.opts.watermarkLetterSpacing" type="range" min="0" max="40" step="1" :disabled="!data.opts.watermarkEnabled" />
          </div>
          <div class="slider-row">
            <div class="slider-head"><span>行间距</span><span class="mono">{{ data.opts.watermarkLineSpacing }}</span></div>
            <input v-model.number="data.opts.watermarkLineSpacing" type="range" min="40" max="220" step="2" :disabled="!data.opts.watermarkEnabled" />
          </div>
        </div>
      </div>
    </section>

    <section class="preview anim" style="--i: 3">
      <div class="preview-head">
        <strong>A4 预览</strong>
        <span class="mono tag">{{ engineUsed || engineLabel }}</span>
      </div>
      <div class="preview-frame" :class="{ empty: !sheetUrl }">
        <img v-if="sheetUrl" :src="sheetUrl" alt="A4 复印件预览" />
        <div v-else class="empty">
          <span>导入两面照片后生成</span>
          <span class="sub">确认无误再下载 PDF</span>
        </div>
      </div>
      <div v-if="frontPreview || backPreview" class="card-previews">
        <figure v-if="frontPreview">
          <img :src="frontPreview" alt="国徽面矫正" />
          <figcaption>国徽面</figcaption>
        </figure>
        <figure v-if="backPreview">
          <img :src="backPreview" alt="人像面矫正" />
          <figcaption>人像面</figcaption>
        </figure>
      </div>
    </section>

    <footer class="bottom anim" style="--i: 4">
      <div class="status-line">
        <span>{{ status || `已准备 ${readyCount}/2 · 引擎 ${engineLabel}` }}</span>
        <span v-if="busy" class="mono">{{ Math.round(progress * 100) }}%</span>
      </div>
      <div v-if="busy" class="progress"><i :style="{ width: `${Math.round(progress * 100)}%` }" /></div>
      <div v-if="error" class="error">{{ error }}</div>
      <div class="actions">
        <button type="button" class="btn primary" :disabled="!canGenerate" @click="generate">
          {{ busy ? '处理中…' : '生成' }}
        </button>
        <button type="button" class="btn" :disabled="!pdfBlob" @click="download">下载 / 分享</button>
        <button type="button" class="btn ghost" :disabled="!pdfBlob" @click="printPdf">打印</button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.page {
  --bg: #161616;
  --surface: #222;
  --surface-2: #2a2a2a;
  --ink: #fff;
  --muted: #9a9a9a;
  --line: #3a3a3a;
  --accent: #00a8e0;
  --danger: #cc0000;
  min-height: 100dvh;
  padding: 12px 12px calc(96px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
  background:
    radial-gradient(1200px 400px at 50% -10%, rgba(0, 168, 224, 0.08), transparent),
    var(--bg);
}

.anim {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 420ms ease, transform 420ms ease;
  transition-delay: calc(var(--i, 0) * 70ms);
}

.page.ready .anim {
  opacity: 1;
  transform: translateY(0);
}

.top {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: rgba(0, 168, 224, 0.12);
  color: var(--accent);
  border: 1px solid rgba(0, 168, 224, 0.28);
}

.brand h1 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.brand p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 0.75rem;
}

.doc-name {
  color: #777;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
}

.slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.slot {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  min-width: 0;
}

.slot.filled {
  border-color: #3f3f3f;
}

.slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 0.85rem;
}

.icon-btn {
  border: none;
  background: rgba(204, 0, 0, 0.15);
  color: #ff6b6b;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 0.72rem;
}

.slot-body {
  border: none;
  padding: 0;
  background: #1a1a1a;
  border-radius: 10px;
  overflow: hidden;
  aspect-ratio: 1.58;
  width: 100%;
  cursor: pointer;
}

.slot-body img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #111;
}

.empty {
  width: 100%;
  height: 100%;
  min-height: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--muted);
  font-size: 0.78rem;
}

.empty-icon {
  font-size: 1.2rem;
  opacity: 0.8;
}

.sub {
  font-size: 0.72rem;
  color: #666;
}

.slot-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.slot-index {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: none;
  place-items: center;
  font-size: 0.7rem;
  color: #888;
}

.hidden {
  display: none;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
}

.engine-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.label {
  font-size: 0.82rem;
  font-weight: 600;
}

.select {
  flex: 0 0 auto;
  min-width: 150px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
}

.fold {
  border-top: 1px solid var(--line);
  padding-top: 4px;
}

.fold-head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: transparent;
  border: none;
  padding: 10px 0;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}

.hint {
  color: var(--muted);
  font-weight: 500;
  font-size: 0.72rem;
}

.fold-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}

.check {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  font-size: 0.88rem;
  color: #ddd;
}

.check input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}

.text-input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slider-head {
  display: flex;
  justify-content: space-between;
  color: #bbb;
  font-size: 0.78rem;
}

input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
}

.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}

.tag {
  color: var(--accent);
  font-size: 0.72rem;
}

.preview-frame {
  background: #111;
  border-radius: 10px;
  overflow: hidden;
  min-height: 220px;
  display: grid;
  place-items: center;
}

.preview-frame img {
  width: 100%;
  display: block;
  object-fit: contain;
  max-height: 70dvh;
}

.card-previews {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.card-previews figure {
  margin: 0;
  background: #1a1a1a;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line);
}

.card-previews img {
  width: 100%;
  display: block;
  aspect-ratio: 1.58;
  object-fit: contain;
  background: #111;
}

.card-previews figcaption {
  padding: 6px 8px;
  font-size: 0.72rem;
  color: var(--muted);
}

.bottom {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  background: rgba(22, 22, 22, 0.92);
  backdrop-filter: blur(12px);
  border-top: 1px solid #2f2f2f;
}

.status-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 0.75rem;
  margin-bottom: 8px;
  min-height: 1em;
}

.progress {
  height: 3px;
  background: #2d2d2d;
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #00a8e0, #5ad0ff);
  transition: width 180ms ease;
}

.error {
  color: #ff8a8a;
  background: rgba(204, 0, 0, 0.12);
  border: 1px solid rgba(204, 0, 0, 0.28);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.78rem;
  margin-bottom: 8px;
}

.actions {
  display: grid;
  grid-template-columns: 1.2fr 1fr 0.8fr;
  gap: 8px;
}

.btn {
  min-height: 46px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  border-color: transparent;
  color: #04202a;
}

.btn.secondary {
  min-height: 40px;
  font-size: 0.82rem;
  background: #2a2a2a;
}

.btn.ghost {
  background: transparent;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn:not(:disabled):active {
  transform: scale(0.98);
}

@media (max-width: 380px) {
  .slots {
    grid-template-columns: 1fr;
  }

  .actions {
    grid-template-columns: 1fr 1fr;
  }

  .actions .ghost {
    grid-column: 1 / -1;
  }
}
</style>
