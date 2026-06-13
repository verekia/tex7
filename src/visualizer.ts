// Luminance visualizer: a histogram of the final output luminance, drawn so the
// artist can place the dark/light trims and the band pivots where they condense
// the most information.
//
// - The bulk of the bars shows where luminance mass actually sits.
// - The leftmost and rightmost bars (pure black / pure white) are the luminance
//   being trimmed away by the dark/light clamp — highlighted so over-trimming is
//   obvious at a glance.
// - The three faint background regions and the two pivot lines show where the
//   dark / mid / light bands fall relative to that distribution.

export interface HistogramMarkers {
  darkPivot: number
  lightPivot: number
}

const BINS = 256

const DARK_ACCENT = '#5b9bd5'
const LIGHT_ACCENT = '#e0a836'
const BAR_COLOR = '#9aa2b1'

export function renderLuminanceHistogram(
  canvas: HTMLCanvasElement,
  map: Float32Array,
  opaqueIndices: Int32Array,
  { darkPivot, lightPivot }: HistogramMarkers,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height

  const counts = new Float64Array(BINS)
  for (let i = 0; i < opaqueIndices.length; i++) {
    const v = map[opaqueIndices[i]]
    if (Number.isNaN(v)) continue
    let bin = (v * (BINS - 1) + 0.5) | 0
    if (bin < 0) bin = 0
    else if (bin >= BINS) bin = BINS - 1
    counts[bin]++
  }

  let max = 0
  for (let i = 0; i < BINS; i++) if (counts[i] > max) max = counts[i]

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#15171c'
  ctx.fillRect(0, 0, w, h)

  // Faint band regions split at the pivots.
  const dpX = Math.round(darkPivot * w)
  const lpX = Math.round(lightPivot * w)
  ctx.fillStyle = 'rgba(91,155,213,0.10)'
  ctx.fillRect(0, 0, dpX, h)
  ctx.fillStyle = 'rgba(150,150,150,0.07)'
  ctx.fillRect(dpX, 0, Math.max(0, lpX - dpX), h)
  ctx.fillStyle = 'rgba(224,168,54,0.10)'
  ctx.fillRect(lpX, 0, w - lpX, h)

  if (max <= 0) return

  // sqrt scale so the trimmed tails stay visible next to tall peaks.
  const barW = w / BINS
  for (let i = 0; i < BINS; i++) {
    if (counts[i] <= 0) continue
    const barH = Math.sqrt(counts[i] / max) * (h - 2)
    ctx.fillStyle = i === 0 ? DARK_ACCENT : i === BINS - 1 ? LIGHT_ACCENT : BAR_COLOR
    ctx.fillRect(i * barW, h - barH, Math.max(1, barW), barH)
  }

  // Pivot lines.
  const line = (x: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, h)
    ctx.stroke()
  }
  line(dpX, DARK_ACCENT)
  line(lpX, LIGHT_ACCENT)
}
