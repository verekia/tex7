import { downloadConfig, isConfigFile, readConfigFile, type Tex7Settings } from './config'
import {
  buildGrayscaleImage,
  computeBaseMap,
  getPixelData,
  loadImage,
  shapeLuminance,
  type LoadedTexture,
  type ShapeOptions,
} from './process'
import { fixSeams, type SeamOptions } from './seams'
import { simplifyLuminance, type SimplifyOptions } from './simplify'
import {
  initThreeScene,
  notifyLuminanceUpdated,
  setBumpOffset,
  setBumpScale,
  setBumpStencil,
  setCrossfade,
  setDarkColor,
  setDarkPivot,
  setDirectionalIntensity,
  setLightColor,
  setLightPivot,
  setMaterialType,
  setMidColor,
  setTextureRepeat,
  type BumpStencil,
  type MaterialType,
} from './three-scene'
import { renderLuminanceHistogram } from './visualizer'

let initialized = false

const MAX_PREVIEW_SIZE = 256
const LUM_DISPLAY_SCALE = 2
const TILED_MAX = 540

const $ = (id: string) => document.getElementById(id)!

function rafThrottle(fn: () => void): () => void {
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      fn()
    })
  }
}

// Minimal, dependency-free syntax highlighter for the integration TSL snippet.
// Single left-to-right pass so tokens never nest; everything is HTML-escaped.
const TSL_TOKEN =
  /(\/\/[^\n]*)|('[^']*')|\b(import|from|const|new)\b|\b(Color|float|uniform|texture|mix|smoothstep|uv|vec2|positionView|normalView)\b|(\b\d+\.?\d*\b)/g

function highlightTsl(code: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  TSL_TOKEN.lastIndex = 0
  while ((m = TSL_TOKEN.exec(code)) !== null) {
    out += esc(code.slice(last, m.index))
    const cls = m[1] ? 'tok-c' : m[2] ? 'tok-s' : m[3] ? 'tok-k' : m[4] ? 'tok-f' : 'tok-n'
    out += `<span class="${cls}">${esc(m[0])}</span>`
    last = TSL_TOKEN.lastIndex
  }
  out += esc(code.slice(last))
  return out
}

type SliderDef = { id: string; format: (v: number) => string; apply: (v: number) => void }
type ColorDef = { id: string; apply: (hex: string) => void }
/** A set of radio inputs sharing `name` (also the config key); one value is selected. */
type RadioDef = { name: string; apply: (value: string) => void }
/** A single on/off toggle button (shows "On"/"Off"). `key` is the config key. */
type SwitchDef = { id: string; key: string; apply: (on: boolean) => void }

export function init() {
  if (initialized) return
  initialized = true

  const dropZoneWrap = $('drop-zone-wrap')
  const dropZone = $('drop-zone')
  const fileInput = $('file-input') as HTMLInputElement
  const errorMessage = $('error-message')
  const originalWrap = $('original-wrap')
  const canvasOriginal = $('canvas-original') as HTMLCanvasElement
  const canvasLuminance = $('canvas-luminance') as HTMLCanvasElement
  const canvasHistogram = $('canvas-histogram') as HTMLCanvasElement
  const canvasTiled = $('canvas-tiled') as HTMLCanvasElement
  const statusEl = $('status')
  const downloadPng = $('download-png') as HTMLButtonElement
  const sectionLuminance = $('section-luminance')
  const section3d = $('section-3d')
  const tiledSection = $('tiled-section')
  const integrationSection = $('section-integration')
  const integrationCode = $('integration-code').querySelector('code')!
  const threeContainer = $('three-container')

  let loaded: LoadedTexture | null = null
  let simplified: Float32Array | null = null
  let finalMap: Float32Array | null = null
  let simplifyMs = 0
  let simplifyToken = 0
  let dragCounter = 0
  let baseName = 'tex7'

  const simplifyOpts: SimplifyOptions = {
    enabled: false,
    strength: 1,
    radius: 4,
    passes: 3,
  }
  const seamOpts: SeamOptions = {
    enabled: false,
    range: 16,
    amount: 1,
  }
  const shapeOpts: ShapeOptions = {
    clampLow: 0.001,
    clampHigh: 0.001,
    gamma: 1,
    contrast: 0,
  }

  // --- Display helpers ---

  function getDisplayDimensions(w: number, h: number): [number, number] {
    if (w <= MAX_PREVIEW_SIZE) return [w, h]
    const scale = MAX_PREVIEW_SIZE / w
    return [MAX_PREVIEW_SIZE, Math.round(h * scale)]
  }

  function drawToDisplayCanvas(canvas: HTMLCanvasElement, img: HTMLImageElement, w: number, h: number) {
    const [dw, dh] = getDisplayDimensions(w, h)
    canvas.width = w
    canvas.height = h
    canvas.style.width = `${dw}px`
    canvas.style.height = `${dh}px`
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
  }

  // --- Errors ---

  function showError(msg: string) {
    errorMessage.textContent = msg
    errorMessage.classList.remove('hidden')
  }

  function clearError() {
    errorMessage.classList.add('hidden')
  }

  // --- Pipeline ---

  function updateStatus() {
    if (!loaded) return
    statusEl.textContent = `${loaded.width}×${loaded.height} · simplify ${simplifyMs} ms`
  }

  function drawTiled() {
    if (!loaded) return
    const [dw, dh] = getDisplayDimensions(loaded.width, loaded.height)
    canvasTiled.width = dw * 3
    canvasTiled.height = dh * 3
    // Display capped so it sits beside the sphere without inflating the sticky preview.
    const displayScale = Math.min(1, TILED_MAX / (dw * 3))
    canvasTiled.style.width = `${Math.round(dw * 3 * displayScale)}px`
    canvasTiled.style.height = `${Math.round(dh * 3 * displayScale)}px`
    const ctx = canvasTiled.getContext('2d')!
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        ctx.drawImage(canvasLuminance, x * dw, y * dh, dw, dh)
      }
    }
  }

  function renderHistogram() {
    if (!loaded || !finalMap) return
    const [dw] = getDisplayDimensions(loaded.width, loaded.height)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    // Match the (2×) luminance preview width so the histogram lines up under it.
    const cw = Math.max(180, dw * LUM_DISPLAY_SCALE)
    const ch = 80
    if (canvasHistogram.width !== Math.round(cw * dpr)) {
      canvasHistogram.width = Math.round(cw * dpr)
      canvasHistogram.height = Math.round(ch * dpr)
    }
    canvasHistogram.style.width = `${cw}px`
    canvasHistogram.style.height = `${ch}px`
    renderLuminanceHistogram(canvasHistogram, finalMap, loaded.opaqueIndices, {
      darkPivot: +($('band-dark-pivot') as HTMLInputElement).value,
      lightPivot: +($('band-light-pivot') as HTMLInputElement).value,
    })
  }

  function runShape() {
    if (!loaded || !simplified) return
    const final = shapeLuminance(simplified, loaded.opaqueIndices, shapeOpts)
    finalMap = final
    const imageData = buildGrayscaleImage(final, loaded.originalData, loaded.width, loaded.height)
    const [dw, dh] = getDisplayDimensions(loaded.width, loaded.height)
    canvasLuminance.width = loaded.width
    canvasLuminance.height = loaded.height
    // The shipped texture is the focus of stage 1 — show it at 2× the preview size.
    canvasLuminance.style.width = `${dw * LUM_DISPLAY_SCALE}px`
    canvasLuminance.style.height = `${dh * LUM_DISPLAY_SCALE}px`
    canvasLuminance.getContext('2d')!.putImageData(imageData, 0, 0)
    drawTiled()
    notifyLuminanceUpdated()
    renderHistogram()
  }
  const scheduleShape = rafThrottle(runShape)

  async function runSimplify() {
    if (!loaded) return
    const token = ++simplifyToken
    statusEl.textContent = 'Simplifying…'
    await new Promise(resolve => setTimeout(resolve, 0))
    if (token !== simplifyToken || !loaded) return
    const t0 = performance.now()
    let map = simplifyLuminance(loaded.baseMap, loaded.width, loaded.height, simplifyOpts)
    if (seamOpts.enabled) map = fixSeams(map, loaded.width, loaded.height, seamOpts)
    simplified = map
    simplifyMs = Math.round(performance.now() - t0)
    updateStatus()
    runShape()
  }
  const scheduleSimplify = rafThrottle(() => void runSimplify())

  // --- Integration guide: TSL that reproduces the preview from current settings ---

  function buildIntegrationCode(): string {
    const num = (id: string) => +($(id) as HTMLInputElement).value
    const hex = (id: string) => ($(id) as HTMLInputElement).value
    const repeat = num('tex-scale')
    const dark = hex('picker-dark')
    const mid = hex('picker-mid')
    const light = hex('picker-light')
    const dp = num('band-dark-pivot')
    const lp = num('band-light-pivot')
    const cf = num('band-crossfade')
    const bumpScale = num('bump-scale')
    const bumpOffset = num('bump-offset')
    const codeStencil = (document.querySelector('input[name="code-stencil"]:checked') as HTMLInputElement | null)?.value
    // The "Code" radio picks what to export: just the 8-tap stencil, just the 4-tap, or both wrapped
    // in a `highTextureQuality` boolean so the consumer can flip quality at runtime. Each branch only
    // emits the code for what it needs (8 or 4 alone never mentions the other).
    const bumpBlock =
      codeStencil === '8'
        ? `// Bump — 8-tap 3×3 Sobel slope in a Schüler screen-derivative cotangent frame
const e = float(${bumpOffset}), en = e.negate(), denom = e.mul(8), s = ${bumpScale}
const h = (du, dv) => texture(map, uvN.add(vec2(du, dv))).r
const dHdu = h(e, e).add(h(e, float(0)).mul(2)).add(h(e, en))
  .sub(h(en, e).add(h(en, float(0)).mul(2)).add(h(en, en))).div(denom).mul(s)
const dHdv = h(en, e).add(h(float(0), e).mul(2)).add(h(e, e))
  .sub(h(en, en).add(h(float(0), en).mul(2)).add(h(e, en))).div(denom).mul(s)`
        : codeStencil === '4'
          ? `// Bump — 4-tap diagonal slope in a Schüler screen-derivative cotangent frame
const e = float(${bumpOffset}), en = e.negate(), g = ${bumpScale} / (4 * ${bumpOffset})
const h = (du, dv) => texture(map, uvN.add(vec2(du, dv))).r
const dHdu = h(e, e).add(h(e, en)).sub(h(en, e)).sub(h(en, en)).mul(g)
const dHdv = h(en, e).add(h(e, e)).sub(h(en, en)).sub(h(e, en)).mul(g)`
          : `// Bump — Sobel slope in a Schüler screen-derivative cotangent frame.
// highTextureQuality is your runtime quality toggle: 8-tap when on, 4-tap when off. The ternary runs
// at graph-build time, so the unpicked stencil's taps never compile (the GPU only ever runs one).
const highTextureQuality = true
const e = float(${bumpOffset}), en = e.negate()
const h = (du, dv) => texture(map, uvN.add(vec2(du, dv))).r
const sobel8 = () => { // 8-tap 3×3 Sobel — smoothest
  const denom = e.mul(8), s = ${bumpScale}
  const dHdu = h(e, e).add(h(e, float(0)).mul(2)).add(h(e, en))
    .sub(h(en, e).add(h(en, float(0)).mul(2)).add(h(en, en))).div(denom).mul(s)
  const dHdv = h(en, e).add(h(float(0), e).mul(2)).add(h(e, e))
    .sub(h(en, en).add(h(float(0), en).mul(2)).add(h(e, en))).div(denom).mul(s)
  return [dHdu, dHdv]
}
const diag4 = () => { // 4-tap diagonal — half the texture reads
  const g = ${bumpScale} / (4 * ${bumpOffset})
  const dHdu = h(e, e).add(h(e, en)).sub(h(en, e)).sub(h(en, en)).mul(g)
  const dHdv = h(en, e).add(h(e, e)).sub(h(en, en)).sub(h(e, en)).mul(g)
  return [dHdu, dHdv]
}
const [dHdu, dHdv] = highTextureQuality ? sobel8() : diag4()`
    return `// tex7 → three.js TSL. Reproduces this sphere from one luminance channel.
// Sample the map raw — map.colorSpace = NoColorSpace (no sRGB decode).
import { Color } from 'three'
import { float, mix, normalView, positionView, smoothstep, texture, uniform, uv, vec2 } from 'three/tsl'

const uvN = uv().mul(${repeat}) // your tiling
const lum = texture(map, uvN).r

// Albedo — three-band recolor (dark / mid / light)
const dark = uniform(new Color('${dark}'))
const mid = uniform(new Color('${mid}'))
const light = uniform(new Color('${light}'))
const dp = float(${dp}), lp = float(${lp}), cf = float(${cf})
const toMid = smoothstep(dp.sub(cf), dp.add(cf), lum)
const toLight = smoothstep(lp.sub(cf), lp.add(cf), lum)
material.colorNode = mix(mix(dark, mid, toMid), light, toLight)

${bumpBlock}
const sx = positionView.dFdx(), sy = positionView.dFdy()
const u1 = uvN.dFdx(), u2 = uvN.dFdy()
const tU = sy.cross(normalView).mul(u1.x).add(normalView.cross(sx).mul(u2.x))
const tV = sy.cross(normalView).mul(u1.y).add(normalView.cross(sx).mul(u2.y))
const inv = tU.dot(tU).max(tV.dot(tV)).inverseSqrt()
material.normalNode = tU.mul(inv.mul(dHdu).negate()).add(tV.mul(inv.mul(dHdv).negate())).add(normalView).normalize()
`
  }

  function renderIntegration() {
    integrationCode.innerHTML = highlightTsl(buildIntegrationCode())
  }
  const scheduleIntegration = rafThrottle(renderIntegration)

  // --- Control registry (drives binding + config save/load) ---

  const sliders: SliderDef[] = [
    {
      id: 'clamp-low',
      format: v => `${v.toFixed(1)}%`,
      apply: v => {
        shapeOpts.clampLow = v / 100
        scheduleShape()
      },
    },
    {
      id: 'clamp-high',
      format: v => `${v.toFixed(1)}%`,
      apply: v => {
        shapeOpts.clampHigh = v / 100
        scheduleShape()
      },
    },
    {
      id: 'simplify-strength',
      format: v => (v === 0 ? 'off' : `${v}`),
      apply: v => {
        simplifyOpts.strength = v
        scheduleSimplify()
      },
    },
    {
      id: 'simplify-radius',
      format: v => `${v} px`,
      apply: v => {
        simplifyOpts.radius = v
        scheduleSimplify()
      },
    },
    {
      id: 'simplify-passes',
      format: v => `${v}`,
      apply: v => {
        simplifyOpts.passes = v
        scheduleSimplify()
      },
    },
    {
      id: 'seam-range',
      format: v => `${v} px`,
      apply: v => {
        seamOpts.range = v
        scheduleSimplify()
      },
    },
    {
      id: 'seam-amount',
      format: v => `${v}%`,
      apply: v => {
        seamOpts.amount = v / 100
        scheduleSimplify()
      },
    },
    {
      id: 'shape-gamma',
      format: v => v.toFixed(2),
      apply: v => {
        shapeOpts.gamma = v
        scheduleShape()
      },
    },
    {
      id: 'shape-contrast',
      format: v => v.toFixed(2),
      apply: v => {
        shapeOpts.contrast = v
        scheduleShape()
      },
    },
    {
      id: 'band-dark-pivot',
      format: v => v.toFixed(2),
      apply: v => {
        setDarkPivot(v)
        renderHistogram()
      },
    },
    {
      id: 'band-light-pivot',
      format: v => v.toFixed(2),
      apply: v => {
        setLightPivot(v)
        renderHistogram()
      },
    },
    { id: 'band-crossfade', format: v => v.toFixed(2), apply: setCrossfade },
    { id: 'tex-scale', format: v => `${v.toFixed(1)}×`, apply: setTextureRepeat },
    { id: 'bump-scale', format: v => v.toFixed(3), apply: setBumpScale },
    { id: 'bump-offset', format: v => v.toFixed(4), apply: setBumpOffset },
    { id: 'light-intensity', format: v => v.toFixed(2), apply: setDirectionalIntensity },
  ]

  const colors: ColorDef[] = [
    { id: 'picker-dark', apply: setDarkColor },
    { id: 'picker-mid', apply: setMidColor },
    { id: 'picker-light', apply: setLightColor },
  ]

  const radios: RadioDef[] = [
    {
      name: 'material',
      apply: value => setMaterialType(value as MaterialType),
    },
    {
      name: 'bump-stencil',
      apply: value => setBumpStencil(value as BumpStencil),
    },
    {
      // Doesn't touch the scene — only re-renders the exported TSL for the chosen stencil(s).
      name: 'code-stencil',
      apply: () => scheduleIntegration(),
    },
  ]

  const switches: SwitchDef[] = [
    {
      id: 'btn-simplify-toggle',
      key: 'simplify-enabled',
      apply: on => {
        simplifyOpts.enabled = on
        scheduleSimplify()
      },
    },
    {
      id: 'btn-seams-toggle',
      key: 'seams-enabled',
      apply: on => {
        seamOpts.enabled = on
        scheduleSimplify()
      },
    },
  ]

  const radioValue = (name: string) =>
    (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value ?? ''

  const setRadio = (name: string, value: string) => {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement | null
    if (el) el.checked = true
  }

  const switchOn = (s: SwitchDef) => $(s.id).getAttribute('aria-pressed') === 'true'

  const setSwitch = (s: SwitchDef, on: boolean) => {
    const btn = $(s.id)
    btn.setAttribute('aria-pressed', String(on))
    btn.textContent = on ? 'On' : 'Off'
  }

  // --- Config save / load ---

  function collectSettings(): Tex7Settings {
    const out: Tex7Settings = {}
    for (const s of sliders) out[s.id] = +($(s.id) as HTMLInputElement).value
    for (const c of colors) out[c.id] = ($(c.id) as HTMLInputElement).value
    for (const r of radios) out[r.name] = radioValue(r.name)
    for (const s of switches) out[s.key] = switchOn(s) ? 'on' : 'off'
    return out
  }

  function applySettings(settings: Tex7Settings) {
    for (const s of sliders) {
      const v = settings[s.id]
      if (typeof v !== 'number') continue
      const input = $(s.id) as HTMLInputElement
      input.value = String(v)
      const valueEl = $(`${s.id}-value`)
      if (valueEl) valueEl.textContent = s.format(v)
      s.apply(v)
    }
    for (const c of colors) {
      const v = settings[c.id]
      if (typeof v !== 'string') continue
      ;($(c.id) as HTMLInputElement).value = v
      c.apply(v)
    }
    for (const r of radios) {
      const v = settings[r.name]
      if (typeof v === 'string') {
        setRadio(r.name, v)
        r.apply(v)
      }
    }
    for (const s of switches) {
      const v = settings[s.key]
      if (typeof v === 'string') {
        const on = v === 'on'
        setSwitch(s, on)
        s.apply(on)
      }
    }
    // Each apply already scheduled work; force one clean recompute if a texture is loaded.
    if (loaded) void runSimplify()
    renderIntegration()
  }

  async function loadConfigFile(file: File) {
    try {
      const settings = await readConfigFile(file)
      applySettings(settings)
      clearError()
    } catch (err) {
      showError(`Could not load config: ${(err as Error).message}`)
    }
  }

  // --- Drop zone ---

  function updateDropZoneVisibility() {
    const dragging = dragCounter > 0
    const hasTexture = loaded != null
    // Once a texture is loaded the stages own the screen; the drop zone only
    // reappears while a file is being dragged in (drops are accepted anywhere).
    dropZoneWrap.classList.toggle('hidden', hasTexture && !dragging)
    // The original sits in the header as a static reference once loaded.
    originalWrap.classList.toggle('hidden', !hasTexture)
  }

  async function handleFiles(files: FileList | null | undefined) {
    if (!files || files.length === 0) return
    const arr = Array.from(files)
    const configFile = arr.find(isConfigFile)
    const imageFile = arr.find(f => f.type.startsWith('image/'))
    if (configFile) await loadConfigFile(configFile)
    if (imageFile) await handleFile(imageFile)
    else if (!configFile) showError('Unsupported file type. Please use PNG, JPG, WebP, or a .tex7.json config.')
  }

  window.addEventListener('dragenter', e => {
    if (!e.dataTransfer?.types.includes('Files')) return
    dragCounter++
    updateDropZoneVisibility()
  })

  window.addEventListener('dragleave', e => {
    if (!e.dataTransfer?.types.includes('Files')) return
    dragCounter = Math.max(0, dragCounter - 1)
    updateDropZoneVisibility()
  })

  window.addEventListener('dragover', e => {
    e.preventDefault()
  })

  // Accept a drop anywhere on the page — the drop zone can be scrolled out of view.
  window.addEventListener('drop', e => {
    e.preventDefault()
    dragCounter = 0
    dropZone.classList.remove('drag-over')
    updateDropZoneVisibility()
    void handleFiles(e.dataTransfer?.files)
  })

  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over')
  })

  fileInput.addEventListener('change', () => {
    void handleFiles(fileInput.files)
  })

  async function handleFile(file: File) {
    clearError()

    const validTypes = ['image/png', 'image/jpeg', 'image/webp']
    if (!validTypes.includes(file.type)) {
      showError('Unsupported file type. Please use PNG, JPG, or WebP.')
      return
    }

    try {
      const img = await loadImage(file)
      const { data, width, height } = getPixelData(img)

      drawToDisplayCanvas(canvasOriginal, img, width, height)

      const result = computeBaseMap(data, width, height)
      if (typeof result === 'string') {
        showError(result)
        return
      }

      loaded = result
      baseName = file.name.replace(/\.[^.]+$/, '') || 'tex7'
      await runSimplify()

      sectionLuminance.classList.remove('hidden')
      section3d.classList.remove('hidden')
      tiledSection.classList.remove('hidden')
      integrationSection.classList.remove('hidden')
      updateDropZoneVisibility()
      void initThreeScene(threeContainer, canvasLuminance)
    } catch (err) {
      showError(`Error processing image: ${(err as Error).message}`)
    }
  }

  // --- Download ---

  downloadPng.addEventListener('click', () => {
    if (!loaded) return
    canvasLuminance.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}-luminance.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  })

  // --- Wire controls ---

  for (const s of sliders) {
    const input = $(s.id) as HTMLInputElement
    const valueEl = $(`${s.id}-value`)
    input.addEventListener('input', () => {
      const v = +input.value
      if (valueEl) valueEl.textContent = s.format(v)
      s.apply(v)
      scheduleIntegration()
    })
  }

  for (const c of colors) {
    const input = $(c.id) as HTMLInputElement
    input.addEventListener('input', () => {
      c.apply(input.value)
      scheduleIntegration()
    })
  }

  for (const r of radios) {
    for (const el of document.querySelectorAll<HTMLInputElement>(`input[name="${r.name}"]`)) {
      el.addEventListener('change', () => {
        if (el.checked) r.apply(el.value)
      })
    }
  }

  for (const s of switches) {
    $(s.id).addEventListener('click', () => {
      const on = !switchOn(s)
      setSwitch(s, on)
      s.apply(on)
    })
  }

  $('btn-save-config').addEventListener('click', () => downloadConfig(`${baseName}.tex7.json`, collectSettings()))
  const configFileInput = $('config-file-input') as HTMLInputElement
  $('btn-load-config').addEventListener('click', () => configFileInput.click())
  configFileInput.addEventListener('change', () => {
    const file = configFileInput.files?.[0]
    if (file) void loadConfigFile(file)
    configFileInput.value = ''
  })

  const copyBtn = $('btn-copy-tsl')
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(buildIntegrationCode()).then(() => {
      copyBtn.textContent = 'Copied'
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1200)
    })
  })

  renderIntegration()
}
