# tex7

Single-texture luminance tool: drop a colored texture, clean its luminance up into a tileable
grayscale map, and preview it on a sphere recolored from a **single base color** — the luminance
drives both procedural darken/lighten of the albedo and a distance-stable bump. Built for the
Mana Blade texturing workflow (ship one grayscale channel, do all coloring in the shader).

```bash
bun install
bun dev
```

## Pipeline

1. **Luminance extraction** — Rec. 709 luminance of the linearized sRGB pixels, min-max
   normalized (same approach as gradient-normal-textures, single texture, no normal map, no KTX2).
2. **Simplify** — iterated separable bilateral filter with toroidal (tiling-safe) wrapping.
   Same goal as png-cleanup's region unification: areas with low luminance variation (rock grain,
   noise) melt into smooth surfaces while strong edges keep their full contrast. Strength sets the
   tolerance, radius the spatial extent, and more passes converge toward piecewise-flat zones
   without region seams.
3. **Clamp + shape** — dark/light percentile clamps re-expand the mid-range, then optional
   invert, gamma, contrast, and soft posterize (banded, hand-painted look). These reruns are cheap;
   only the simplify sliders trigger the expensive filter.
4. **Download** — the luminance preview has a PNG download badge; that grayscale file is the only
   texture you ship.

## Recoloring model: one base color, procedural variation

The two-color gradient used in Mana Blade / gradient-normal-textures always ended up being "base
color and a darker version of it", so tex7 embraces a single base color and derives the variation:

- **Pivot** — the luminance value that shows the base color unchanged.
- **Darken** — below the pivot, the base is multiplied toward black.
- **Lighten** — above the pivot, the base is mixed toward white.
- **Shadow saturation** — darkened areas get a saturation boost, so shadows read painterly
  instead of muddy gray-black.
- **Hue shift** — rotates the hue across the ramp (shadows one way, highlights the other), the
  classic painted-texture warm/cool shift.

All of it runs in TSL uniforms on a WebGPURenderer (WebGL2 fallback is automatic), so every slider
is realtime — the exact same node graph can be lifted into the game.

## Bump: the Mana Blade two-offset technique

The luminance is reused as a height field. The slope is measured with **central differences at a
fixed texture offset** (`bumpOffset`, the ± sampling half-width in tile units) and applied in a
screen-derivative cotangent frame (Schüler's tangent-less normal mapping), scaled by `bumpScale`.

After reviewing it against the alternatives, the technique stands as-is — it needs four texture
taps but is stable across camera distance and needs no tangent attributes or extra textures.
The **Screen derivative** toggle wires up the alternative (three.js `bumpMap()`-style one-screen-
pixel forward differences, with a ×100 scale compensation so it shows up at all): notice how it
shimmers and fades as the camera zooms, which is exactly why Mana Blade doesn't use it on soft
mip-filtered patterns.

## Materials

- **Standard** — MeshStandardNodeMaterial, roughness 0.85.
- **Wrap Lambert** — the same wrap lighting (`N·L + 0.3` wrap) as Mana Blade's
  `EnhancedLambertMaterial`, so tuned values transfer to the game's look.
- **Unlit** — raw color ramp, no lighting.
