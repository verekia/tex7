import { useEffect } from 'react'
import Head from 'next/head'

type SliderProps = {
  id: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  display: string
  title?: string
}

const Slider = ({ id, label, min, max, step, defaultValue, display, title }: SliderProps) => (
  <label title={title}>
    <span className="control-label">{label}</span>
    <input type="range" id={id} min={min} max={max} step={step} defaultValue={defaultValue} />
    <span className="control-value" id={`${id}-value`}>
      {display}
    </span>
  </label>
)

const DownloadArrow = () => (
  <svg className="dl-badge-arrow" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 2v9m0 0l-3.5-3.5M8 11l3.5-3.5M3 13h10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const MainView = () => {
  useEffect(() => {
    let cancelled = false
    void import('./main-init').then(m => {
      if (!cancelled) m.init()
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Head>
        <title>tex7 — Luminance texture tool</title>
      </Head>
      <div id="app">
        <h1>tex7 — Luminance texture tool</h1>
        <p className="intro">
          Drop a colored texture. tex7 extracts its luminance, lets you clean it up (clamp, simplify low-detail areas,
          shape the curve), and previews it on a sphere recolored from a <b>single base color</b> — the luminance drives
          both procedural darken/lighten of the albedo and a distance-stable bump.
        </p>

        <div id="drop-row">
          <div id="drop-zone-wrap">
            <h2>Texture</h2>
            <div id="drop-zone" className="drop-zone" tabIndex={0}>
              <p>Drop a texture here or click to select.</p>
              <p className="formats">PNG, JPG, WebP</p>
              <input type="file" id="file-input" className="file-input" accept="image/png,image/jpeg,image/webp" />
            </div>
          </div>
          <div id="original-wrap" className="hidden">
            <h2>Original</h2>
            <canvas id="canvas-original"></canvas>
          </div>
          <div id="luminance-wrap" className="hidden">
            <h2>Luminance</h2>
            <div className="canvas-wrap">
              <canvas id="canvas-luminance" className="checkerboard"></canvas>
              <button id="download-png" className="dl-badge" type="button" title="Download luminance as PNG">
                <span className="dl-badge-label">PNG</span>
                <DownloadArrow />
              </button>
            </div>
            <p id="status" className="status"></p>
          </div>
        </div>
        <div id="error-message" className="hidden"></div>

        <section id="section-luminance" className="hidden">
          <div className="control-group">
            <span className="control-group-title">Clamp</span>
            <Slider
              id="clamp-low"
              label="Dark clamp"
              min={0}
              max={25}
              step={0.1}
              defaultValue={0.1}
              display="0.1%"
              title="Clamp the darkest N% of pixels to black before normalizing, expanding the mid-range."
            />
            <Slider
              id="clamp-high"
              label="Light clamp"
              min={0}
              max={25}
              step={0.1}
              defaultValue={0.1}
              display="0.1%"
              title="Clamp the lightest N% of pixels to white before normalizing."
            />
            <label title="Flip the luminance map (useful when cavities should read as highlights).">
              <input type="checkbox" id="shape-invert" />
              <span>Invert</span>
            </label>
          </div>

          <div className="control-group">
            <span className="control-group-title">Simplify</span>
            <Slider
              id="simplify-strength"
              label="Strength"
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              display="off"
              title="Edge-preserving smoothing tolerance. Areas with low luminance variation (grain, noise) melt into smooth surfaces while strong edges keep their contrast."
            />
            <Slider
              id="simplify-radius"
              label="Radius"
              min={1}
              max={10}
              step={1}
              defaultValue={3}
              display="3 px"
              title="Spatial extent of the smoothing kernel, in pixels."
            />
            <Slider
              id="simplify-passes"
              label="Passes"
              min={1}
              max={10}
              step={1}
              defaultValue={3}
              display="3"
              title="Filter iterations. More passes flatten low-variation areas toward clean, uniform zones."
            />
          </div>

          <div className="control-group">
            <span className="control-group-title">Shape</span>
            <Slider
              id="shape-gamma"
              label="Gamma"
              min={0.2}
              max={4}
              step={0.05}
              defaultValue={1}
              display="1.00"
              title="Exponent on the luminance. >1 darkens midtones, <1 lightens them."
            />
            <Slider
              id="shape-contrast"
              label="Contrast"
              min={-1}
              max={1}
              step={0.02}
              defaultValue={0}
              display="0.00"
              title="Positive pushes values toward an S-curve, negative flattens toward mid-gray."
            />
            <Slider
              id="posterize-levels"
              label="Posterize"
              min={0}
              max={16}
              step={1}
              defaultValue={0}
              display="off"
              title="Quantize the luminance into N bands for a hand-painted look. 0 disables."
            />
            <Slider
              id="posterize-softness"
              label="Band softness"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.25}
              display="0.25"
              title="Width of the smooth transition between posterize bands. 0 = hard steps."
            />
          </div>
        </section>

        <section id="section-3d" className="hidden">
          <h2>3D preview</h2>
          <div className="control-group">
            <span className="control-group-title">Color</span>
            <label title="The single base color. The luminance procedurally darkens and lightens it.">
              <span className="control-label">Base color</span>
              <input type="color" id="picker-base" defaultValue="#8d7b64" />
            </label>
            <Slider
              id="ramp-darken"
              label="Darken"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.6}
              display="0.60"
              title="How much luminance below the pivot darkens the base color toward black."
            />
            <Slider
              id="ramp-lighten"
              label="Lighten"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.25}
              display="0.25"
              title="How much luminance above the pivot lightens the base color toward white."
            />
            <Slider
              id="ramp-pivot"
              label="Pivot"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.5}
              display="0.50"
              title="The luminance value that shows the base color unchanged. Below it darkens, above it lightens."
            />
            <Slider
              id="ramp-shadow-sat"
              label="Shadow sat."
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.3}
              display="0.30"
              title="Boosts saturation in the darkened areas — painterly shadows instead of muddy gray-black."
            />
            <Slider
              id="ramp-hue-shift"
              label="Hue shift"
              min={-90}
              max={90}
              step={1}
              defaultValue={0}
              display="0°"
              title="Rotates the hue across the ramp: shadows shift one way, highlights the other."
            />
          </div>

          <div className="control-group">
            <span className="control-group-title">Surface</span>
            <Slider
              id="tex-scale"
              label="Texture scale"
              min={0.25}
              max={10}
              step={0.05}
              defaultValue={2}
              display="2.0×"
              title="UV repeat of the luminance texture on the sphere."
            />
            <Slider
              id="bump-scale"
              label="Bump scale"
              min={0}
              max={0.08}
              step={0.001}
              defaultValue={0.015}
              display="0.015"
              title="Strength of the luminance-driven normal perturbation. 0 is a no-op."
            />
            <Slider
              id="bump-offset"
              label="Bump offset"
              min={0.0005}
              max={0.03}
              step={0.0005}
              defaultValue={0.003}
              display="0.0030"
              title="Half-width of the slope estimate in tile units: smaller hugs the luminance transitions tighter (sharper, can get noisy), larger spreads the shading band."
            />
            <div
              className="toggle-group"
              title="Fixed offset: central differences at a fixed texture offset in a screen-derivative cotangent frame (Mana Blade) — stable across camera distance. Screen derivative: three.js bumpMap() one-screen-pixel forward differences (×100 scale compensation) — watch it fade as you zoom."
            >
              <button id="btn-bump-fixed" className="toggle-btn active" type="button">
                Fixed offset
              </button>
              <button id="btn-bump-screen" className="toggle-btn" type="button">
                Screen derivative
              </button>
            </div>
          </div>

          <div className="control-group">
            <span className="control-group-title">Scene</span>
            <Slider
              id="light-intensity"
              label="Light"
              min={0}
              max={10}
              step={0.05}
              defaultValue={3}
              display="3.00"
              title="Directional light intensity."
            />
            <div className="toggle-group">
              <button id="btn-mat-standard" className="toggle-btn active" type="button">
                Standard
              </button>
              <button
                id="btn-mat-lambert"
                className="toggle-btn"
                type="button"
                title="Wrap-lighting Lambert matching Mana Blade's EnhancedLambertMaterial."
              >
                Wrap Lambert
              </button>
              <button
                id="btn-mat-unlit"
                className="toggle-btn"
                type="button"
                title="No lighting — judge the raw color ramp."
              >
                Unlit
              </button>
            </div>
          </div>

          <div id="preview-row">
            <div id="three-container"></div>
            <div>
              <h2>Tiled (3×3)</h2>
              <canvas id="canvas-tiled" className="checkerboard"></canvas>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
