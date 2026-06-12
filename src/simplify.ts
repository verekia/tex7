// Edge-preserving luminance simplification: iterated separable bilateral filter.
//
// Same goal as png-cleanup's region unification (flatten "flat + noise" areas,
// keep edges and gradients), generalized for continuous textures: instead of
// flood-filled regions snapped to their mean, each pixel averages neighbors
// whose luminance is within a tolerance (the range gaussian), so low-variation
// grain melts away while strong transitions keep their full contrast. More
// passes converge toward the same piecewise-flat result without region seams.
// Neighborhood indexing wraps toroidally so tileable textures stay seamless.

export interface SimplifyOptions {
  /** 0..100. 0 bypasses the filter. Maps to the range tolerance (sigma). */
  strength: number
  /** Spatial kernel half-width in pixels. */
  radius: number
  /** Filter iterations. More passes flatten low-variation areas further. */
  passes: number
}

const RANGE_BINS = 4096

export function simplifyLuminance(
  src: Float32Array,
  width: number,
  height: number,
  { strength, radius, passes }: SimplifyOptions,
): Float32Array {
  if (strength <= 0 || passes <= 0) return src.slice()

  const r = Math.max(1, Math.min(Math.round(radius), Math.min(width, height) - 1))
  const sigmaR = 0.002 + Math.pow(strength / 100, 1.5) * 0.3
  const sigmaS = Math.max(0.5, r / 2)

  const spatial = new Float32Array(2 * r + 1)
  for (let k = -r; k <= r; k++) spatial[k + r] = Math.exp(-(k * k) / (2 * sigmaS * sigmaS))

  const rangeLut = new Float32Array(RANGE_BINS)
  const invTwoSigmaR2 = 1 / (2 * sigmaR * sigmaR)
  for (let i = 0; i < RANGE_BINS; i++) {
    const d = i / (RANGE_BINS - 1)
    rangeLut[i] = Math.exp(-d * d * invTwoSigmaR2)
  }

  const n = width * height
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) valid[i] = Number.isNaN(src[i]) ? 0 : 1

  const current = src.slice()
  const buffer = new Float32Array(n)

  const horizontalPass = (input: Float32Array, output: Float32Array) => {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const idx = row + x
        if (!valid[idx]) {
          output[idx] = NaN
          continue
        }
        const center = input[idx]
        let sum = 0
        let weightSum = 0
        for (let k = -r; k <= r; k++) {
          let nx = x + k
          if (nx < 0) nx += width
          else if (nx >= width) nx -= width
          const nIdx = row + nx
          if (!valid[nIdx]) continue
          const v = input[nIdx]
          const diff = v > center ? v - center : center - v
          const w = spatial[k + r] * rangeLut[(diff * (RANGE_BINS - 1)) | 0]
          sum += v * w
          weightSum += w
        }
        output[idx] = weightSum > 0 ? sum / weightSum : center
      }
    }
  }

  const verticalPass = (input: Float32Array, output: Float32Array) => {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const idx = row + x
        if (!valid[idx]) {
          output[idx] = NaN
          continue
        }
        const center = input[idx]
        let sum = 0
        let weightSum = 0
        for (let k = -r; k <= r; k++) {
          let ny = y + k
          if (ny < 0) ny += height
          else if (ny >= height) ny -= height
          const nIdx = ny * width + x
          if (!valid[nIdx]) continue
          const v = input[nIdx]
          const diff = v > center ? v - center : center - v
          const w = spatial[k + r] * rangeLut[(diff * (RANGE_BINS - 1)) | 0]
          sum += v * w
          weightSum += w
        }
        output[idx] = weightSum > 0 ? sum / weightSum : center
      }
    }
  }

  for (let pass = 0; pass < passes; pass++) {
    horizontalPass(current, buffer)
    verticalPass(buffer, current)
  }

  return current
}
