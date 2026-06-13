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

type ColorProps = { id: string; label: string; defaultValue: string; title?: string }

const ColorPicker = ({ id, label, defaultValue, title }: ColorProps) => (
  <label title={title} className="color-control">
    <span className="control-label">{label}</span>
    <input type="color" id={id} defaultValue={defaultValue} />
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
          shape the curve), and previews it on a sphere recolored into <b>three hand-authored bands</b> — dark, mid, and
          light — with a distance-stable bump. Save your settings as a <code>.tex7.json</code> to restore them later.
        </p>

        <div id="drop-row">
          <div id="drop-zone-wrap">
            <h2>Texture</h2>
            <div id="drop-zone" className="drop-zone" tabIndex={0}>
              <p>Drop a texture here or click to select.</p>
              <p className="formats">PNG, JPG, WebP — or a .tex7.json config</p>
              <input type="file" id="file-input" className="file-input" accept="image/png,image/jpeg,image/webp" />
            </div>
          </div>
          <div id="original-wrap" className="hidden">
            <h2>Original</h2>
            <canvas id="canvas-original"></canvas>
          </div>
          <div id="luminance-wrap" className="hidden">
            <div className="panel-head">
              <h2>Luminance</h2>
              <div className="config-bar">
                <button
                  id="btn-save-config"
                  className="text-btn"
                  type="button"
                  title="Save all settings as a .tex7.json"
                >
                  Save config
                </button>
                <button id="btn-load-config" className="text-btn" type="button" title="Load a .tex7.json config">
                  Load config
                </button>
                <input type="file" id="config-file-input" className="offscreen-input" accept="application/json,.json" />
              </div>
            </div>
            <div className="canvas-wrap">
              <canvas id="canvas-luminance" className="checkerboard"></canvas>
              <button id="download-png" className="dl-badge" type="button" title="Download luminance as PNG">
                <span className="dl-badge-label">PNG</span>
                <DownloadArrow />
              </button>
            </div>
            <div
              id="histogram-wrap"
              title="Luminance distribution. End bars are pixels trimmed to black/white by the clamps; the two lines are the dark and light band pivots."
            >
              <span className="histogram-caption">Luminance · trim &amp; bands</span>
              <canvas id="canvas-histogram"></canvas>
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
          </div>

          <div className="control-group">
            <span className="control-group-title">Simplify</span>
            <div
              className="toggle-group"
              title="Bilateral: powerful edge-preserving smoothing. Guided (He et al.): smooth by construction, far less aliasing."
            >
              <button id="btn-simplify-bilateral" className="toggle-btn active" type="button">
                Bilateral
              </button>
              <button id="btn-simplify-guided" className="toggle-btn" type="button">
                Guided
              </button>
            </div>
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
              max={16}
              step={1}
              defaultValue={4}
              display="4 px"
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
            <Slider
              id="simplify-antialias"
              label="Anti-alias"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.3}
              display="0.30"
              title="Rounds the residual stair-stepped seams left by simplification (a light NaN-aware blur of only the hard edges). 0 = off."
            />
          </div>

          <div className="control-group">
            <span className="control-group-title">Shape</span>
            <Slider
              id="shape-gamma"
              label="Gamma"
              min={0.2}
              max={2}
              step={0.05}
              defaultValue={1}
              display="1.00"
              title="Exponent on the luminance. >1 darkens midtones, <1 lightens them."
            />
            <Slider
              id="shape-contrast"
              label="Contrast"
              min={-0.5}
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
            <span className="control-group-title">Bands</span>
            <ColorPicker
              id="picker-dark"
              label="Dark"
              defaultValue="#000000"
              title="Color for luminance below the dark pivot."
            />
            <ColorPicker
              id="picker-mid"
              label="Mid"
              defaultValue="#808080"
              title="Color for luminance between the two pivots."
            />
            <ColorPicker
              id="picker-light"
              label="Light"
              defaultValue="#ffffff"
              title="Color for luminance above the light pivot."
            />
            <Slider
              id="band-dark-pivot"
              label="Dark pivot"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.33}
              display="0.33"
              title="Crossfade threshold between the dark and mid bands."
            />
            <Slider
              id="band-light-pivot"
              label="Light pivot"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.66}
              display="0.66"
              title="Crossfade threshold between the mid and light bands."
            />
            <Slider
              id="band-crossfade"
              label="Crossfade"
              min={0}
              max={0.5}
              step={0.01}
              defaultValue={0.15}
              display="0.15"
              title="Half-width of the smooth transition at each pivot. 0 = hard band edges."
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
            <div
              className="toggle-group"
              title="Offset: 3×3 Sobel central differences at a fixed texture offset in a screen-derivative cotangent frame (Mana Blade) — stable across camera distance. Screen derivative: normal from screen-space luminance gradients — watch it fade as you zoom."
            >
              <button id="btn-bump-offset" className="toggle-btn active" type="button">
                Offset
              </button>
              <button id="btn-bump-screen" className="toggle-btn" type="button">
                Screen derivative
              </button>
            </div>
            <div id="bump-offset-controls">
              <Slider
                id="bump-scale"
                label="Bump scale"
                min={0}
                max={0.1}
                step={0.001}
                defaultValue={0.02}
                display="0.020"
                title="Strength of the fine bump layer (sharp shape edges / detail)."
              />
              <Slider
                id="bump-offset"
                label="Bump offset"
                min={0.0005}
                max={0.02}
                step={0.0005}
                defaultValue={0.005}
                display="0.0050"
                title="Half-width of the fine slope estimate, in tile units. Smaller hugs the luminance transitions tighter."
              />
              <Slider
                id="volume-scale"
                label="Volume scale"
                min={0}
                max={0.1}
                step={0.001}
                defaultValue={0.03}
                display="0.030"
                title="Strength of the broad bump layer — turns bright areas into rounded volume, not just edge creases (the 'bright = high' read)."
              />
              <Slider
                id="volume-offset"
                label="Volume offset"
                min={0.0005}
                max={0.01}
                step={0.0005}
                defaultValue={0.008}
                display="0.0080"
                title="Half-width of the broad slope estimate. Capped low — large offsets look terrible on fine detail; the Sobel stencil supplies the broadness instead."
              />
            </div>
            <div id="bump-screen-controls" className="hidden">
              <Slider
                id="screen-strength"
                label="Screen strength"
                min={0}
                max={40}
                step={0.5}
                defaultValue={12}
                display="12.0"
                title="Strength of the screen-derivative bump. This is the control over its effect; it fades with camera distance by design."
              />
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
              defaultValue={5}
              display="5.00"
              title="Directional light intensity."
            />
            <div className="toggle-group">
              <button id="btn-mat-standard" className="toggle-btn" type="button">
                Standard
              </button>
              <button
                id="btn-mat-lambert"
                className="toggle-btn active"
                type="button"
                title="Wrap-lighting Lambert matching Mana Blade's EnhancedLambertMaterial."
              >
                Wrap Lambert
              </button>
              <button
                id="btn-mat-unlit"
                className="toggle-btn"
                type="button"
                title="No lighting — judge the raw band colors."
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
