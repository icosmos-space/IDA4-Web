import { jsPDF } from 'jspdf'
import { A4 } from './types'

export function buildPdfFromJpeg(jpegBytes: Uint8Array, title = '身份证复印件'): jsPDF {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [A4.widthMM, A4.heightMM],
    compress: true,
  })
  pdf.setProperties({ title })
  // jsPDF needs a data URL / binary string for image
  const chunks: string[] = []
  const chunk = 0x8000
  for (let i = 0; i < jpegBytes.length; i += chunk) {
    chunks.push(String.fromCharCode(...jpegBytes.subarray(i, i + chunk)))
  }
  const b64 = btoa(chunks.join(''))
  pdf.addImage(`data:image/jpeg;base64,${b64}`, 'JPEG', 0, 0, A4.widthMM, A4.heightMM, undefined, 'FAST')
  return pdf
}

export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('JPEG encode failed'))
          return
        }
        const buf = await blob.arrayBuffer()
        resolve(new Uint8Array(buf))
      },
      'image/jpeg',
      quality,
    )
  })
}

export async function canvasToPdfBlob(
  canvas: HTMLCanvasElement,
  title = '身份证复印件',
): Promise<Blob> {
  const jpeg = await canvasToJpegBytes(canvas, 0.92)
  const pdf = buildPdfFromJpeg(jpeg, title)
  const out = pdf.output('arraybuffer')
  return new Blob([out], { type: 'application/pdf' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function tryShareFiles(file: File, title: string, text?: string): Promise<boolean> {
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    return false
  }
  try {
    await navigator.share({ files: [file], title, text })
    return true
  } catch {
    return false
  }
}
