// Tile-seam repair — make the simplified luminance wrap seamlessly (toroidally).
//
// A non-tileable source (or guided-filter residue at the borders) leaves the left
// edge not matching the right, and the top not matching the bottom. On the shipped
// heightfield that shows up twice: a brightness step in the recolor bands, and —
// worse — a cliff the bump's Sobel slope reads as a hard lit/dark line at the seam.
//
// Fix: range-limited gradient-domain (DC) correction. Per row the wrap mismatch
// j = L(0) - L(W-1) is split in half and spread back into each edge with a smooth
// falloff over that axis's range (smoothstep, flat at both ends so the corrected band
// merges into the untouched interior with no new crease). Each side moves half the
// gap so they meet in the middle — minimal, symmetric distortion. Then the same
// over top/bottom. With amount = 1 the passes are separable-exact: fixing columns
// leaves the two edge columns equal, so the row pass keeps them equal — all four
// edges end pairwise continuous, corners included.
//
// Why not warp the edges to align shapes? Displacement can't close a *tonal* gap
// (a 0.8 edge meeting a 0.3 edge stays a cliff however far you slide it), and the
// cliff is exactly what wrecks the bump. Value continuity is the necessary fix;
// this does it directly, cheaply, with a range knob that tracks feature size.

export interface SeamOptions {
  /** Master on/off — when false the input passes through untouched. */
  enabled: boolean
  /** X (left ↔ right) falloff distance in px the correction reaches inward. */
  rangeX: number
  /** X (left ↔ right) 0..1 fraction of the edge mismatch to close (1 = exact). */
  amountX: number
  /** Y (top ↔ bottom) falloff distance in px the correction reaches inward. */
  rangeY: number
  /** Y (top ↔ bottom) 0..1 fraction of the edge mismatch to close (1 = exact). */
  amountY: number
}

export function fixSeams(src: Float32Array, width: number, height: number, opts: SeamOptions): Float32Array {
  const { enabled, rangeX, amountX, rangeY, amountY } = opts
  const out = src.slice()
  if (!enabled) return out

  if (amountX > 0 && rangeX >= 1) fixHorizontalSeam(out, width, height, Math.max(1, Math.round(rangeX)), amountX)
  if (amountY > 0 && rangeY >= 1) fixVerticalSeam(out, width, height, Math.max(1, Math.round(rangeY)), amountY)
  return out
}

/** Smoothstep complement: 1 at the seam, 0 at the band edge, flat slope at both ends. */
function falloff(u: number): number {
  const s = u * u * (3 - 2 * u)
  return 1 - s
}

/** Add a delta to a pixel, leaving transparent (NaN) pixels untouched. */
function addAt(buf: Float32Array, i: number, delta: number): void {
  const v = buf[i]
  if (!Number.isNaN(v)) buf[i] = v + delta
}

/** Blend the left edge column into the right one, per row. */
function fixHorizontalSeam(buf: Float32Array, w: number, h: number, range: number, amount: number): void {
  const rr = Math.min(range, Math.floor((w - 1) / 2))
  if (rr < 1) return
  const disjoint = w - 1 - rr > rr

  for (let y = 0; y < h; y++) {
    const row = y * w
    const left = buf[row]
    const right = buf[row + w - 1]
    if (Number.isNaN(left) || Number.isNaN(right)) continue
    const half = 0.5 * amount * (left - right)
    if (half === 0) continue

    if (disjoint) {
      // Bands don't meet: lower the left side, raise the right, each over its own range.
      for (let x = 0; x <= rr; x++) {
        const wgt = half * falloff(x / rr)
        addAt(buf, row + x, -wgt)
        addAt(buf, row + (w - 1 - x), wgt)
      }
    } else {
      // Bands overlap: combine both sides per column so each pixel is corrected once.
      for (let x = 0; x < w; x++) {
        const dl = x <= rr ? falloff(x / rr) : 0
        const dr = w - 1 - x <= rr ? falloff((w - 1 - x) / rr) : 0
        addAt(buf, row + x, half * (dr - dl))
      }
    }
  }
}

/** Blend the top edge row into the bottom one, per column. */
function fixVerticalSeam(buf: Float32Array, w: number, h: number, range: number, amount: number): void {
  const rr = Math.min(range, Math.floor((h - 1) / 2))
  if (rr < 1) return
  const disjoint = h - 1 - rr > rr

  for (let x = 0; x < w; x++) {
    const top = buf[x]
    const bottom = buf[(h - 1) * w + x]
    if (Number.isNaN(top) || Number.isNaN(bottom)) continue
    const half = 0.5 * amount * (top - bottom)
    if (half === 0) continue

    if (disjoint) {
      for (let y = 0; y <= rr; y++) {
        const wgt = half * falloff(y / rr)
        addAt(buf, y * w + x, -wgt)
        addAt(buf, (h - 1 - y) * w + x, wgt)
      }
    } else {
      for (let y = 0; y < h; y++) {
        const dt = y <= rr ? falloff(y / rr) : 0
        const db = h - 1 - y <= rr ? falloff((h - 1 - y) / rr) : 0
        addAt(buf, y * w + x, half * (db - dt))
      }
    }
  }
}
