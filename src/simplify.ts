// Edge-preserving luminance simplification — He et al.'s self-guided filter.
//
// Goal: flatten "flat + noise" areas (grain, compression mush) into clean
// surfaces while keeping strong edges and gradients at full contrast, so the
// luminance condenses into the few values that actually carry shape.
//
// Output per window is a*I + b with a = var/(var + eps): low-variance areas
// collapse toward their local mean while edges pass through. Smooth by
// construction (little to no aliasing) and O(n) regardless of radius.
// Neighborhood indexing wraps toroidally so tileable textures stay seamless.

export interface SimplifyOptions {
  /** Master on/off — when false the raw luminance passes through untouched (for A/B). */
  enabled: boolean
  /** 0..100. 0 bypasses the filter. Maps to the guided filter's eps. */
  strength: number
  /** Spatial kernel half-width in pixels. */
  radius: number
  /** Filter iterations. More passes flatten low-variation areas further. */
  passes: number
}

export function simplifyLuminance(
  src: Float32Array,
  width: number,
  height: number,
  opts: SimplifyOptions,
): Float32Array {
  const { enabled, strength, radius, passes } = opts
  if (!enabled || strength <= 0 || passes <= 0) return src.slice()

  return guidedSimplify(src, width, height, strength, radius, passes)
}

/**
 * Maps `strength` to the guided filter's eps as eps = tol²: `tol` is the local-std
 * threshold below which a region collapses to its mean. The ^1.5 curve gives finer
 * control at low strength.
 */
function toleranceFromStrength(strength: number): number {
  return 0.3 * Math.pow(strength / 100, 1.5)
}

// --- Guided (He et al., self-guided) ---

/**
 * Separable box mean with clamped windows (border windows shrink, so every
 * output stays a true local mean). O(n) regardless of radius.
 */
function boxMean(src: Float32Array, w: number, h: number, r: number, dst: Float32Array, tmp: Float32Array): void {
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

function guidedFilterSelf(input: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h
  const tmp = new Float32Array(n)
  const meanI = new Float32Array(n)
  boxMean(input, w, h, r, meanI, tmp)

  const sq = new Float32Array(n)
  for (let i = 0; i < n; i++) sq[i] = input[i] * input[i]
  const corrI = new Float32Array(n)
  boxMean(sq, w, h, r, corrI, tmp)

  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const varI = Math.max(0, corrI[i] - meanI[i] * meanI[i])
    const ai = varI / (varI + eps)
    a[i] = ai
    b[i] = meanI[i] * (1 - ai)
  }

  const meanA = new Float32Array(n)
  const meanB = new Float32Array(n)
  boxMean(a, w, h, r, meanA, tmp)
  boxMean(b, w, h, r, meanB, tmp)

  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = meanA[i] * input[i] + meanB[i]
  return out
}

function guidedSimplify(
  src: Float32Array,
  width: number,
  height: number,
  strength: number,
  radius: number,
  passes: number,
): Float32Array {
  const n = width * height
  const valid = new Uint8Array(n)
  // Transparent pixels become local mid so box sums stay finite; restored to NaN at the end.
  const work = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (Number.isNaN(v)) {
      valid[i] = 0
      work[i] = 0.5
    } else {
      valid[i] = 1
      work[i] = v
    }
  }

  const r = Math.max(1, Math.round(radius))
  // eps = tolerance²: regions whose local std is below `tol` collapse to their mean.
  const tol = toleranceFromStrength(strength)
  const eps = tol * tol

  let current: Float32Array = work
  for (let pass = 0; pass < passes; pass++) {
    current = guidedFilterSelf(current, width, height, r, eps)
  }

  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = valid[i] ? Math.max(0, Math.min(1, current[i])) : NaN
  return out
}
