# tex7

Single-texture luminance lab. Drop any colored texture and turn it into a clean, tileable luminance map with artistic tweaks, then preview it on a sphere shaded procedurally from a single base color.

## Pipeline

1. **Luminance extraction** — Rec. 709 luminance computed in linear space.
2. **Dark / light clamp** — percentile normalization stretches the histogram, clamping the darkest/brightest N% (same as gradient-normal-textures).
3. **Smoothing** — self-guided filter (edge-preserving). Low-variation areas like rock grain flatten toward their local mean while strong edges pass through untouched. `Smooth radius` sets the detail scale in pixels, `Smooth strength` the variance threshold.
4. **Gamma** — midtone curve.

The result is downloadable as a grayscale PNG (hover the canvas).

## Single-color shading

Instead of a two-color gradient, shading is derived procedurally from one base color:

- Luminance below 0.5 **darkens** the base multiplicatively (keeps hue/saturation).
- Luminance above 0.5 **lightens** toward white with a screen blend.
- **Shadow hue** rotates the hue of shadows proportionally to their depth (painterly shadow tinting).

## 3D preview (WebGPU + TSL)

A `MeshStandardNodeMaterial` builds both `colorNode` and `normalNode` in TSL from the luminance texture and uniforms — sliders update without any texture re-upload.

The bump is two layers of central-difference slope estimation applied in a Schüler screen-derivative cotangent frame (camera-distance-stable, ported from Mana Blade's `BumpNode`):

- **Bump offset/scale** — fine layer with a small sample span: crisp creases hugging shape edges.
- **Volume offset/scale** — broad layer with a large sample span: the same math at low frequency reads as rounded volume across whole bright shapes, not just their edges.

## Development

```bash
bun i
bun dev
```

`bun run all` runs format check, lint, and typecheck.
