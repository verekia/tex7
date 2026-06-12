// Image processing pipeline: load → luminance → clamp normalize → edge-preserving smooth → gamma → recolor

import { hexToRgb, hueRotateLinear, linearToSrgb, srgbToLinear } from './color'

const ALPHA_THRESHOLD = 8
export const DEFAULT_CLAMP_LOW = 0.001
export const DEFAULT_CLAMP_HIGH = 0.001

/** Return the values at the low and high percentiles from a Float64Array subset. */
function percentileBounds(values: Float64Array, indices: number[], lowPct: number, highPct: number): [number, number] {
  const sorted = new Float64Array(indices.length)
  for (let i = 0; i < indices.length; i++) sorted[i] = values[indices[i]]
  sorted.sort()
  const n = sorted.length
  const loIdx = Math.max(0, Math.min(n - 1, Math.floor(lowPct * (n - 1))))
  const hiIdx = Math.max(0, Math.min(n - 1, Math.ceil(highPct * (n - 1))))
  return [sorted[loIdx], sorted[hiIdx]]
}

export interface ProcessedImage {
  width: number
  height: number
  originalData: Uint8ClampedArray
  /** Raw linear luminance (Rec. 709), NaN for transparent pixels. */
  rawLuminanceMap: Float64Array
  /** Indices of opaque pixels. */
  opaqueIndices: number[]
  /** Clamp-normalized luminance in [0,1]. NaN for transparent. */
  normalizedMap: Float64Array
  /** After edge-preserving smoothing. NaN for transparent. */
  smoothedMap: Float64Array
  /** Final luminance after gamma. NaN for transparent. */
  luminanceMap: Float64Array
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.addEventListener('load', () => {
      URL.revokeObjectURL(url)
      resolve(img)
    })
    img.addEventListener('error', () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    })
    img.src = url
  })
}

export function getPixelData(img: HTMLImageElement): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: imageData.data, width: canvas.width, height: canvas.height }
}

export function processPixels(data: Uint8ClampedArray, width: number, height: number): ProcessedImage | string {
  const totalPixels = width * height

  if (width > 4096 || height > 4096) {
    console.warn(`Large texture (${width}x${height}). Processing may be slow.`)
  }

  const opaqueIndices: number[] = []
  for (let i = 0; i < totalPixels; i++) {
    if (data[i * 4 + 3] >= ALPHA_THRESHOLD) {
      opaqueIndices.push(i)
    }
  }

  if (opaqueIndices.length < 100) {
    return 'Too few opaque pixels (fewer than 100). Cannot process this image.'
  }

  const rawLuminanceMap = new Float64Array(totalPixels)
  rawLuminanceMap.fill(NaN)

  for (let i = 0; i < opaqueIndices.length; i++) {
    const idx = opaqueIndices[i]
    const pi = idx * 4
    const lr = srgbToLinear(data[pi])
    const lg = srgbToLinear(data[pi + 1])
    const lb = srgbToLinear(data[pi + 2])
    rawLuminanceMap[idx] = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
  }

  const normalizedMap = new Float64Array(totalPixels)
  normalizedMap.fill(NaN)
  const smoothedMap = new Float64Array(totalPixels)
  smoothedMap.fill(NaN)
  const luminanceMap = new Float64Array(totalPixels)
  luminanceMap.fill(NaN)

  return {
    width,
    height,
    originalData: data,
    rawLuminanceMap,
    opaqueIndices,
    normalizedMap,
    smoothedMap,
    luminanceMap,
  }
}

/**
 * Recompute `result.normalizedMap` from `result.rawLuminanceMap` using the given
 * clamp fractions (e.g. 0.05 = clamp the darkest 5% to 0). Mutates the map in place.
 */
export function applyLuminanceClamp(result: ProcessedImage, clampLow: number, clampHigh: number): void {
  const { rawLuminanceMap, opaqueIndices, normalizedMap } = result

  let minLum = Infinity
  let maxLum = -Infinity
  for (let i = 0; i < opaqueIndices.length; i++) {
    const v = rawLuminanceMap[opaqueIndices[i]]
    if (v < minLum) minLum = v
    if (v > maxLum) maxLum = v
  }

  if (maxLum - minLum <= 1e-10) {
    for (let i = 0; i < opaqueIndices.length; i++) {
      normalizedMap[opaqueIndices[i]] = 0.5
    }
    return
  }

  const [lumLo, lumHi] = percentileBounds(rawLuminanceMap, opaqueIndices, clampLow, 1 - clampHigh)
  const range = lumHi - lumLo

  if (range <= 1e-10) {
    for (let i = 0; i < opaqueIndices.length; i++) {
      normalizedMap[opaqueIndices[i]] = 0.5
    }
    return
  }

  for (let i = 0; i < opaqueIndices.length; i++) {
    const idx = opaqueIndices[i]
    normalizedMap[idx] = Math.max(0, Math.min(1, (rawLuminanceMap[idx] - lumLo) / range))
  }
}

/**
 * Separable box mean with clamped windows (border windows shrink, so every
 * output stays a true local mean). O(n) regardless of radius.
 */
function boxMean(src: Float64Array, w: number, h: number, r: number, dst: Float64Array, tmp: Float64Array): void {
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    const initial = Math.min(r, w - 1)
    for (let x = 0; x <= initial; x++) sum += src[row + x]
    let count = initial + 1
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / count
      const add = x + r + 1
      if (add < w) {
        sum += src[row + add]
        count++
      }
      const rem = x - r
      if (rem >= 0) {
        sum -= src[row + rem]
        count--
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    const initial = Math.min(r, h - 1)
    for (let y = 0; y <= initial; y++) sum += tmp[y * w + x]
    let count = initial + 1
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / count
      const add = y + r + 1
      if (add < h) {
        sum += tmp[add * w + x]
        count++
      }
      const rem = y - r
      if (rem >= 0) {
        sum -= tmp[rem * w + x]
        count--
      }
    }
  }
}

/**
 * Self-guided filter (He et al.). Output per window is a*I + b with
 * a = var/(var + eps): low-variance areas (grain, noise) collapse toward their
 * local mean while high-variance areas (edges) pass through untouched.
 */
function guidedFilterSelf(input: Float64Array, w: number, h: number, r: number, eps: number): Float64Array {
  const n = w * h
  const tmp = new Float64Array(n)
  const meanI = new Float64Array(n)
  boxMean(input, w, h, r, meanI, tmp)

  const sq = new Float64Array(n)
  for (let i = 0; i < n; i++) sq[i] = input[i] * input[i]
  const corrI = new Float64Array(n)
  boxMean(sq, w, h, r, corrI, tmp)

  const a = new Float64Array(n)
  const b = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const varI = Math.max(0, corrI[i] - meanI[i] * meanI[i])
    const ai = varI / (varI + eps)
    a[i] = ai
    b[i] = meanI[i] * (1 - ai)
  }

  const meanA = new Float64Array(n)
  const meanB = new Float64Array(n)
  boxMean(a, w, h, r, meanA, tmp)
  boxMean(b, w, h, r, meanB, tmp)

  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = meanA[i] * input[i] + meanB[i]
  return out
}

/**
 * Recompute `result.smoothedMap` from `result.normalizedMap`.
 * `strength` in [0,1] maps to the guided filter's eps; 0 disables smoothing.
 * `radius` is the detail scale in pixels: variations smaller than this are
 * candidates for flattening.
 */
export function applySmoothing(result: ProcessedImage, radius: number, strength: number): void {
  const { width, height, normalizedMap, smoothedMap, opaqueIndices } = result

  if (strength <= 0) {
    smoothedMap.set(normalizedMap)
    return
  }

  const n = width * height
  const work = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const v = normalizedMap[i]
    work[i] = isNaN(v) ? 0.5 : v
  }

  const eps = strength * strength * 0.16
  const filtered = guidedFilterSelf(work, width, height, Math.max(1, Math.round(radius)), eps)

  smoothedMap.fill(NaN)
  for (let i = 0; i < opaqueIndices.length; i++) {
    const idx = opaqueIndices[i]
    smoothedMap[idx] = Math.max(0, Math.min(1, filtered[idx]))
  }
}

/** Recompute `result.luminanceMap` from `result.smoothedMap` with a midtone gamma curve. */
export function applyGamma(result: ProcessedImage, gamma: number): void {
  const { smoothedMap, luminanceMap, opaqueIndices } = result
  luminanceMap.fill(NaN)
  for (let i = 0; i < opaqueIndices.length; i++) {
    const idx = opaqueIndices[i]
    luminanceMap[idx] = Math.pow(smoothedMap[idx], gamma)
  }
}

/** Grayscale render of the final luminance, preserving the source alpha. */
export function buildGrayscaleImage(result: ProcessedImage): ImageData {
  const { width, height, originalData, luminanceMap } = result
  const imageData = new ImageData(width, height)
  const out = imageData.data

  for (let i = 0; i < width * height; i++) {
    const g = luminanceMap[i]
    if (isNaN(g)) {
      out[i * 4] = 0
      out[i * 4 + 1] = 0
      out[i * 4 + 2] = 0
      out[i * 4 + 3] = 0
    } else {
      const v = Math.round(g * 255)
      out[i * 4] = v
      out[i * 4 + 1] = v
      out[i * 4 + 2] = v
      out[i * 4 + 3] = originalData[i * 4 + 3]
    }
  }

  return imageData
}

/**
 * Fully opaque grayscale render for GPU sampling. Transparent pixels become
 * neutral mid-gray so canvas premultiplication can't zero them out and bump
 * sampling stays artifact-free.
 */
export function buildOpaqueGrayscaleImage(result: ProcessedImage): ImageData {
  const { width, height, luminanceMap } = result
  const imageData = new ImageData(width, height)
  const out = imageData.data

  for (let i = 0; i < width * height; i++) {
    const g = luminanceMap[i]
    const v = isNaN(g) ? 128 : Math.round(g * 255)
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }

  return imageData
}

export interface RecolorParams {
  baseHex: string
  darken: number
  lighten: number
  /** Hue rotation in radians applied to shadows, proportional to shadow depth. */
  shadowHueShift: number
}

/**
 * Single-color shading model (mirrors the TSL color node in three-scene.ts):
 *   t = luminance * 2 - 1
 *   shadow = max(-t, 0) * darken   → multiplicative darkening (keeps hue/saturation)
 *   highlight = max(t, 0) * lighten → screen toward white
 * Shadows can additionally hue-rotate for artistic shadow tinting.
 * All math in linear RGB.
 */
export function buildRecoloredImage(result: ProcessedImage, params: RecolorParams): ImageData {
  const { width, height, originalData, luminanceMap } = result
  const { baseHex, darken, lighten, shadowHueShift } = params
  const imageData = new ImageData(width, height)
  const out = imageData.data

  const [sr, sg, sb] = hexToRgb(baseHex)
  const baseR = srgbToLinear(sr)
  const baseG = srgbToLinear(sg)
  const baseB = srgbToLinear(sb)

  for (let i = 0; i < width * height; i++) {
    const g = luminanceMap[i]
    if (isNaN(g)) {
      out[i * 4] = 0
      out[i * 4 + 1] = 0
      out[i * 4 + 2] = 0
      out[i * 4 + 3] = 0
      continue
    }

    const t = g * 2 - 1
    const shadow = Math.min(1, Math.max(0, -t) * darken)
    const highlight = Math.min(1, Math.max(0, t) * lighten)

    let r = baseR
    let gg = baseG
    let b = baseB
    if (shadowHueShift !== 0 && shadow > 0) {
      ;[r, gg, b] = hueRotateLinear(r, gg, b, shadowHueShift * shadow)
    }

    r *= 1 - shadow
    gg *= 1 - shadow
    b *= 1 - shadow

    r += (1 - r) * highlight
    gg += (1 - gg) * highlight
    b += (1 - b) * highlight

    out[i * 4] = linearToSrgb(Math.max(0, Math.min(1, r)))
    out[i * 4 + 1] = linearToSrgb(Math.max(0, Math.min(1, gg)))
    out[i * 4 + 2] = linearToSrgb(Math.max(0, Math.min(1, b)))
    out[i * 4 + 3] = originalData[i * 4 + 3]
  }

  return imageData
}

export function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(imageData, 0, 0)
  return canvas
}
