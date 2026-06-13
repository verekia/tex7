// tex7 config: a flat snapshot of every control, saved next to a texture so the
// full param set (clamp / simplify / shape / bands / surface / scene) can be
// restored later. Values are plain numbers and strings keyed by control id, so
// the format stays forward-compatible: unknown keys are ignored on load and
// missing keys keep their current value.

export const TEX7_CONFIG_VERSION = 1

export type Tex7Settings = Record<string, number | string>

export function buildConfigJson(settings: Tex7Settings): string {
  return `${JSON.stringify({ tex7: TEX7_CONFIG_VERSION, settings }, null, 2)}\n`
}

export function parseConfigJson(text: string): Tex7Settings {
  const data: unknown = JSON.parse(text)
  if (!data || typeof data !== 'object') throw new Error('Not a tex7 config file.')
  // Accept either the wrapped form ({ tex7, settings }) or a bare settings object.
  const raw = 'settings' in data ? (data as { settings: unknown }).settings : data
  if (!raw || typeof raw !== 'object') throw new Error('No settings found in config.')

  const out: Tex7Settings = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'string') out[key] = value
  }
  if (Object.keys(out).length === 0) throw new Error('Config has no recognizable settings.')
  return out
}

export function downloadConfig(filename: string, settings: Tex7Settings): void {
  const blob = new Blob([buildConfigJson(settings)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readConfigFile(file: File): Promise<Tex7Settings> {
  return file.text().then(parseConfigJson)
}

export function isConfigFile(file: File): boolean {
  return file.type === 'application/json' || /\.json$/i.test(file.name)
}
