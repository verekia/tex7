import { useEffect } from 'react'
import Head from 'next/head'

const DownloadBadge = ({ target }: { target: string }) => (
  <button className="dl-badge" data-target={target} type="button" title="Download as PNG">
    <span className="dl-badge-label">PNG</span>
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
  </button>
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
        <title>Tex7 — luminance texture lab</title>
      </Head>
      <div id="app">
        <h1>Tex7 — luminance texture lab</h1>
        <p id="intro">
          Drop a colored texture, clean its luminance into a tileable height/shading map, then preview it on a sphere
          shaded from a single base color.
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
        </div>
        <div id="error-message" className="hidden"></div>

        <section id="section-luminance" className="hidden">
          <h2>Luminance</h2>
          <div id="lum-controls" className="slider-controls">
            <label>
              <span className="slider-label">Dark clamp</span>
              <input type="range" id="clamp-low" min="0" max="25" step="0.1" defaultValue="0.1" />
              <span className="slider-value" id="clamp-low-value">
                0.1%
              </span>
            </label>
            <label>
              <span className="slider-label">Light clamp</span>
              <input type="range" id="clamp-high" min="0" max="25" step="0.1" defaultValue="0.1" />
              <span className="slider-value" id="clamp-high-value">
                0.1%
              </span>
            </label>
            <label>
              <span
                className="slider-label"
                title="Detail scale of the edge-preserving smoothing, in pixels. Variations smaller than this get flattened; edges stronger than the smoothing strength survive."
              >
                Smooth radius
              </span>
              <input type="range" id="smooth-radius" min="1" max="32" step="1" defaultValue="4" />
              <span className="slider-value" id="smooth-radius-value">
                4px
              </span>
            </label>
            <label>
              <span
                className="slider-label"
                title="Strength of the edge-preserving (guided) filter. Low-variation areas like rock grain become smooth while strong edges stay intact."
              >
                Smooth strength
              </span>
              <input type="range" id="smooth-strength" min="0" max="100" step="1" defaultValue="0" />
              <span className="slider-value" id="smooth-strength-value">
                0
              </span>
            </label>
            <label>
              <span
                className="slider-label"
                title="Midtone curve applied after smoothing. >1 darkens midtones, <1 lifts them."
              >
                Gamma
              </span>
              <input type="range" id="gamma" min="0.25" max="4" step="0.05" defaultValue="1" />
              <span className="slider-value" id="gamma-value">
                1.00
              </span>
            </label>
          </div>
          <div id="images-row">
            <div>
              <div className="dl-canvas-wrap">
                <canvas id="canvas-luminance"></canvas>
                <DownloadBadge target="luminance" />
              </div>
            </div>
          </div>
        </section>

        <section id="section-color" className="hidden">
          <h2>Single-color shading</h2>
          <div id="color-pickers">
            <label>
              Base color
              <input type="color" id="picker-base" defaultValue="#a0764b" />
            </label>
          </div>
          <div id="color-controls" className="slider-controls">
            <label>
              <span
                className="slider-label"
                title="How much dark luminance areas darken the base color (multiplicative, keeps hue)."
              >
                Darken
              </span>
              <input type="range" id="darken" min="0" max="1" step="0.01" defaultValue="0.7" />
              <span className="slider-value" id="darken-value">
                0.70
              </span>
            </label>
            <label>
              <span
                className="slider-label"
                title="How much bright luminance areas push the base color toward white (screen blend)."
              >
                Lighten
              </span>
              <input type="range" id="lighten" min="0" max="1" step="0.01" defaultValue="0.25" />
              <span className="slider-value" id="lighten-value">
                0.25
              </span>
            </label>
            <label>
              <span
                className="slider-label"
                title="Rotate the hue of shadows, proportionally to their depth. Classic painterly trick: shift shadows toward purple/blue instead of plain black."
              >
                Shadow hue
              </span>
              <input type="range" id="hue-shift" min="-180" max="180" step="1" defaultValue="0" />
              <span className="slider-value" id="hue-shift-value">
                0°
              </span>
            </label>
          </div>
          <div id="recolored-and-3d-row">
            <div id="recolored-wrap">
              <h2>Recolored</h2>
              <div className="dl-canvas-wrap">
                <canvas id="canvas-recolored"></canvas>
                <DownloadBadge target="recolored" />
              </div>
            </div>
            <section id="section-3d">
              <h2 id="three-heading">3D Preview</h2>
              <div id="three-controls" className="slider-controls">
                <label>
                  <span className="slider-label">Texture scale</span>
                  <input type="range" id="tex-size" min="0.5" max="10" step="0.1" defaultValue="2" />
                  <span className="slider-value" id="tex-size-value">
                    2.0×
                  </span>
                </label>
                <label>
                  <span className="slider-label">Light</span>
                  <input type="range" id="light-intensity" min="0" max="10" step="0.05" defaultValue="3" />
                  <span className="slider-value" id="light-intensity-value">
                    3.00
                  </span>
                </label>
                <label>
                  <span
                    className="slider-label"
                    title="Half-width of the fine bump slope estimate, in tile units. Smaller hugs shape edges tighter (sharper, can get noisy)."
                  >
                    Bump offset
                  </span>
                  <input type="range" id="bump-offset" min="0.0005" max="0.02" step="0.0005" defaultValue="0.003" />
                  <span className="slider-value" id="bump-offset-value">
                    0.0030
                  </span>
                </label>
                <label>
                  <span className="slider-label" title="Strength of the fine bump layer (sharp shape edges).">
                    Bump scale
                  </span>
                  <input type="range" id="bump-scale" min="0" max="0.1" step="0.001" defaultValue="0.02" />
                  <span className="slider-value" id="bump-scale-value">
                    0.020
                  </span>
                </label>
                <label>
                  <span
                    className="slider-label"
                    title="Half-width of the broad bump layer. Large offsets average across whole shapes, turning bright areas into rounded volume instead of just edge creases."
                  >
                    Volume offset
                  </span>
                  <input type="range" id="volume-offset" min="0.005" max="0.25" step="0.005" defaultValue="0.05" />
                  <span className="slider-value" id="volume-offset-value">
                    0.050
                  </span>
                </label>
                <label>
                  <span
                    className="slider-label"
                    title="Strength of the broad bump layer (volume in the middle of shapes)."
                  >
                    Volume scale
                  </span>
                  <input type="range" id="volume-scale" min="0" max="0.2" step="0.002" defaultValue="0.04" />
                  <span className="slider-value" id="volume-scale-value">
                    0.040
                  </span>
                </label>
              </div>
              <div id="three-container"></div>
            </section>
          </div>
          <h2 id="tiled-heading">Tiled</h2>
          <canvas id="canvas-tiled"></canvas>
        </section>
      </div>
    </>
  )
}
