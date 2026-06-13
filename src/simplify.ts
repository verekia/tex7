// Edge-preserving luminance simplification with two interchangeable engines.
//
// Goal (both engines): flatten "flat + noise" areas (grain, compression mush)
// into clean surfaces while keeping strong edges and gradients at full contrast,
// so the luminance condenses into the few values that actually carry shape.
//
// - bilateral — iterated separable bilateral filter. Each pixel averages
//   neighbors whose luminance is within a tolerance (the range gaussian). Very
//   powerful and controllable, but the separable approximation + piecewise-flat
//   result can leave stair-stepped, aliased seams on diagonal edges.
// - guided — He et al.'s self-guided filter. Output per window is a*I + b with
//   a = var/(var + eps): low-variance areas collapse toward their local mean,
//   edges pass through. Smooth by construction (little to no aliasing) and O(n)
//   regardless of radius.
//
// Either result can be run through a light anti-alias pass (a small NaN-aware
// gaussian, blended by `antiAlias`) to round the residual jaggies. Neighborhood
// indexing wraps toroidally so tileable textures stay seamless.

export type SimplifyMethod = 'bilateral' | 'guided'

export interface SimplifyOptions {
  /** Which engine to run. */
  method: SimplifyMethod
  /** 0..100. 0 bypasses the filter. Maps to the range tolerance (bilateral) / eps (guided). */
  strength: number
  /** Spatial kernel half-width in pixels. */
  radius: number
  /** Filter iterations. More passes flatten low-variation areas further. */
  passes: number
  /** 0..1 amount of post-filter anti-aliasing applied to the simplified result. */
  antiAlias: number
}

const RANGE_BINS = 4096

export function simplifyLuminance(
  src: Float32Array,
  width: number,
  height: number,
  opts: SimplifyOptions,
): Float32Array {
  const { method, strength, radius, passes, antiAlias } = opts
  if (strength <= 0 || passes <= 0) return src.slice()

  const simplified =
    method === 'guided'
      ? guidedSimplify(src, width, height, strength, radius, passes)
      : bilateralSimplify(src, width, height, strength, radius, passes)

  return antiAlias > 0 ? antiAliasPass(simplified, width, height, antiAlias) : simplified
}

/**
 * Shared luminance-difference tolerance both engines are calibrated to, so equal
 * `strength` means "smooth variations up to this magnitude" in either one — and
 * an A/B swap shows only the difference in *character*, not in amount. The
 * bilateral uses it directly as the range sigma; the guided filter uses it as
 * sqrt(eps) (the local-std threshold below which a region collapses to its mean).
 */
function toleranceFromStrength(strength: number): number {
  return 0.3 * Math.pow(strength / 100, 1.5)
}

// --- Bilateral (iterated, separable) ---

function bilateralSimplify(
  src: Float32Array,
  width: number,
  height: number,
  strength: number,
  radius: number,
  passes: number,
): Float32Array {
  const r = Math.max(1, Math.min(Math.round(radius), Math.min(width, height) - 1))
  const sigmaR = Math.max(0.002, toleranceFromStrength(strength))
  // Gaussian sigma whose variance matches a box of half-width r (the guided
  // filter's window), so both engines reach about as far spatially per radius.
  const sigmaS = Math.max(0.5, r / Math.sqrt(3))

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
  // eps = tolerance² so the variance threshold matches the bilateral's range sigma.
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

// --- Anti-alias pass ---

/**
 * NaN-aware separable 3-tap gaussian ([0.25, 0.5, 0.25]) blended back into the
 * source by `amount`. In flat regions the blur is a no-op; only the hard,
 * stair-stepped seams left by simplification get rounded — i.e. anti-aliased —
 * without mushing real edges. Wraps toroidally so tiles stay seamless.
 */
function antiAliasPass(src: Float32Array, width: number, height: number, amount: number): Float32Array {
  const n = width * height
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) valid[i] = Number.isNaN(src[i]) ? 0 : 1

  const blur1d = (input: Float32Array, output: Float32Array, horizontal: boolean) => {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const idx = row + x
        if (!valid[idx]) {
          output[idx] = NaN
          continue
        }
        let pIdx: number
        let nIdx: number
        if (horizontal) {
          pIdx = row + (x === 0 ? width - 1 : x - 1)
          nIdx = row + (x === width - 1 ? 0 : x + 1)
        } else {
          pIdx = (y === 0 ? height - 1 : y - 1) * width + x
          nIdx = (y === height - 1 ? 0 : y + 1) * width + x
        }
        let sum = input[idx] * 0.5
        let weight = 0.5
        if (valid[pIdx]) {
          sum += input[pIdx] * 0.25
          weight += 0.25
        }
        if (valid[nIdx]) {
          sum += input[nIdx] * 0.25
          weight += 0.25
        }
        output[idx] = sum / weight
      }
    }
  }

  const tmp = new Float32Array(n)
  const blurred = new Float32Array(n)
  blur1d(src, tmp, true)
  blur1d(tmp, blurred, false)

  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = valid[i] ? src[i] + (blurred[i] - src[i]) * amount : NaN
  return out
}
