import {
  applyGamma,
  applyLuminanceClamp,
  applySmoothing,
  buildGrayscaleImage,
  buildOpaqueGrayscaleImage,
  buildRecoloredImage,
  getPixelData,
  imageDataToCanvas,
  loadImage,
  processPixels,
  type ProcessedImage,
  type RecolorParams,
} from './process'
import {
  initThreeScene,
  notifyLuminanceChanged,
  setBaseColor,
  setBumpOffset,
  setBumpScale,
  setDarken,
  setLighten,
  setLightIntensity,
  setShadowHueShift,
  setTextureRepeat,
  setVolumeOffset,
  setVolumeScale,
} from './three-scene'

let initialized = false

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

function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

export function init() {
  if (initialized) return
  initialized = true

  const dropZoneWrap = document.getElementById('drop-zone-wrap')!
  const dropZone = document.getElementById('drop-zone')!
  const fileInput = document.getElementById('file-input') as HTMLInputElement
  const errorMessage = document.getElementById('error-message')!
  const originalWrap = document.getElementById('original-wrap')!
  const canvasOriginal = document.getElementById('canvas-original') as HTMLCanvasElement

  const sectionLuminance = document.getElementById('section-luminance')!
  const canvasLuminance = document.getElementById('canvas-luminance') as HTMLCanvasElement
  const clampLow = document.getElementById('clamp-low') as HTMLInputElement
  const clampHigh = document.getElementById('clamp-high') as HTMLInputElement
  const clampLowValue = document.getElementById('clamp-low-value')!
  const clampHighValue = document.getElementById('clamp-high-value')!
  const smoothRadius = document.getElementById('smooth-radius') as HTMLInputElement
  const smoothRadiusValue = document.getElementById('smooth-radius-value')!
  const smoothStrength = document.getElementById('smooth-strength') as HTMLInputElement
  const smoothStrengthValue = document.getElementById('smooth-strength-value')!
  const gammaInput = document.getElementById('gamma') as HTMLInputElement
  const gammaValue = document.getElementById('gamma-value')!

  const sectionColor = document.getElementById('section-color')!
  const pickerBase = document.getElementById('picker-base') as HTMLInputElement
  const darkenInput = document.getElementById('darken') as HTMLInputElement
  const darkenValue = document.getElementById('darken-value')!
  const lightenInput = document.getElementById('lighten') as HTMLInputElement
  const lightenValue = document.getElementById('lighten-value')!
  const hueShiftInput = document.getElementById('hue-shift') as HTMLInputElement
  const hueShiftValue = document.getElementById('hue-shift-value')!
  const canvasRecolored = document.getElementById('canvas-recolored') as HTMLCanvasElement
  const canvasTiled = document.getElementById('canvas-tiled') as HTMLCanvasElement

  const threeContainer = document.getElementById('three-container')!
  const texSize = document.getElementById('tex-size') as HTMLInputElement
  const texSizeValue = document.getElementById('tex-size-value')!
  const lightIntensity = document.getElementById('light-intensity') as HTMLInputElement
  const lightIntensityValue = document.getElementById('light-intensity-value')!
  const bumpOffset = document.getElementById('bump-offset') as HTMLInputElement
  const bumpOffsetValue = document.getElementById('bump-offset-value')!
  const bumpScale = document.getElementById('bump-scale') as HTMLInputElement
  const bumpScaleValue = document.getElementById('bump-scale-value')!
  const volumeOffset = document.getElementById('volume-offset') as HTMLInputElement
  const volumeOffsetValue = document.getElementById('volume-offset-value')!
  const volumeScale = document.getElementById('volume-scale') as HTMLInputElement
  const volumeScaleValue = document.getElementById('volume-scale-value')!

  const dlBadges = Array.from(document.querySelectorAll<HTMLButtonElement>('.dl-badge'))

  let currentResult: ProcessedImage | null = null
  let dragCounter = 0

  // Full-res sources: display canvases are CSS-scaled copies of these
  const lumSrcCanvas = document.createElement('canvas')
  const texCanvas = document.createElement('canvas')
  let recoloredSrcCanvas: HTMLCanvasElement | null = null

  function updateDropZoneVisibility() {
    const dragging = dragCounter > 0
    const hasTexture = currentResult != null
    dropZoneWrap.classList.toggle('hidden', hasTexture && !dragging)
    originalWrap.classList.toggle('hidden', !hasTexture || dragging)
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
    if (file) handleFile(file)
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) handleFile(file)
  })

  function showError(msg: string) {
    errorMessage.textContent = msg
    errorMessage.classList.remove('hidden')
    sectionLuminance.classList.add('hidden')
    sectionColor.classList.add('hidden')
  }

  function clearError() {
    errorMessage.classList.add('hidden')
  }

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
      sectionLuminance.classList.add('hidden')
      sectionColor.classList.add('hidden')

      const result = processPixels(data, width, height)

      if (typeof result === 'string') {
        showError(result)
        return
      }

      currentResult = result

      recomputeFromClamp()

      sectionLuminance.classList.remove('hidden')
      sectionColor.classList.remove('hidden')
      initThreeScene(threeContainer, texCanvas)
      updateDropZoneVisibility()
    } catch (err) {
      showError(`Error processing image: ${(err as Error).message}`)
    }
  }

  const MAX_PREVIEW_SIZE = 256

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

  function drawCanvasToDisplayCanvas(
    displayCanvas: HTMLCanvasElement,
    sourceCanvas: HTMLCanvasElement,
    w: number,
    h: number,
  ) {
    const [dw, dh] = getDisplayDimensions(w, h)
    displayCanvas.width = w
    displayCanvas.height = h
    displayCanvas.style.width = `${dw}px`
    displayCanvas.style.height = `${dh}px`
    const ctx = displayCanvas.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(sourceCanvas, 0, 0)
  }

  // --- Pipeline ---
  // clamp → smooth → gamma → grayscale outputs → recolor outputs.
  // Each stage caches its map on currentResult so cheaper stages can rerun alone.

  function recomputeFromClamp() {
    if (!currentResult) return
    applyLuminanceClamp(currentResult, +clampLow.value / 100, +clampHigh.value / 100)
    applySmoothing(currentResult, +smoothRadius.value, +smoothStrength.value / 100)
    recomputeFromGamma()
  }

  function recomputeFromGamma() {
    if (!currentResult) return
    applyGamma(currentResult, +gammaInput.value)
    renderLuminanceOutputs()
  }

  function renderLuminanceOutputs() {
    if (!currentResult) return
    const { width, height } = currentResult

    const grayscale = buildGrayscaleImage(currentResult)
    lumSrcCanvas.width = width
    lumSrcCanvas.height = height
    lumSrcCanvas.getContext('2d')!.putImageData(grayscale, 0, 0)
    drawCanvasToDisplayCanvas(canvasLuminance, lumSrcCanvas, width, height)

    const opaqueGrayscale = buildOpaqueGrayscaleImage(currentResult)
    texCanvas.width = width
    texCanvas.height = height
    texCanvas.getContext('2d')!.putImageData(opaqueGrayscale, 0, 0)
    notifyLuminanceChanged()

    renderRecolorOutputs()
  }

  function readRecolorParams(): RecolorParams {
    return {
      baseHex: pickerBase.value,
      darken: +darkenInput.value,
      lighten: +lightenInput.value,
      shadowHueShift: (+hueShiftInput.value * Math.PI) / 180,
    }
  }

  function renderRecolorOutputs() {
    if (!currentResult) return
    const { width, height } = currentResult

    const recolored = buildRecoloredImage(currentResult, readRecolorParams())
    recoloredSrcCanvas = imageDataToCanvas(recolored)
    drawCanvasToDisplayCanvas(canvasRecolored, recoloredSrcCanvas, width, height)

    const [displayW, displayH] = getDisplayDimensions(width, height)
    const tiles = 3
    canvasTiled.width = width * tiles
    canvasTiled.height = height * tiles
    canvasTiled.style.width = `${displayW * tiles}px`
    canvasTiled.style.height = `${displayH * tiles}px`
    const ctx = canvasTiled.getContext('2d')!
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        ctx.drawImage(recoloredSrcCanvas, x * width, y * height)
      }
    }
  }

  const scheduleFromClamp = rafThrottle(recomputeFromClamp)
  const scheduleFromGamma = rafThrottle(recomputeFromGamma)
  const scheduleRecolor = rafThrottle(renderRecolorOutputs)

  clampLow.addEventListener('input', () => {
    clampLowValue.textContent = `${(+clampLow.value).toFixed(1)}%`
    scheduleFromClamp()
  })
  clampHigh.addEventListener('input', () => {
    clampHighValue.textContent = `${(+clampHigh.value).toFixed(1)}%`
    scheduleFromClamp()
  })
  smoothRadius.addEventListener('input', () => {
    smoothRadiusValue.textContent = `${smoothRadius.value}px`
    scheduleFromClamp()
  })
  smoothStrength.addEventListener('input', () => {
    smoothStrengthValue.textContent = smoothStrength.value
    scheduleFromClamp()
  })
  gammaInput.addEventListener('input', () => {
    gammaValue.textContent = (+gammaInput.value).toFixed(2)
    scheduleFromGamma()
  })

  pickerBase.addEventListener('input', () => {
    setBaseColor(pickerBase.value)
    scheduleRecolor()
  })
  darkenInput.addEventListener('input', () => {
    darkenValue.textContent = (+darkenInput.value).toFixed(2)
    setDarken(+darkenInput.value)
    scheduleRecolor()
  })
  lightenInput.addEventListener('input', () => {
    lightenValue.textContent = (+lightenInput.value).toFixed(2)
    setLighten(+lightenInput.value)
    scheduleRecolor()
  })
  hueShiftInput.addEventListener('input', () => {
    hueShiftValue.textContent = `${hueShiftInput.value}°`
    setShadowHueShift((+hueShiftInput.value * Math.PI) / 180)
    scheduleRecolor()
  })

  texSize.addEventListener('input', () => {
    texSizeValue.textContent = `${(+texSize.value).toFixed(1)}×`
    setTextureRepeat(+texSize.value)
  })
  lightIntensity.addEventListener('input', () => {
    lightIntensityValue.textContent = (+lightIntensity.value).toFixed(2)
    setLightIntensity(+lightIntensity.value)
  })
  bumpOffset.addEventListener('input', () => {
    bumpOffsetValue.textContent = (+bumpOffset.value).toFixed(4)
    setBumpOffset(+bumpOffset.value)
  })
  bumpScale.addEventListener('input', () => {
    bumpScaleValue.textContent = (+bumpScale.value).toFixed(3)
    setBumpScale(+bumpScale.value)
  })
  volumeOffset.addEventListener('input', () => {
    volumeOffsetValue.textContent = (+volumeOffset.value).toFixed(3)
    setVolumeOffset(+volumeOffset.value)
  })
  volumeScale.addEventListener('input', () => {
    volumeScaleValue.textContent = (+volumeScale.value).toFixed(3)
    setVolumeScale(+volumeScale.value)
  })

  for (const badge of dlBadges) {
    badge.addEventListener('click', e => {
      e.preventDefault()
      const target = badge.dataset.target
      if (target === 'luminance' && currentResult) downloadCanvasPng(lumSrcCanvas, 'luminance.png')
      if (target === 'recolored' && recoloredSrcCanvas) downloadCanvasPng(recoloredSrcCanvas, 'recolored.png')
    })
  }
}
