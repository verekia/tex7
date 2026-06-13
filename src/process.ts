// Image processing pipeline: load → linear luminance → simplify → clamp/shape → grayscale output

const ALPHA_THRESHOLD = 8

const SRGB_LUT = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const s = i / 255
  SRGB_LUT[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export interface LoadedTexture {
  width: number
  height: number
  originalData: Uint8ClampedArray
  /** Min-max normalized linear luminance (Rec. 709) in [0,1]. NaN for transparent pixels. */
  baseMap: Float32Array
  /** Indices of opaque pixels. */
  opaqueIndices: Int32Array
}

export interface ShapeOptions {
  /** Fraction of darkest pixels clamped to 0 (e.g. 0.05 = darkest 5%). */
  clampLow: number
  /** Fraction of lightest pixels clamped to 1. */
  clampHigh: number
  invert: boolean
  /** Exponent applied to luminance. >1 darkens midtones, <1 lightens them. */
  gamma: number
  /** -1..1. Positive pushes toward an S-curve, negative flattens toward 0.5. */
  contrast: number
  /** 0 = off, otherwise number of bands (2..16). */
  posterizeLevels: number
  /** 0..1 width of the smooth transition between posterize bands. */
  posterizeSoftness: number
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

export function getPixelData(img: HTMLImageElement): { data: Uint8ClampedArray; width: number; height: number } {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: imageData.data, width: canvas.width, height: canvas.height }
}

/**
 * Compute the min-max normalized linear luminance of the image. The percentile
 * clamp is applied later (in `shapeLuminance`) so the expensive simplify step
 * can run once on a stable base map while clamp sliders stay cheap.
 */
export function computeBaseMap(data: Uint8ClampedArray, width: number, height: number): LoadedTexture | string {
  const totalPixels = width * height

  if (width > 4096 || height > 4096) {
    console.warn(`Large texture (${width}x${height}). Processing may be slow.`)
  }

  const opaque: number[] = []
  for (let i = 0; i < totalPixels; i++) {
    if (data[i * 4 + 3] >= ALPHA_THRESHOLD) opaque.push(i)
  }

  if (opaque.length < 100) {
    return 'Too few opaque pixels (fewer than 100). Cannot process this image.'
  }

  const baseMap = new Float32Array(totalPixels)
  baseMap.fill(NaN)

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < opaque.length; i++) {
    const idx = opaque[i]
    const pi = idx * 4
    const lum = 0.2126 * SRGB_LUT[data[pi]] + 0.7152 * SRGB_LUT[data[pi + 1]] + 0.0722 * SRGB_LUT[data[pi + 2]]
    baseMap[idx] = lum
    if (lum < min) min = lum
    if (lum > max) max = lum
  }

  const range = max - min
  for (let i = 0; i < opaque.length; i++) {
    const idx = opaque[i]
    baseMap[idx] = range <= 1e-9 ? 0.5 : (baseMap[idx] - min) / range
  }

  return { width, height, originalData: data, baseMap, opaqueIndices: Int32Array.from(opaque) }
}

/**
 * Remap a (simplified) luminance map into the final texture values:
 * percentile clamp normalization, then invert / gamma / contrast / posterize.
 * Cheap enough to rerun on every slider tick.
 */
export function shapeLuminance(map: Float32Array, opaqueIndices: Int32Array, opts: ShapeOptions): Float32Array {
  const out = new Float32Array(map.length)
  out.fill(NaN)
  const n = opaqueIndices.length

  const sorted = new Float32Array(n)
  for (let i = 0; i < n; i++) sorted[i] = map[opaqueIndices[i]]
  sorted.sort()
  const loIdx = Math.max(0, Math.min(n - 1, Math.floor(opts.clampLow * (n - 1))))
  const hiIdx = Math.max(0, Math.min(n - 1, Math.ceil((1 - opts.clampHigh) * (n - 1))))
  const lo = sorted[loIdx]
  const range = sorted[hiIdx] - lo

  const { invert, gamma, contrast, posterizeLevels: levels, posterizeSoftness: softness } = opts

  for (let i = 0; i < n; i++) {
    const idx = opaqueIndices[i]
    let v = range <= 1e-9 ? 0.5 : (map[idx] - lo) / range
    v = v < 0 ? 0 : v > 1 ? 1 : v
    if (invert) v = 1 - v
    if (gamma !== 1) v = Math.pow(v, gamma)
    if (contrast > 0) v += (v * v * (3 - 2 * v) - v) * contrast
    else if (contrast < 0) v += (0.5 - v) * -contrast
    if (levels >= 2) {
      const f = v * (levels - 1)
      const band = Math.floor(f)
      const frac = f - band
      let fr: number
      if (softness <= 0) {
        fr = frac < 0.5 ? 0 : 1
      } else {
        const t = (frac - 0.5 + softness / 2) / softness
        const ct = t < 0 ? 0 : t > 1 ? 1 : t
        fr = ct * ct * (3 - 2 * ct)
      }
      v = (band + fr) / (levels - 1)
    }
    out[idx] = v
  }

  return out
}

export function buildGrayscaleImage(
  map: Float32Array,
  originalData: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  const imageData = new ImageData(width, height)
  const out = imageData.data

  for (let i = 0; i < width * height; i++) {
    const g = map[i]
    if (Number.isNaN(g)) {
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
