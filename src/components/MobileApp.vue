<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { GenerateOptions, Side } from '../lib/types'
import { defaultOptions } from '../lib/types'
import { DOCUMENT_NAME, formatDuration, isImageFile, readFilePreview } from '../lib/utils'
import { generateIDCardPdf } from '../lib/generate'
import { downloadBlob, tryShareFiles } from '../lib/pdf'
import { loadCardCorrectionSession } from '../lib/ort'
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

const modelLoading = ref(true)
const modelReady = ref(false)

const modalVisible = computed(() => modelLoading.value || busy.value)
const modalTitle = computed(() => {
  if (modelLoading.value) return '正在准备本地引擎'
  return busy.value ? '正在生成' : ''
})
const modalText = computed(() => {
  if (modelLoading.value) {
    return status.value || '首次启动需加载视觉模型，仅存于本机'
  }
  return status.value || '计算在本机完成，请稍候'
})

const runtimeState = computed(() => {
  if (modelLoading.value) return { tone: 'load' as const, label: '引擎启动中' }
  if (data.opts.engine === 'native') return { tone: 'ok' as const, label: '边缘引擎' }
  if (modelReady.value) return { tone: 'ok' as const, label: '智能矫正' }
  return { tone: 'warn' as const, label: '引擎未就绪' }
})

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

const canGenerate = computed(() => {
  if (readyCount.value !== 2 || busy.value || modelLoading.value) return false
  if (data.opts.engine === 'card_correction') return modelReady.value
  return true
})

const engineLabel = computed(() =>
  data.opts.engine === 'card_correction' ? '智能矫正' : '边缘检测',
)

const previewTag = computed(() => {
  if (!engineUsed.value) return '待生成'
  return engineUsed.value === 'card_correction' ? '智能矫正' : '边缘检测'
})

function sideState(side: Side): SideState {
  return side === 'front' ? data.front : data.back
}

function toggleFold(key: 'effects' | 'watermark') {
  openFold.value = openFold.value === key ? null : key
}

function sanitize(msg: string): string {
  return msg
    .replace(/ONNX/gi, '本地引擎')
    .replace(/cv_resnet18\S*/gi, '智能矫正')
    .replace(/card_correction/gi, '智能矫正')
    .replace(/模型下载失败[^，。]*/g, '本地引擎加载失败')
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
  status.value = side === 'front' ? '左侧已清除' : '右侧已清除'
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
  status.value = `${readyCount.value}/2 已就绪`
}

function openPicker(side: Side, mode: 'camera' | 'gallery') {
  const input = (mode === 'camera' ? cameraInputs : galleryInputs)[side].value
  input?.click()
}

function onPick(side: Side, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  void applyFile(side, file)
  input.value = ''
}

async function generate() {
  if (!canGenerate.value) return
  busy.value = true
  error.value = ''
  status.value = '本地计算中…'
  progress.value = 0
  clearOutput()
  try {
    const result = await generateIDCardPdf(
      data.front.file!,
      data.back.file!,
      { ...data.opts },
      (msg, ratio) => {
        status.value = sanitize(msg)
        progress.value = ratio
      },
    )
    sheetUrl.value = result.sheetPreviewUrl
    frontPreview.value = result.frontPreview
    backPreview.value = result.backPreview
    pdfBlob.value = result.pdfBlob
    engineUsed.value = result.engineUsed
    progress.value = 1
    const warn = result.warnings.length ? ` · ${sanitize(result.warnings[0])}` : ''
    status.value = `生成完成 · ${formatDuration(result.durationMs)}${warn}`
  } catch (err) {
    error.value = sanitize(err instanceof Error ? err.message : String(err))
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
    status.value = 'PDF 已保存'
  } else {
    status.value = '已打开分享'
  }
}

function printPdf() {
  if (!pdfBlob.value) return
  const url = URL.createObjectURL(pdfBlob.value)
  const w = window.open(url, '_blank')
  if (!w) error.value = '请允许弹出窗口，或先下载 PDF'
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

async function preloadModel() {
  modelLoading.value = true
  modelReady.value = false
  status.value = '正在加载本地视觉引擎…'
  try {
    await loadCardCorrectionSession()
    modelReady.value = true
    status.value = '本地引擎已就绪'
  } catch (err) {
    modelReady.value = false
    error.value = sanitize(err instanceof Error ? err.message : String(err))
    status.value = '智能引擎暂不可用，可改用边缘检测'
  } finally {
    modelLoading.value = false
  }
}

onMounted(() => {
  requestAnimationFrame(() => {
    mounted.value = true
  })
  void preloadModel()
})
</script>

<template>
  <div class="app" :class="{ ready: mounted }">
    <header class="topbar">
      <div class="brand">
        <div class="mark">ID</div>
        <div class="brand-text">
          <strong>IDA4</strong>
          <span>{{ DOCUMENT_NAME }}</span>
        </div>
      </div>
      <div class="top-meta">
        <span class="pill">
          <i class="pulse" :class="runtimeState.tone" />
          {{ runtimeState.label }}
        </span>
        <span class="pill hide-sm">本地计算</span>
        <span class="pill hide-sm">数据不出设备</span>
        <span class="pill hide-sm mono">{{ engineLabel }}</span>
      </div>
    </header>

    <div class="main">
      <aside class="pane left">
        <div class="left-scroll">
        <div class="slots">
          <article
            v-for="side in (['front', 'back'] as Side[])"
            :key="side"
            class="slot"
            :class="{ filled: !!sideState(side).preview }"
          >
            <button type="button" class="slot-hit" @click="openPicker(side, 'gallery')">
              <img v-if="sideState(side).preview" :src="sideState(side).preview" alt="" />
              <span v-else class="plus" aria-hidden="true">+</span>
            </button>
            <div class="slot-tools">
              <button type="button" class="icon-btn" title="相机" @click="openPicker(side, 'camera')">◎</button>
              <button
                v-if="sideState(side).preview"
                type="button"
                class="icon-btn danger"
                title="清除"
                @click="clearSide(side, $event)"
              >
                ×
              </button>
            </div>
            <input
              :ref="(el) => { cameraInputs[side].value = el as HTMLInputElement | null }"
              class="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              @change="onPick(side, $event)"
            />
            <input
              :ref="(el) => { galleryInputs[side].value = el as HTMLInputElement | null }"
              class="hidden"
              type="file"
              accept="image/*"
              @change="onPick(side, $event)"
            />
          </article>
        </div>

        <label class="field">
          <span class="field-label">引擎</span>
          <select v-model="data.opts.engine" class="select">
            <option value="card_correction">智能矫正</option>
            <option value="native">边缘检测</option>
          </select>
        </label>

        <div class="fold">
          <button type="button" class="fold-head" @click="toggleFold('effects')">
            <span>效果</span>
            <span class="muted mono">{{ openFold === 'effects' ? '−' : '+' }}</span>
          </button>
          <div v-show="openFold === 'effects'" class="fold-body">
            <label class="check"><input v-model="data.opts.enhance" type="checkbox" /><span>增强</span></label>
            <label class="check"><input v-model="data.opts.allowFallback" type="checkbox" /><span>降级</span></label>
            <label class="check"><input v-model="data.opts.randomTilt" type="checkbox" /><span>倾斜</span></label>
            <label class="check"><input v-model="data.opts.photocopyLook" type="checkbox" /><span>黑边</span></label>
            <label class="check"><input v-model="data.opts.grayscale" type="checkbox" /><span>黑白</span></label>
          </div>
        </div>

        <div class="fold">
          <button type="button" class="fold-head" @click="toggleFold('watermark')">
            <span>水印</span>
            <span class="muted mono">{{ data.opts.watermarkEnabled ? '开' : '关' }}</span>
          </button>
          <div v-show="openFold === 'watermark'" class="fold-body">
            <label class="check"><input v-model="data.opts.watermarkEnabled" type="checkbox" /><span>启用</span></label>
            <input
              v-model="data.opts.watermarkText"
              class="text-input"
              maxlength="32"
              placeholder="水印文字"
              :disabled="!data.opts.watermarkEnabled"
            />
            <div class="slider">
              <div class="slider-head"><span>字号</span><span class="mono">{{ data.opts.watermarkFontSize }}</span></div>
              <input v-model.number="data.opts.watermarkFontSize" type="range" min="16" max="72" :disabled="!data.opts.watermarkEnabled" />
            </div>
            <div class="slider">
              <div class="slider-head"><span>角度</span><span class="mono">{{ data.opts.watermarkAngle }}°</span></div>
              <input v-model.number="data.opts.watermarkAngle" type="range" min="-60" max="60" :disabled="!data.opts.watermarkEnabled" />
            </div>
            <div class="slider">
              <div class="slider-head"><span>字距</span><span class="mono">{{ data.opts.watermarkLetterSpacing }}</span></div>
              <input v-model.number="data.opts.watermarkLetterSpacing" type="range" min="0" max="40" :disabled="!data.opts.watermarkEnabled" />
            </div>
            <div class="slider">
              <div class="slider-head"><span>行距</span><span class="mono">{{ data.opts.watermarkLineSpacing }}</span></div>
              <input v-model.number="data.opts.watermarkLineSpacing" type="range" min="40" max="220" step="2" :disabled="!data.opts.watermarkEnabled" />
            </div>
          </div>
        </div>

        </div>
        <!-- /left-scroll -->

        <div class="dock">
          <div class="status">
            <span class="status-line">
              {{ status || (modelLoading ? '准备引擎…' : `${readyCount}/2 · ${engineLabel}`) }}
            </span>
            <span v-if="busy" class="mono">{{ Math.round(progress * 100) }}%</span>
          </div>
          <div v-if="error" class="error">{{ error }}</div>
          <div class="actions">
            <button type="button" class="btn primary" :disabled="!canGenerate" @click="generate">
              {{ busy ? '生成中…' : modelLoading ? '准备中…' : '生成' }}
            </button>
            <button type="button" class="btn" :disabled="!pdfBlob" @click="download">下载</button>
            <button type="button" class="btn quiet" :disabled="!pdfBlob" @click="printPdf">打印</button>
          </div>
        </div>
      </aside>

      <section class="pane right">
        <div class="preview-head">
          <h2>A4 预览</h2>
          <span class="badge">{{ previewTag }}</span>
        </div>
        <div class="preview-frame stage" :class="{ empty: !sheetUrl }">
          <img v-if="sheetUrl" :src="sheetUrl" alt="A4" />
          <div v-else class="stage-empty">
            <div class="stage-ring" />
            <p class="status-line">{{ readyCount < 2 ? `${readyCount}/2` : '就绪' }}</p>
          </div>
        </div>
        <div v-if="frontPreview || backPreview" class="card-previews thumbs">
          <figure v-if="frontPreview"><img :src="frontPreview" alt="" /></figure>
          <figure v-if="backPreview"><img :src="backPreview" alt="" /></figure>
        </div>
      </section>
    </div>

    <div v-if="modalVisible" class="modal-mask mask" role="status" aria-live="polite">
      <div class="modal">
        <div class="orb" aria-hidden="true"><span /></div>
        <div class="modal-title">{{ modalTitle }}</div>
        <div class="modal-text">{{ modalText }}</div>
        <div v-if="busy" class="modal-pct mono">{{ Math.round(progress * 100) }}%</div>
        <div v-if="busy" class="progress modal-bar">
          <i :style="{ width: `${Math.round(progress * 100)}%` }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  --bg: #09090b;
  --surface: rgba(255, 255, 255, 0.04);
  --line: rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.14);
  --ink: #f5f5f7;
  --muted: #98989d;
  --dim: #6e6e73;
  --accent: #7dd3fc;
  --accent-ink: #0b1220;
  --ok: #6ee7b7;
  --warn: #fbbf24;
  --danger: #f87171;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--ink);
  background:
    radial-gradient(720px 320px at 8% -10%, rgba(125, 211, 252, 0.1), transparent 48%),
    radial-gradient(520px 280px at 92% 0%, rgba(167, 139, 250, 0.07), transparent 45%),
    var(--bg);
}

.topbar {
  flex: 0 0 auto;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(9, 9, 11, 0.72);
  backdrop-filter: blur(14px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.mark {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--accent);
  background: rgba(125, 211, 252, 0.12);
  border: 1px solid rgba(125, 211, 252, 0.28);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.brand-text strong {
  font-size: 0.95rem;
  letter-spacing: -0.02em;
}

.brand-text span {
  color: var(--muted);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: #d2d2d7;
  font-size: 0.72rem;
  white-space: nowrap;
}

.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
}

.pulse.ok {
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(110, 231, 183, 0.12);
}

.pulse.warn {
  background: var(--warn);
}

.pulse.load {
  background: var(--accent);
  animation: breathe 1.4s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.main {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
}

.pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}

.left {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border-right: 1px solid var(--line);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.012);
}

.left-scroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 8px;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.left-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.right {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  overflow: hidden;
}

.slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex: 0 0 auto;
}

.slot {
  position: relative;
  min-width: 0;
}

.slot-hit {
  width: 100%;
  aspect-ratio: 1.58;
  border: 1px solid var(--line);
  background: #0c0c0f;
  border-radius: 14px;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  display: block;
  position: relative;
}

.slot.filled .slot-hit,
.slot-hit:hover {
  border-color: rgba(125, 211, 252, 0.32);
}

.slot-hit img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  background: #0a0a0c;
}

.slot-hit .plus {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.plus {
  color: var(--dim);
  font-size: 1.5rem;
  font-weight: 300;
  line-height: 1;
}

.slot-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(10, 10, 12, 0.72);
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}

.icon-btn.danger {
  color: var(--danger);
}

.hidden {
  display: none;
}

.field {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.field-label {
  font-size: 0.78rem;
  color: var(--muted);
  flex: 0 0 auto;
}

.select {
  flex: 1 1 auto;
  min-width: 0;
  appearance: none;
  background: rgba(255, 255, 255, 0.04)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%98989d' d='M1 1l5 5 5-5'/%3E%3C/svg%3E")
    no-repeat right 12px center;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 32px 10px 12px;
  color: var(--ink);
  font-size: 0.85rem;
}

.fold {
  border-top: 1px solid var(--line);
  flex: 0 0 auto;
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
  color: inherit;
  font-weight: 560;
  font-size: 0.86rem;
}

.fold-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  padding-bottom: 8px;
}

.fold-body .text-input,
.fold-body .slider {
  grid-column: 1 / -1;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  font-size: 0.8rem;
  color: #e5e5ea;
  cursor: pointer;
}

.check input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}

.text-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  color: var(--ink);
  font-size: 0.82rem;
}

.slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slider-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--muted);
}

input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}

.muted {
  color: var(--dim);
}

.dock {
  margin-top: 0;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--line);
  background: rgba(12, 12, 16, 0.92);
  backdrop-filter: blur(10px);
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}

.status {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 0.74rem;
  min-height: 1.2em;
}

.status-line {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error {
  color: #fecaca;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.22);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.74rem;
  line-height: 1.45;
}

.actions {
  display: grid;
  grid-template-columns: 1.25fr 0.9fr 0.7fr;
  gap: 8px;
}

.btn {
  min-height: 42px;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: rgba(255, 255, 255, 0.04);
  color: var(--ink);
  font-weight: 560;
  font-size: 0.86rem;
  cursor: pointer;
}

.btn.primary {
  background: linear-gradient(180deg, #b8e6fb, var(--accent));
  border-color: transparent;
  color: var(--accent-ink);
  box-shadow: 0 8px 24px rgba(125, 211, 252, 0.12);
}

.btn.quiet {
  background: transparent;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  box-shadow: none;
}

.btn:not(:disabled):active {
  transform: scale(0.985);
}

.preview-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preview-head h2 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.badge {
  font-size: 0.72rem;
  color: var(--accent);
  border: 1px solid rgba(125, 211, 252, 0.25);
  background: rgba(125, 211, 252, 0.08);
  padding: 4px 10px;
  border-radius: 999px;
}

.preview-frame,
.stage {
  flex: 1 1 auto;
  min-height: 0;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: #101014;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 10px;
}

.stage img,
.preview-frame img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: center;
  background: #ffffff;
  border-radius: 2px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 18px 48px rgba(0, 0, 0, 0.45);
}

.stage-empty {
  color: var(--dim);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.stage-empty p {
  margin: 0;
  font-size: 0.88rem;
  color: var(--muted);
}

.stage-ring {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: conic-gradient(from 210deg, rgba(125, 211, 252, 0.35), transparent 40%, rgba(255, 255, 255, 0.06));
  mask: radial-gradient(circle, transparent 42%, #000 43%);
  -webkit-mask: radial-gradient(circle, transparent 42%, #000 43%);
}

.card-previews,
.thumbs {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.thumbs figure {
  margin: 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #0a0a0c;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.thumbs img {
  width: 100%;
  height: auto;
  max-height: 96px;
  object-fit: contain;
  object-position: center;
  display: block;
  background: #111;
  border-radius: 4px;
}

.left,
.right {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.left::-webkit-scrollbar,
.right::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.modal-mask,
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(10px);
  padding: 24px;
}

.modal {
  width: min(300px, 86vw);
  border-radius: 20px;
  border: 1px solid var(--line-strong);
  background: rgba(18, 18, 20, 0.92);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  padding: 24px 18px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.orb {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.2), rgba(125, 211, 252, 0.12) 45%, transparent 70%);
}

.orb span {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(125, 211, 252, 0.25);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.modal-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.modal-text {
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.5;
}

.modal-pct {
  color: var(--accent);
  font-size: 0.75rem;
}

.progress,
.modal-bar {
  width: 100%;
  height: 2px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.progress i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgba(125, 211, 252, 0.4), var(--accent));
}

@media (min-width: 900px) {
  .hide-sm {
    display: inline-flex;
  }
}

@media (max-width: 899px) {
  .hide-sm {
    display: none;
  }

  .brand-text span {
    display: none;
  }

  .topbar {
    height: 44px;
    flex: 0 0 44px;
  }

  .main {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(140px, 38%) minmax(0, 62%);
  }

  .left {
    order: 2;
    border-right: none;
    border-top: 1px solid var(--line);
  }

  .left-scroll {
    padding: 10px 10px 6px;
    gap: 8px;
  }

  .right {
    order: 1;
    padding: 8px 10px 6px;
  }

  .slots {
    gap: 8px;
  }

  .thumbs img {
    height: 56px;
  }

  .check {
    min-height: 36px;
    font-size: 0.84rem;
  }

  .fold-head {
    padding: 12px 0;
    min-height: 44px;
  }

  .btn {
    min-height: 44px;
  }
}

@media (max-width: 420px) {
  .topbar {
    height: 46px;
    padding: 0 10px;
  }

  .left,
  .right {
    padding: 10px;
    gap: 8px;
  }

  .slots {
    gap: 8px;
  }

  .actions {
    grid-template-columns: 1.35fr 1fr 0.75fr;
  }

  .btn {
    min-height: 40px;
    font-size: 0.8rem;
  }
}
</style>
