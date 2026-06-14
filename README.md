# TEX7

A **3-band luminance-based texture pipeline for Three.js TSL**. Drop in a colored texture; tex7
extracts and cleans its luminance into a tileable grayscale map, then previews that map on a sphere
recolored into three hand-authored bands (dark / mid / light) with a distance-stable bump. You ship
one small grayscale PNG and do all the coloring in the shader — and the preview _is_ a Three.js TSL
node graph you can copy straight into your own project.

<p align="center">
  <img width="670" height="461" alt="Image" src="https://github.com/user-attachments/assets/7c51a569-71cb-4ec9-9f88-83daf55c3d50" />
</p>

```bash
bun install
bun dev
```

## Pipeline

1. **Luminance extraction** — Rec. 709 luminance of the linearized sRGB pixels, min-max normalized.
2. **Simplify** — edge-preserving smoothing (He et al.'s guided filter) with toroidal (tiling-safe)
   wrapping, so low-variation areas (rock grain, noise) melt into smooth surfaces while strong edges
   keep their full contrast. O(n) regardless of radius; a master On/Off toggle A/Bs it against the
   raw luminance.
3. **Tone** — dark/light percentile clamps re-expand the mid-range, then gamma and contrast shape the
   curve. Cheap to rerun; only the simplify sliders trigger the expensive filter.
4. **Download** — the luminance preview has a PNG badge. That grayscale file is the only texture you
   ship.

A histogram under the preview shows the final distribution: the end bars are the pixels the clamps
trim to pure black/white, the three regions are tinted to the bands, and the two pivots are drawn as
lines — so you can place the trims and pivots where they condense the most information.

## Three-band recolor

The albedo is recolored from three hand-authored colors the luminance cross-fades between:

- **Dark / Mid / Light** — the three band colors (defaults black / gray / white = raw luminance).
- **Dark pivot / Light pivot** — the luminance thresholds where dark→mid and mid→light cross over.
- **Crossfade** — half-width of the smoothstep at each pivot (0 = hard band edges).

It runs as TSL uniforms on a WebGPURenderer, so every slider is realtime.

## Bump

The luminance doubles as a height field. The slope is measured with a **3×3 Sobel stencil at a fixed
texture offset** (averaging across the perpendicular axis kills the texel-grid pixelation a 2-tap
difference shows at small offsets) and applied in a screen-derivative cotangent frame (Schüler's
tangent-less normal mapping), so strength stays stable across camera distance.

- **Bump scale** — strength of the perturbation.
- **Bump offset** — the slope's sampling half-width in tile units: smaller hugs the transitions
  tighter (crisp creases), larger spreads it into a broader, rounder relief.
- **8-tap / 4-tap** — the stencil. 8-tap is the full Sobel; 4-tap is a diagonal (corners only) — half
  the texture reads for a near-identical look, when you want the cheaper path.

(A normal encodes slope, never absolute height — so "bright = high" reads as volume through its
broad-scale gradient, which is the larger-offset end of this same control, not a separate term.)

## Materials

- **Wrap Lambert** (default) — Valve-style wrap lighting (`N·L + 0.3`) for a softer terminator than
  stock Lambert.
- **Standard** — `MeshStandardNodeMaterial`, roughness 0.85.
- **Unlit** — raw band colors, no lighting.

## Export the TSL

The Integration panel emits drop-in Three.js TSL that reproduces the sphere from your luminance
texture — sample it raw (`map.colorSpace = NoColorSpace`), and the values track your current
settings. Choose **8-tap**, **4-tap**, or **User choice** (both stencils, switched at runtime by a
`highTextureQuality` boolean you wire to your own quality setting).

## Saving settings

`Save config` writes a `<texture>.tex7.json` snapshot of every control. `Load config` — or dropping a
`.json` (or a texture and its `.json` together) onto the page — restores them all, so a config can
live next to its texture.

## License

[MIT](LICENSE)
