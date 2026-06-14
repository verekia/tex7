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
    <span className="control-value" id={`${id}-value`}>
      {display}
    </span>
    <input type="range" id={id} min={min} max={max} step={step} defaultValue={defaultValue} />
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
        <title>tex7 — 3-band luminance-based texture pipeline for Three.js TSL</title>
      </Head>
      <div id="app">
        <header id="app-header">
          <div className="header-bar">
            <div className="header-main">
              <h1>tex7 — 3-band luminance-based texture pipeline for Three.js TSL</h1>
              <p className="intro">
                Drop in a colored texture. <b>Stage 1</b> extracts and cleans its luminance into the tileable grayscale
                map you ship; <b>Stage 2</b> previews that map on a sphere — recolored into three hand-authored bands
                with a distance-stable bump — as a live Three.js TSL graph you can copy into your own project. Settings
                save and restore as a <code>.tex7.json</code>.
              </p>
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
            <div className="header-textures">
              <div id="drop-zone-wrap">
                <div id="drop-zone" className="drop-zone" tabIndex={0}>
                  <p>Drop a texture here or click to select.</p>
                  <p className="formats">PNG, JPG, WebP — or a .tex7.json config</p>
                  <input type="file" id="file-input" className="file-input" accept="image/png,image/jpeg,image/webp" />
                </div>
              </div>
              <div id="original-wrap" className="hidden">
                <canvas id="canvas-original"></canvas>
              </div>
            </div>
          </div>
          <div id="error-message" className="hidden"></div>
        </header>

        <section id="section-luminance" className="stage hidden">
          <div className="stage-controls">
            <h2 className="stage-title">
              <span className="stage-num">1</span> Clean the luminance
            </h2>

            <div className="control-group">
              <span className="control-group-title">Tone</span>
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
            </div>

            <div className="control-group">
              <div className="control-group-head">
                <span className="control-group-title">Simplify</span>
                <button
                  id="btn-simplify-toggle"
                  className="group-toggle"
                  type="button"
                  aria-pressed="false"
                  title="Bypass simplification to A/B against the raw luminance. Your settings are kept."
                >
                  Off
                </button>
              </div>
              <Slider
                id="simplify-strength"
                label="Strength"
                min={1}
                max={100}
                step={1}
                defaultValue={1}
                display="1"
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
            </div>
          </div>

          <div className="stage-preview">
            <div className="stage-preview-inner">
              <div id="luminance-wrap">
                <h2>Luminance — the texture you ship</h2>
                <div className="canvas-wrap">
                  <canvas id="canvas-luminance" className="checkerboard"></canvas>
                  <button id="download-png" className="dl-badge" type="button" title="Download luminance as PNG">
                    <span className="dl-badge-label">PNG</span>
                    <DownloadArrow />
                  </button>
                </div>
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
        </section>

        <section id="section-3d" className="stage hidden">
          <div className="stage-controls">
            <h2 className="stage-title">
              <span className="stage-num">2</span> Preview on the sphere
            </h2>

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
                id="bump-scale"
                label="Bump scale"
                min={0}
                max={0.1}
                step={0.001}
                defaultValue={0.02}
                display="0.020"
                title="Strength of the bump. Slope measured with a Sobel stencil in a screen-derivative cotangent frame, stable across camera distance."
              />
              <Slider
                id="bump-offset"
                label="Bump offset"
                min={0.0005}
                max={0.02}
                step={0.0005}
                defaultValue={0.005}
                display="0.0050"
                title="Half-width of the slope estimate, in tile units. Smaller hugs the luminance transitions tighter; larger spreads the shading into a broader, rounder relief."
              />
              <div className="radio-group" role="radiogroup" aria-label="Bump stencil">
                <label title="Full 3×3 Sobel — 8 texture taps, smoothest.">
                  <input type="radio" name="bump-stencil" value="8" defaultChecked /> 8-tap
                </label>
                <label title="4-tap diagonal — half the texture reads, near-identical look (the cheaper, lower-quality path).">
                  <input type="radio" name="bump-stencil" value="4" /> 4-tap
                </label>
              </div>
            </div>

            <div className="control-group">
              <span className="control-group-title">Scene</span>
              <Slider
                id="tex-scale"
                label="Texture scale"
                min={0.25}
                max={10}
                step={0.05}
                defaultValue={5}
                display="5.0×"
                title="UV repeat of the luminance texture on the sphere."
              />
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
              <div className="radio-group" role="radiogroup" aria-label="Material">
                <label>
                  <input type="radio" name="material" value="standard" /> Standard
                </label>
                <label title="Valve-style wrap-lighting Lambert — softer terminator than stock Lambert.">
                  <input type="radio" name="material" value="lambert" defaultChecked /> Wrap Lambert
                </label>
                <label title="No lighting — judge the raw band colors.">
                  <input type="radio" name="material" value="unlit" /> Unlit
                </label>
              </div>
            </div>
          </div>

          <div className="stage-preview">
            <div className="stage-preview-inner">
              <div id="three-container"></div>
            </div>
          </div>
        </section>

        <section id="tiled-section" className="hidden">
          <h2>Tiled (3×3)</h2>
          <canvas id="canvas-tiled" className="checkerboard"></canvas>
        </section>

        <section id="section-integration" className="hidden">
          <div className="panel-head">
            <h2>Integration — TSL</h2>
            <button id="btn-copy-tsl" className="text-btn" type="button" title="Copy the TSL to the clipboard">
              Copy
            </button>
          </div>
          <p className="intro">
            Drop-in three.js TSL that reproduces this sphere from the luminance texture — sample it raw (
            <code>map.colorSpace = NoColorSpace</code>). The values below track your current settings.
          </p>
          <div className="radio-group" role="radiogroup" aria-label="Bump code">
            <label title="Export only the 8-tap Sobel.">
              <input type="radio" name="code-stencil" value="8" /> 8-tap
            </label>
            <label title="Export only the 4-tap diagonal.">
              <input type="radio" name="code-stencil" value="4" /> 4-tap
            </label>
            <label title="Export both, switched at runtime by a highTextureQuality boolean you wire to your own quality setting.">
              <input type="radio" name="code-stencil" value="both" defaultChecked /> User choice
            </label>
          </div>
          <pre id="integration-code" className="code-block">
            <code></code>
          </pre>
        </section>
      </div>
    </>
  )
}
