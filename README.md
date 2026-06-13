# tex7

Single-texture luminance tool: drop a colored texture, clean its luminance up into a tileable
grayscale map, and preview it on a sphere recolored into **three hand-authored bands** (dark / mid /
light) with a distance-stable bump. Built for the Mana Blade texturing workflow — ship one grayscale
channel, do all the coloring in the shader — and the preview is the _exact_ node graph the game uses,
so what you tune here is what you get in-game.

```bash
bun install
bun dev
```

## Pipeline

1. **Luminance extraction** — Rec. 709 luminance of the linearized sRGB pixels, min-max normalized
   (single texture, no normal map, no KTX2).
2. **Simplify** — edge-preserving smoothing with toroidal (tiling-safe) wrapping, so low-variation
   areas (rock grain, noise) melt into smooth surfaces while strong edges keep their full contrast.
   Two interchangeable engines:
   - **Bilateral** — iterated separable bilateral filter. Powerful and controllable; can leave
     stair-stepped seams on diagonal edges.
   - **Guided** — He et al.'s self-guided filter. Smooth by construction (little to no aliasing), O(n).

   An **Anti-alias** slider runs a light NaN-aware pass over the result to round any residual jaggies.

3. **Clamp + shape** — dark/light percentile clamps re-expand the mid-range, then gamma (≤ 2),
   contrast (≥ −0.5), and soft posterize. These reruns are cheap; only the simplify sliders trigger
   the expensive filter.
4. **Download** — the luminance preview has a PNG download badge; that grayscale file is the only
   texture you ship. Settings can be saved/loaded as a `.tex7.json` (see below).

## Recoloring model: three bands

The albedo is recolored from **three hand-authored colors** the luminance cross-fades between — this
replaces the older single-base-color ramp (its darken/lighten/shadow-saturation/hue-shift are gone;
the bands are authored directly now):

- **Dark / Mid / Light** — the three band colors (defaults black / gray / white, i.e. raw luminance).
- **Dark pivot** — the luminance threshold where dark cross-fades into mid.
- **Light pivot** — the luminance threshold where mid cross-fades into light.
- **Crossfade** — half-width of the smoothstep transition at each pivot (0 = hard band edges).

It all runs as TSL uniforms on a WebGPURenderer, so every slider is realtime and the exact node graph
is lifted into the game (`RampColorNode` in Mana Blade).

## Luminance visualizer

A histogram of the final output sits under the luminance preview. The end bars are the pixels the
clamps trim to pure black/white, the three regions are tinted to the bands, and the two pivots are
drawn as lines — so you can place the trims and pivots where they condense the most information.

## Bump: the Mana Blade offset technique (+ volume)

The luminance is reused as a height field. The slope is measured with a **3×3 Sobel stencil at a
fixed texture offset** (averaging across the perpendicular axis kills the texel-grid pixelation a
2-tap difference shows at small offsets) and applied in a screen-derivative cotangent frame
(Schüler's tangent-less normal mapping), so strength is stable across camera distance.

Two layers are summed — they are the **same operation at two offset scales**:

- **Bump** (small offset) — fine, sharp detail and shape edges.
- **Volume** (broader offset, capped low) — averages across whole shapes so a bright blob tilts as
  one rounded mound: the "bright = high" read, rather than just edge creases. (A normal can only
  encode slope, never absolute height, so this broad gradient is how a single luminance channel
  reads as volume without true displacement.)

The **Screen derivative** toggle builds the normal from screen-space luminance gradients instead
(Mikkelsen's unparametrized bump), with its own **Screen strength** slider — it intentionally fades
as the camera zooms, which is why the game uses the offset technique on soft mip-filtered patterns.

## Materials

- **Wrap Lambert** (default) — the same wrap lighting (`N·L + 0.3` wrap) as Mana Blade's
  `EnhancedLambertMaterial`, so tuned values transfer to the game's look.
- **Standard** — MeshStandardNodeMaterial, roughness 0.85.
- **Unlit** — raw band colors, no lighting.

## Saving settings

`Save config` writes a `<texture>.tex7.json` snapshot of every control. `Load config` — or dropping
a `.json` (or a texture and its `.json` together) onto the page — restores them all, so a config can
live next to its texture.
