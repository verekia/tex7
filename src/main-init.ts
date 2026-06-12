import {
  buildGrayscaleImage,
  computeBaseMap,
  getPixelData,
  loadImage,
  shapeLuminance,
  type LoadedTexture,
  type ShapeOptions,
} from './process'
import { simplifyLuminance, type SimplifyOptions } from './simplify'
import {
  initThreeScene,
  notifyLuminanceUpdated,
  setBaseColor,
  setBumpMode,
  setBumpOffset,
  setBumpScale,
  setDarken,
  setDirectionalIntensity,
  setHueShiftDegrees,
  setLighten,
  setMaterialType,
  setPivot,
  setShadowSaturation,
  setTextureRepeat,
} from './three-scene'

let initialized = false

const MAX_PREVIEW_SIZE = 256

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

export function init() {
  if (initialized) return
  initialized = true

  const dropZoneWrap = $('drop-zone-wrap')
  const dropZone = $('drop-zone')
  const fileInput = $('file-input') as HTMLInputElement
  const errorMessage = $('error-message')
  const originalWrap = $('original-wrap')
  const canvasOriginal = $('canvas-original') as HTMLCanvasElement
  const luminanceWrap = $('luminance-wrap')
  const canvasLuminance = $('canvas-luminance') as HTMLCanvasElement
  const canvasTiled = $('canvas-tiled') as HTMLCanvasElement
  const statusEl = $('status')
  const downloadPng = $('download-png') as HTMLButtonElement
  const sectionLuminance = $('section-luminance')
  const section3d = $('section-3d')
  const threeContainer = $('three-container')
  const invertCheckbox = $('shape-invert') as HTMLInputElement

  let loaded: LoadedTexture | null = null
  let simplified: Float32Array | null = null
  let simplifyMs = 0
  let simplifyToken = 0
  let dragCounter = 0

  const simplifyOpts: SimplifyOptions = { strength: 0, radius: 3, passes: 3 }
  const shapeOpts: ShapeOptions = {
    clampLow: 0.001,
    clampHigh: 0.001,
    invert: false,
    gamma: 1,
    contrast: 0,
    posterizeLevels: 0,
    posterizeSoftness: 0.25,
  }

  const bindSlider = (id: string, format: (v: number) => string, onInput: (v: number) => void) => {
    const input = $(id) as HTMLInputElement
    const valueEl = $(`${id}-value`)
    input.addEventListener('input', () => {
      const v = +input.value
      valueEl.textContent = format(v)
      onInput(v)
    })
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

  // --- Drop zone ---

  function updateDropZoneVisibility() {
    const dragging = dragCounter > 0
    const hasTexture = loaded != null
    dropZoneWrap.classList.toggle('hidden', hasTexture && !dragging)
    originalWrap.classList.toggle('hidden', !hasTexture || dragging)
    luminanceWrap.classList.toggle('hidden', !hasTexture || dragging)
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

  window.addEventListener('drop', e => {
    e.preventDefault()
    dragCounter = 0
    updateDropZoneVisibility()
  })

  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over')
  })

  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files[0]
    if (file) void handleFile(file)
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void handleFile(file)
  })

  // --- Errors ---

  function showError(msg: string) {
    errorMessage.textContent = msg
    errorMessage.classList.remove('hidden')
    sectionLuminance.classList.add('hidden')
    section3d.classList.add('hidden')
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
    canvasTiled.style.width = `${dw * 3}px`
    canvasTiled.style.height = `${dh * 3}px`
    const ctx = canvasTiled.getContext('2d')!
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        ctx.drawImage(canvasLuminance, x * dw, y * dh, dw, dh)
      }
    }
  }

  function runShape() {
    if (!loaded || !simplified) return
    const final = shapeLuminance(simplified, loaded.opaqueIndices, shapeOpts)
    const imageData = buildGrayscaleImage(final, loaded.originalData, loaded.width, loaded.height)
    const [dw, dh] = getDisplayDimensions(loaded.width, loaded.height)
    canvasLuminance.width = loaded.width
    canvasLuminance.height = loaded.height
    canvasLuminance.style.width = `${dw}px`
    canvasLuminance.style.height = `${dh}px`
    canvasLuminance.getContext('2d')!.putImageData(imageData, 0, 0)
    drawTiled()
    notifyLuminanceUpdated()
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
      await runSimplify()

      sectionLuminance.classList.remove('hidden')
      section3d.classList.remove('hidden')
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
      a.download = 'luminance.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  })

  // --- Luminance controls ---

  bindSlider(
    'clamp-low',
    v => `${v.toFixed(1)}%`,
    v => {
      shapeOpts.clampLow = v / 100
      scheduleShape()
    },
  )
  bindSlider(
    'clamp-high',
    v => `${v.toFixed(1)}%`,
    v => {
      shapeOpts.clampHigh = v / 100
      scheduleShape()
    },
  )
  invertCheckbox.addEventListener('change', () => {
    shapeOpts.invert = invertCheckbox.checked
    scheduleShape()
  })

  bindSlider(
    'simplify-strength',
    v => (v === 0 ? 'off' : `${v}`),
    v => {
      simplifyOpts.strength = v
      scheduleSimplify()
    },
  )
  bindSlider(
    'simplify-radius',
    v => `${v} px`,
    v => {
      simplifyOpts.radius = v
      scheduleSimplify()
    },
  )
  bindSlider(
    'simplify-passes',
    v => `${v}`,
    v => {
      simplifyOpts.passes = v
      scheduleSimplify()
    },
  )

  bindSlider(
    'shape-gamma',
    v => v.toFixed(2),
    v => {
      shapeOpts.gamma = v
      scheduleShape()
    },
  )
  bindSlider(
    'shape-contrast',
    v => v.toFixed(2),
    v => {
      shapeOpts.contrast = v
      scheduleShape()
    },
  )
  bindSlider(
    'posterize-levels',
    v => (v < 2 ? 'off' : `${v}`),
    v => {
      shapeOpts.posterizeLevels = v < 2 ? 0 : v
      scheduleShape()
    },
  )
  bindSlider(
    'posterize-softness',
    v => v.toFixed(2),
    v => {
      shapeOpts.posterizeSoftness = v
      scheduleShape()
    },
  )

  // --- 3D controls ---

  const pickerBase = $('picker-base') as HTMLInputElement
  pickerBase.addEventListener('input', () => setBaseColor(pickerBase.value))

  bindSlider('ramp-darken', v => v.toFixed(2), setDarken)
  bindSlider('ramp-lighten', v => v.toFixed(2), setLighten)
  bindSlider('ramp-pivot', v => v.toFixed(2), setPivot)
  bindSlider('ramp-shadow-sat', v => v.toFixed(2), setShadowSaturation)
  bindSlider('ramp-hue-shift', v => `${v}°`, setHueShiftDegrees)
  bindSlider('tex-scale', v => `${v.toFixed(1)}×`, setTextureRepeat)
  bindSlider('bump-scale', v => v.toFixed(3), setBumpScale)
  bindSlider('bump-offset', v => v.toFixed(4), setBumpOffset)
  bindSlider('light-intensity', v => v.toFixed(2), setDirectionalIntensity)

  const btnBumpFixed = $('btn-bump-fixed')
  const btnBumpScreen = $('btn-bump-screen')
  btnBumpFixed.addEventListener('click', () => {
    btnBumpFixed.classList.add('active')
    btnBumpScreen.classList.remove('active')
    setBumpMode('fixed')
  })
  btnBumpScreen.addEventListener('click', () => {
    btnBumpScreen.classList.add('active')
    btnBumpFixed.classList.remove('active')
    setBumpMode('screen')
  })

  const matButtons = [
    ['btn-mat-standard', 'standard'],
    ['btn-mat-lambert', 'lambert'],
    ['btn-mat-unlit', 'unlit'],
  ] as const
  for (const [id, type] of matButtons) {
    $(id).addEventListener('click', () => {
      for (const [otherId] of matButtons) $(otherId).classList.toggle('active', otherId === id)
      setMaterialType(type)
    })
  }
}
