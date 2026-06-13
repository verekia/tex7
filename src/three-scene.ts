// WebGPU sphere preview. The tweaked luminance drives both the albedo (single
// base color darkened/lightened procedurally) and the bump, all in TSL.
//
// Bump uses Mana Blade's technique: the luminance height is sampled at ±offset
// in U and V (central differences at a fixed texture offset) and the slope is
// applied in a screen-derivative cotangent frame (Schüler), so strength stays
// stable across camera distance. Three's bumpMap() forward-differences across
// one screen pixel instead — on soft mip-filtered patterns that delta is tiny
// and fades with zoom. A toggle exposes it (scale compensated ×100) so the
// instability is visible side by side.

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
  bumpMap,
  diffuseColor,
  float,
  hue,
  mix,
  normalView,
  positionView,
  saturation,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
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
export type BumpMode = 'fixed' | 'screen'

const SCREEN_BUMP_COMPENSATION = 100
const WRAP_LIGHTING = 0.3

const uRepeat = uniform(2)
const uBaseColor = uniform(new Color('#8d7b64'))
const uDarken = uniform(0.6)
const uLighten = uniform(0.25)
const uPivot = uniform(0.5)
const uShadowSat = uniform(0.3)
const uHueShift = uniform(0)
const uBumpScale = uniform(0.015)
const uBumpOffset = uniform(0.003)

// Valve wrap lighting, matching Mana Blade's EnhancedLambertMaterial so tuned
// values transfer to the game's look.
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
let normalNodes: Record<BumpMode, Node>
let materialType: MaterialType = 'standard'
let bumpMode: BumpMode = 'fixed'

function buildNodes(tex: CanvasTexture) {
  const uvNode = uv().mul(uRepeat)
  const lum = texture(tex, uvNode).r

  const below = uPivot.sub(lum).div(uPivot.max(0.001)).clamp(0, 1)
  const above = lum.sub(uPivot).div(float(1).sub(uPivot).max(0.001)).clamp(0, 1)
  const darkened = uBaseColor.mul(float(1).sub(below.mul(uDarken)))
  const lightened = mix(darkened, vec3(1), above.mul(uLighten))
  const saturated = saturation(lightened, float(1).add(below.mul(uShadowSat)))
  const colorNode = hue(saturated, uHueShift.mul(above.sub(below))).clamp(0, 1)

  const heightAt = (offset: ReturnType<typeof vec2>) => texture(tex, uvNode.add(offset)).r
  const e = uBumpOffset
  const span = e.mul(2)
  const dHdu = heightAt(vec2(e, 0))
    .sub(heightAt(vec2(e.negate(), 0)))
    .div(span)
  const dHdv = heightAt(vec2(0, e))
    .sub(heightAt(vec2(0, e.negate())))
    .div(span)

  const dp1 = positionView.dFdx()
  const dp2 = positionView.dFdy()
  const duv1 = uvNode.dFdx()
  const duv2 = uvNode.dFdy()
  const dp2perp = dp2.cross(normalView)
  const dp1perp = normalView.cross(dp1)
  const tangentU = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x))
  const tangentV = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y))
  const invMax = tangentU.dot(tangentU).max(tangentV.dot(tangentV)).inverseSqrt()
  const slopeU = dHdu.mul(uBumpScale)
  const slopeV = dHdv.mul(uBumpScale)
  const fixedNormal = tangentU
    .mul(invMax.mul(slopeU).negate())
    .add(tangentV.mul(invMax.mul(slopeV).negate()))
    .add(normalView)
    .normalize()

  const screenNormal = bumpMap(texture(tex, uvNode), uBumpScale.mul(SCREEN_BUMP_COMPENSATION))

  normalNodes = { fixed: fixedNormal, screen: screenNormal }

  const standard = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 })
  const lambert = new WrapLambertMaterial()
  const unlit = new MeshBasicNodeMaterial()
  standard.colorNode = colorNode
  lambert.colorNode = colorNode
  unlit.colorNode = colorNode
  standard.normalNode = normalNodes[bumpMode]
  lambert.normalNode = normalNodes[bumpMode]

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
  keyLight = new DirectionalLight(0xffffff, 3)
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

export function setBumpMode(mode: BumpMode) {
  bumpMode = mode
  if (!renderer) return
  for (const type of ['standard', 'lambert'] as const) {
    materials[type].normalNode = normalNodes[mode]
    materials[type].needsUpdate = true
  }
}

export function setTextureRepeat(v: number) {
  uRepeat.value = v
}

export function setBaseColor(hex: string) {
  uBaseColor.value.set(hex)
}

export function setDarken(v: number) {
  uDarken.value = v
}

export function setLighten(v: number) {
  uLighten.value = v
}

export function setPivot(v: number) {
  uPivot.value = v
}

export function setShadowSaturation(v: number) {
  uShadowSat.value = v
}

export function setHueShiftDegrees(v: number) {
  uHueShift.value = (v * Math.PI) / 180
}

export function setBumpScale(v: number) {
  uBumpScale.value = v
}

export function setBumpOffset(v: number) {
  uBumpOffset.value = v
}

export function setDirectionalIntensity(v: number) {
  if (!keyLight) return
  keyLight.intensity = v
}
