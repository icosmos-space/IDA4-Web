import type { GenerateOptions } from './types'

export interface SideState {
  file: File | null
  preview: string
  name: string
}

export const DOCUMENT_NAME = '中华人民共和国居民身份证'

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|heic|heif)$/i.test(file.name)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}

export function effectsHint(opts: GenerateOptions): string {
  const on = [
    opts.enhance && '增强',
    opts.allowFallback && '降级',
    opts.randomTilt && '倾斜',
    opts.photocopyLook && '黑边',
    opts.grayscale && '黑白',
  ].filter(Boolean) as string[]
  return on.length ? on.join('·') : '无'
}

export async function readFilePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export function createFileInput(mode: 'camera' | 'gallery'): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  if (mode === 'camera') {
    input.setAttribute('capture', 'environment')
  }
  return input
}
