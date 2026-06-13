# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tex7 is a single-page, client-only tool for authoring **grayscale luminance textures** for the Mana
Blade game (sibling repo at `../manablade`). You drop a colored texture; tex7 extracts and cleans its
luminance, then previews it on a WebGPU sphere recolored into three hand-authored bands with a bump.
The shipped artifact is one grayscale PNG — all coloring happens in the shader.

**The preview mirrors the game.** tex7's TSL node graph (`src/three-scene.ts`) is the same one Mana
Blade uses for world-natural materials (`client/core/textures.tsx` → `RampColorNode` + `BumpNode`).
If you change the recolor or bump model here, keep `../manablade` in sync, and vice-versa. Both
currently use the 3-band model (dark/mid/light + dark/light pivots + crossfade).

## Development Commands

```bash
bun install
bun dev            # portless tex7 next dev (Next 16, Turbopack)
bun run build      # static export (output: 'export')
bun run all        # format:check + lint + typecheck + warden — run before considering work done
bun run typecheck  # tsc --noEmit
bun run lint       # oxlint .
bun run format     # oxfmt . (auto-fix)
```

## Architecture

Next.js Pages Router, but it's really a vanilla-TS app: `pages/index.tsx` dynamically imports
`MainView` with `ssr: false`, and almost all logic lives in `src/`.

- **`src/process.ts`** — CPU luminance pipeline (no GPU): load → linear Rec.709 luminance →
  min-max normalize (`computeBaseMap`) → `shapeLuminance` (percentile clamp, gamma, contrast) →
  grayscale `ImageData`. This produces the texture that ships.
- **`src/simplify.ts`** — edge-preserving smoothing (He et al.'s self-guided filter), NaN-aware
  and toroidally wrapped for tileability.
- **`src/three-scene.ts`** — the WebGPU/TSL sphere preview. Builds the **3-band color node** and the
  **bump normal node** (a single 3×3 Sobel slope of the luminance heightfield in a Schüler cotangent
  frame — `bumpScale` + `bumpOffset`, matching the game's `BumpNode`). All params are `uniform()`s
  with `setX()` setters. Default material is Wrap Lambert (matches the game), default light 5.
- **`src/visualizer.ts`** — renders the luminance histogram (trim end-bars + band tints + pivot lines).
- **`src/config.ts`** — `.tex7.json` (de)serialization for save/load.
- **`src/main-init.ts`** — the glue. Owns a **control registry** (`sliders` / `colors` / `toggles`)
  that drives DOM binding, value-label formatting, AND config save/load from one source of truth.
  Runs the CPU pipeline (rAF-throttled) and feeds the canvas to the three-scene.
- **`src/MainView.tsx`** — static JSX markup only (controls, canvases). Control `id`s here must match
  the registry in `main-init.ts`.
- **`global.css`** — Tailwind v4 + component styles.

Data flow: file → `process` (CPU) → grayscale canvas → `notifyLuminanceUpdated()` → the canvas is a
`CanvasTexture` the TSL graph samples. The grayscale canvas, not the colored sphere, is the output.

## Conventions & gotchas

- **Warden** (`@verekia/warden`, run by `bun run all`) enforces shared config/versions across the
  user's repos. Keep `next`/`react`/`typescript`/`oxfmt`/`oxlint`/etc. at their pinned versions and
  keep the `format`/`lint`/`warden` scripts intact. **Avoid adding npm dependencies** — everything is
  doable with `three` + `react` + vanilla TS.
- **Formatting/lint**: oxfmt (no semicolons, single quotes, 120 cols, trailing commas) + oxlint.
  `tsconfig` has `noUnusedLocals`/`noUnusedParameters`, so no unused imports/vars.
- **Adding a control**: add the markup (with a unique `id`) in `MainView.tsx`, then one entry to the
  matching registry array in `main-init.ts`. That auto-wires the event handler, value label, and
  config save/load — don't hand-wire listeners.
- **TSL gotchas**: `dFdx`/`dFdy` are typed for vector nodes only — promote a scalar via `vec3(x)` and
  read a component (`dFdx(vec3(lum)).x`). `Color` uniforms from hex are in linear working space
  (three color management is on). Inside a `normalNode` build, `normalView` resolves to the geometry
  normal (no cycle).
- **Output is always grayscale luminance.** The band colors are a preview/authoring aid; never bake
  them into the downloaded PNG.
