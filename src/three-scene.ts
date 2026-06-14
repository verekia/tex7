// WebGPU sphere preview. The luminance texture drives both the albedo — a
// three-band recolor (dark / mid / light) the artist hand-authors — and the
// bump, all in TSL.
//
// The bump samples the luminance height around each texel with a Sobel-style stencil
// (central differences averaged across the perpendicular axis — far less texel-grid
// pixelation than a 2-tap difference) and applies it in a screen-derivative cotangent
// frame (Schüler), so strength stays stable across camera distance. `bumpOffset` is the
// slope's sampling spacing, `bumpScale` its strength.
//
// The 8-tap/4-tap toggle picks the stencil: 8-tap is the full 3×3 Sobel (smoothest);
// 4-tap is a diagonal (corners only) — half the texture reads, near-identical look.

import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SphereGeometry,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  BRDF_Lambert,
  diffuseColor,
  float,
  mix,
  normalView,
  positionView,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
} from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  PhongLightingModel,
  WebGPURenderer,
} from 'three/webgpu'

import type { Node } from 'three/webgpu'

export type MaterialType = 'standard' | 'lambert' | 'unlit'
export type BumpStencil = '8' | '4'

const WRAP_LIGHTING = 0.3

const uRepeat = uniform(5)
const uDarkColor = uniform(new Color('#000000'))
const uMidColor = uniform(new Color('#808080'))
const uLightColor = uniform(new Color('#ffffff'))
const uDarkPivot = uniform(0.33)
const uLightPivot = uniform(0.66)
const uCrossfade = uniform(0.15)
const uBumpScale = uniform(0.02)
const uBumpOffset = uniform(0.005)

// Valve-style wrap lighting: softens the terminator so diffuse wraps slightly past 90°,
// for a softer look than stock Lambert.
class WrapLambertLightingModel extends PhongLightingModel {
  constructor() {
    super(false)
  }

  direct({ lightDirection, lightColor, lightNode, reflectedLight }: Record<string, any>) {
    const rawNdotL = normalView.dot(lightDirection)
    const shadow = lightNode.shadowNode ?? float(1)
    const realNdotL = rawNdotL.max(0)
    const wrapNdotL = rawNdotL
      .add(WRAP_LIGHTING)
      .max(0)
      .div(1 + WRAP_LIGHTING)
    const NdotL = wrapNdotL.sub(realNdotL.mul(float(1).sub(shadow)))
    const irradiance = NdotL.mul(lightNode.baseColorNode ?? lightColor)
    const brdf = BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as Node<'vec3'>
    reflectedLight.directDiffuse.addAssign(irradiance.mul(brdf))
  }
}

const wrapLightingModel = new WrapLambertLightingModel()

class WrapLambertMaterial extends MeshLambertNodeMaterial {
  setupLightingModel() {
    return wrapLightingModel
  }
}

let renderer: WebGPURenderer | null = null
let scene: Scene
let camera: PerspectiveCamera
let controls: OrbitControls
let sphere: Mesh
let keyLight: DirectionalLight
let lumTexture: CanvasTexture | null = null
let lumWidth = 0
let lumHeight = 0
let materials: Record<MaterialType, MeshStandardNodeMaterial | WrapLambertMaterial | MeshBasicNodeMaterial>
let materialType: MaterialType = 'lambert'
let bumpStencil: BumpStencil = '8'

// Build the bump normal node for the current `bumpStencil`. Only the selected stencil's taps
// are built into the graph, so 4× genuinely doesn't sample the extra texels the 8× path would.
function buildNormalNode(tex: CanvasTexture) {
  const uvNode = uv().mul(uRepeat)
  const heightAt = (du: ReturnType<typeof float>, dv: ReturnType<typeof float>) =>
    texture(tex, uvNode.add(vec2(du, dv))).r
  const e = uBumpOffset
  const en = e.negate()

  // 8× — full 3×3 Sobel ([1,2,1] across the perpendicular axis). Averaging across that axis is
  // what removes the staircase pixelation a 2-tap central difference shows at small offsets.
  const sobel8 = () => {
    const tl = heightAt(en, e)
    const tc = heightAt(float(0), e)
    const tr = heightAt(e, e)
    const ml = heightAt(en, float(0))
    const mr = heightAt(e, float(0))
    const bl = heightAt(en, en)
    const bc = heightAt(float(0), en)
    const br = heightAt(e, en)
    const denom = e.mul(8)
    const slopeU = tr
      .add(mr.mul(2))
      .add(br)
      .sub(tl.add(ml.mul(2)).add(bl))
      .div(denom)
      .mul(uBumpScale)
    const slopeV = tl
      .add(tc.mul(2))
      .add(tr)
      .sub(bl.add(bc.mul(2)).add(br))
      .div(denom)
      .mul(uBumpScale)
    return [slopeU, slopeV] as const
  }

  // 4× — 4-tap diagonal: each corner feeds both gradients, so the cross-axis averaging survives
  // at half the texture reads. `gain` folds bumpScale and 1/(4e) (also drops the per-pixel divides).
  const diag4 = () => {
    const tl = heightAt(en, e)
    const tr = heightAt(e, e)
    const bl = heightAt(en, en)
    const br = heightAt(e, en)
    const gain = uBumpScale.div(e.mul(4))
    return [tr.add(br).sub(tl).sub(bl).mul(gain), tl.add(tr).sub(bl).sub(br).mul(gain)] as const
  }

  const [slopeU, slopeV] = bumpStencil === '4' ? diag4() : sobel8()

  const dp1 = positionView.dFdx()
  const dp2 = positionView.dFdy()
  const duv1 = uvNode.dFdx()
  const duv2 = uvNode.dFdy()
  const dp2perp = dp2.cross(normalView)
  const dp1perp = normalView.cross(dp1)
  const tangentU = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x))
  const tangentV = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y))
  const invMax = tangentU.dot(tangentU).max(tangentV.dot(tangentV)).inverseSqrt()
  return tangentU
    .mul(invMax.mul(slopeU).negate())
    .add(tangentV.mul(invMax.mul(slopeV).negate()))
    .add(normalView)
    .normalize()
}

function buildNodes(tex: CanvasTexture) {
  const uvNode = uv().mul(uRepeat)
  const lum = texture(tex, uvNode).r

  // Three-band recolor: cross-fade dark→mid at the dark pivot and mid→light at
  // the light pivot, each transition `uCrossfade` wide. Authored colors, so the
  // defaults (black / gray / white) read as the raw luminance.
  const toMid = smoothstep(uDarkPivot.sub(uCrossfade), uDarkPivot.add(uCrossfade), lum)
  const toLight = smoothstep(uLightPivot.sub(uCrossfade), uLightPivot.add(uCrossfade), lum)
  const colorNode = mix(mix(uDarkColor, uMidColor, toMid), uLightColor, toLight)

  const normalNode = buildNormalNode(tex)

  const standard = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 })
  const lambert = new WrapLambertMaterial()
  const unlit = new MeshBasicNodeMaterial()
  standard.colorNode = colorNode
  lambert.colorNode = colorNode
  unlit.colorNode = colorNode
  standard.normalNode = normalNode
  lambert.normalNode = normalNode

  materials = { standard, lambert, unlit }
}

export async function initThreeScene(container: HTMLElement, lumCanvas: HTMLCanvasElement) {
  if (renderer) return

  renderer = new WebGPURenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  container.appendChild(renderer.domElement)

  scene = new Scene()
  camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 0, 3)

  scene.add(new AmbientLight(0xffffff, 0.45))
  keyLight = new DirectionalLight(0xffffff, 5)
  keyLight.position.set(2, 2, 3)
  scene.add(keyLight)

  lumTexture = new CanvasTexture(lumCanvas)
  lumTexture.wrapS = lumTexture.wrapT = RepeatWrapping
  lumTexture.colorSpace = NoColorSpace
  lumWidth = lumCanvas.width
  lumHeight = lumCanvas.height

  buildNodes(lumTexture)

  sphere = new Mesh(new SphereGeometry(1, 128, 128), materials[materialType])
  scene.add(sphere)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  const resizeObserver = new ResizeObserver(() => {
    if (!renderer) return
    const w = container.clientWidth
    if (w === 0) return
    renderer.setSize(w, w, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(container)

  await renderer.init()
  renderer.setAnimationLoop(() => {
    if (!renderer) return
    controls.update()
    renderer.render(scene, camera)
  })
}

export function notifyLuminanceUpdated() {
  if (!lumTexture) return
  const canvas = lumTexture.image as HTMLCanvasElement
  if (canvas.width !== lumWidth || canvas.height !== lumHeight) {
    lumWidth = canvas.width
    lumHeight = canvas.height
    lumTexture.dispose()
  }
  lumTexture.needsUpdate = true
}

export function setMaterialType(type: MaterialType) {
  materialType = type
  if (!renderer) return
  sphere.material = materials[type]
}

export function setTextureRepeat(v: number) {
  uRepeat.value = v
}

export function setDarkColor(hex: string) {
  uDarkColor.value.set(hex)
}

export function setMidColor(hex: string) {
  uMidColor.value.set(hex)
}

export function setLightColor(hex: string) {
  uLightColor.value.set(hex)
}

export function setDarkPivot(v: number) {
  uDarkPivot.value = v
}

export function setLightPivot(v: number) {
  uLightPivot.value = v
}

export function setCrossfade(v: number) {
  uCrossfade.value = v
}

export function setBumpScale(v: number) {
  uBumpScale.value = v
}

export function setBumpOffset(v: number) {
  uBumpOffset.value = v
}

export function setBumpStencil(stencil: BumpStencil) {
  bumpStencil = stencil
  // Rebuild only the bump normal node and swap it in (the band recolor is untouched). Reassigning
  // normalNode + needsUpdate recompiles the shader with just the chosen stencil's taps.
  if (!renderer || !lumTexture) return
  const normalNode = buildNormalNode(lumTexture)
  materials.standard.normalNode = normalNode
  materials.lambert.normalNode = normalNode
  materials.standard.needsUpdate = true
  materials.lambert.needsUpdate = true
}

export function setDirectionalIntensity(v: number) {
  if (!keyLight) return
  keyLight.intensity = v
}
