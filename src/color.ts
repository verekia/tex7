// Color utilities: sRGB <-> linear, hex parsing, hue rotation around the gray axis

/** Convert a single sRGB channel [0,255] to linear RGB [0,1] */
export function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** Convert a single linear RGB channel [0,1] to sRGB [0,255] */
export function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(255, s * 255)))
}

/** Parse a hex color string (#RRGGBB) to [r, g, b] in [0,255] */
export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return [0, 0, 0]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

const GRAY_AXIS = 0.5773502691896258

/**
 * Rotate a linear RGB color around the gray axis (1,1,1)/sqrt(3) by `angle` radians.
 * Matches the Rodrigues rotation used by the TSL hue node in the 3D preview.
 */
export function hueRotateLinear(r: number, g: number, b: number, angle: number): [number, number, number] {
  const k = GRAY_AXIS
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const oneMinus = 1 - cosA
  const dot = k * (r + g + b)
  return [
    r * cosA + k * (b - g) * sinA + k * dot * oneMinus,
    g * cosA + k * (r - b) * sinA + k * dot * oneMinus,
    b * cosA + k * (g - r) * sinA + k * dot * oneMinus,
  ]
}
