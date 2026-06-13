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
import { simplifyLuminance, type SimplifyMethod, type SimplifyOptions } from './simplify'
import {
  initThreeScene,
  notifyLuminanceUpdated,
  setBumpMode,
  setBumpOffset,
  setBumpScale,
  setCrossfade,
  setDarkColor,
  setDarkPivot,
  setDirectionalIntensity,
  setLightColor,
  setLightPivot,
  setMaterialType,
  setMidColor,
  setScreenStrength,
  setTextureRepeat,
  setVolumeOffset,
  setVolumeScale,
  type BumpMode,
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

type SliderDef = { id: string; format: (v: number) => string; apply: (v: number) => void }
type ColorDef = { id: string; apply: (hex: string) => void }
type ToggleDef = { key: string; buttons: { id: string; value: string }[]; apply: (value: string) => void }

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
  const threeContainer = $('three-container')

  let loaded: LoadedTexture | null = null
  let simplified: Float32Array | null = null
  let finalMap: Float32Array | null = null
  let simplifyMs = 0
  let simplifyToken = 0
  let dragCounter = 0
  let baseName = 'tex7'

  const simplifyOpts: SimplifyOptions = { method: 'guided', strength: 0, radius: 4, passes: 3, antiAlias: 0.3 }
  const shapeOpts: ShapeOptions = {
    clampLow: 0.001,
    clampHigh: 0.001,
    gamma: 1,
    contrast: 0,
    posterizeLevels: 0,
    posterizeSoftness: 0.25,
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
    statusEl.textContent = `${loaded.width}×${loaded.height} · ${simplifyOpts.method} simplify ${simplifyMs} ms`
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
    simplified = simplifyLuminance(loaded.baseMap, loaded.width, loaded.height, simplifyOpts)
    simplifyMs = Math.round(performance.now() - t0)
    updateStatus()
    runShape()
  }
  const scheduleSimplify = rafThrottle(() => void runSimplify())

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
      id: 'simplify-antialias',
      format: v => v.toFixed(2),
      apply: v => {
        simplifyOpts.antiAlias = v
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
      id: 'posterize-levels',
      format: v => (v < 2 ? 'off' : `${v}`),
      apply: v => {
        shapeOpts.posterizeLevels = v < 2 ? 0 : v
        scheduleShape()
      },
    },
    {
      id: 'posterize-softness',
      format: v => v.toFixed(2),
      apply: v => {
        shapeOpts.posterizeSoftness = v
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
    { id: 'volume-scale', format: v => v.toFixed(3), apply: setVolumeScale },
    { id: 'volume-offset', format: v => v.toFixed(4), apply: setVolumeOffset },
    { id: 'screen-strength', format: v => v.toFixed(1), apply: setScreenStrength },
    { id: 'light-intensity', format: v => v.toFixed(2), apply: setDirectionalIntensity },
  ]

  const colors: ColorDef[] = [
    { id: 'picker-dark', apply: setDarkColor },
    { id: 'picker-mid', apply: setMidColor },
    { id: 'picker-light', apply: setLightColor },
  ]

  function updateBumpModeVisibility(mode: string) {
    $('bump-offset-controls').classList.toggle('hidden', mode !== 'offset')
    $('bump-screen-controls').classList.toggle('hidden', mode !== 'screen')
  }

  const toggles: ToggleDef[] = [
    {
      key: 'simplify-method',
      buttons: [
        { id: 'btn-simplify-bilateral', value: 'bilateral' },
        { id: 'btn-simplify-guided', value: 'guided' },
      ],
      apply: value => {
        simplifyOpts.method = value as SimplifyMethod
        scheduleSimplify()
      },
    },
    {
      key: 'bump-mode',
      buttons: [
        { id: 'btn-bump-offset', value: 'offset' },
        { id: 'btn-bump-screen', value: 'screen' },
      ],
      apply: value => {
        setBumpMode(value as BumpMode)
        updateBumpModeVisibility(value)
      },
    },
    {
      key: 'material',
      buttons: [
        { id: 'btn-mat-standard', value: 'standard' },
        { id: 'btn-mat-lambert', value: 'lambert' },
        { id: 'btn-mat-unlit', value: 'unlit' },
      ],
      apply: value => setMaterialType(value as MaterialType),
    },
  ]

  function activateToggle(t: ToggleDef, value: string) {
    for (const b of t.buttons) $(b.id).classList.toggle('active', b.value === value)
    t.apply(value)
  }

  function activeToggleValue(t: ToggleDef): string {
    for (const b of t.buttons) if ($(b.id).classList.contains('active')) return b.value
    return t.buttons[0].value
  }

  // --- Config save / load ---

  function collectSettings(): Tex7Settings {
    const out: Tex7Settings = {}
    for (const s of sliders) out[s.id] = +($(s.id) as HTMLInputElement).value
    for (const c of colors) out[c.id] = ($(c.id) as HTMLInputElement).value
    for (const t of toggles) out[t.key] = activeToggleValue(t)
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
    for (const t of toggles) {
      const v = settings[t.key]
      if (typeof v === 'string') activateToggle(t, v)
    }
    // Each apply already scheduled work; force one clean recompute if a texture is loaded.
    if (loaded) void runSimplify()
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
    })
  }

  for (const c of colors) {
    const input = $(c.id) as HTMLInputElement
    input.addEventListener('input', () => c.apply(input.value))
  }

  for (const t of toggles) {
    for (const b of t.buttons) {
      $(b.id).addEventListener('click', () => activateToggle(t, b.value))
    }
  }

  $('btn-save-config').addEventListener('click', () => downloadConfig(`${baseName}.tex7.json`, collectSettings()))
  const configFileInput = $('config-file-input') as HTMLInputElement
  $('btn-load-config').addEventListener('click', () => configFileInput.click())
  configFileInput.addEventListener('change', () => {
    const file = configFileInput.files?.[0]
    if (file) void loadConfigFile(file)
    configFileInput.value = ''
  })
}
