export interface Point {
  x: number
  y: number
}

/** TL, TR, BR, BL (image coords, Y downward) */
export type Quad = [Point, Point, Point, Point]

export type Side = 'front' | 'back'

export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface PipelineConfig {
  aspectRatio: number
  enhance: boolean
  allowFallback: boolean
  engine: 'card_correction' | 'native'
  side: Side
}

export interface WatermarkStyle {
  text: string
  fontSizePx: number
  angleDegrees: number
  letterSpacing: number
  lineSpacing: number
  opacity: number
}

export interface PhotocopyStyle {
  cornerRadiusMM: number
  edgeLineMM: number
  edgeVignetteMM: number
  edgeLineStrength: number
  vignetteStrength: number
}

export interface GenerateOptions {
  dpi: number
  marginMM: number
  gapMM: number
  enhance: boolean
  allowFallback: boolean
  randomTilt: boolean
  photocopyLook: boolean
  grayscale: boolean
  engine: 'card_correction' | 'native'
  maxTiltDegrees: number
  maxOffsetMM: number
  watermarkEnabled: boolean
  watermarkText: string
  watermarkFontSize: number
  watermarkAngle: number
  watermarkLetterSpacing: number
  watermarkLineSpacing: number
}

export const ID_CARD = {
  type: 'id_card',
  name: '中华人民共和国居民身份证',
  widthMM: 85.6,
  heightMM: 54.0,
  aspect: 85.6 / 54.0,
} as const

export const A4 = {
  widthMM: 210,
  heightMM: 297,
} as const

export function defaultOptions(): GenerateOptions {
  return {
    dpi: 300,
    marginMM: 20,
    gapMM: 12,
    enhance: true,
    allowFallback: true,
    randomTilt: true,
    photocopyLook: true,
    grayscale: false,
    engine: 'card_correction',
    maxTiltDegrees: 3,
    maxOffsetMM: 2.5,
    watermarkEnabled: false,
    watermarkText: '仅供办理业务使用',
    watermarkFontSize: 36,
    watermarkAngle: -32,
    watermarkLetterSpacing: 10,
    watermarkLineSpacing: 96,
  }
}

export function defaultWatermark(): WatermarkStyle {
  return {
    text: '仅供办理业务使用',
    fontSizePx: 36,
    angleDegrees: -32,
    letterSpacing: 10,
    lineSpacing: 96,
    opacity: 56,
  }
}

export function defaultPhotocopy(): PhotocopyStyle {
  return {
    cornerRadiusMM: 3.18,
    edgeLineMM: 0.35,
    edgeVignetteMM: 2.0,
    edgeLineStrength: 0.55,
    vignetteStrength: 0.22,
  }
}
