// WebGPU sphere preview. The luminance texture drives both the albedo — a
// three-band recolor (dark / mid / light) the artist hand-authors — and the
// bump, all in TSL.
//
// Bump (offset mode) uses Mana Blade's technique: the luminance height is
// sampled around each texel with a 3×3 Sobel stencil (central differences
// averaged across the perpendicular axis — far less texel-grid pixelation than a
// 2-tap difference) at two scales, a fine "Bump" layer and a broad "Volume"
// layer, then applied in a screen-derivative cotangent frame (Schüler), so
// strength stays stable across camera distance. The broad layer is what turns a
// bright blob into raised *volume* rather than just an edge crease — that is the
// "bright = high" read, expressed as the gradient of the luminance heightfield.
//
// Bump (screen mode) builds the normal from screen-space derivatives of the
// displayed luminance (Mikkelsen's unparametrized bump), exposed with its own
// strength so you can dial its effect; it intentionally fades with zoom.

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
  dFdx,
  dFdy,
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
export type BumpMode = 'offset' | 'screen'

const WRAP_LIGHTING = 0.3

const uRepeat = uniform(2)
const uDarkColor = uniform(new Color('#000000'))
const uMidColor = uniform(new Color('#808080'))
const uLightColor = uniform(new Color('#ffffff'))
const uDarkPivot = uniform(0.33)
const uLightPivot = uniform(0.66)
const uCrossfade = uniform(0.15)
const uBumpScale = uniform(0.02)
const uBumpOffset = uniform(0.005)
const uVolumeScale = uniform(0.03)
const uVolumeOffset = uniform(0.008)
const uScreenStrength = uniform(12)

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
let materialType: MaterialType = 'lambert'
let bumpMode: BumpMode = 'offset'

function buildNodes(tex: CanvasTexture) {
  const uvNode = uv().mul(uRepeat)
  const lum = texture(tex, uvNode).r

  // Three-band recolor: cross-fade dark→mid at the dark pivot and mid→light at
  // the light pivot, each transition `uCrossfade` wide. Authored colors, so the
  // defaults (black / gray / white) read as the raw luminance.
  const toMid = smoothstep(uDarkPivot.sub(uCrossfade), uDarkPivot.add(uCrossfade), lum)
  const toLight = smoothstep(uLightPivot.sub(uCrossfade), uLightPivot.add(uCrossfade), lum)
  const colorNode = mix(mix(uDarkColor, uMidColor, toMid), uLightColor, toLight)

  // 3×3 Sobel slope at texel spacing `e`, scaled. Averaging across the
  // perpendicular axis is what removes the staircase pixelation a 2-tap central
  // difference shows at small offsets.
  const heightAt = (du: ReturnType<typeof float>, dv: ReturnType<typeof float>) =>
    texture(tex, uvNode.add(vec2(du, dv))).r
  const sobel = (e: typeof uBumpOffset, scale: typeof uBumpScale) => {
    const en = e.negate()
    const tl = heightAt(en, e)
    const tc = heightAt(float(0), e)
    const tr = heightAt(e, e)
    const ml = heightAt(en, float(0))
    const mr = heightAt(e, float(0))
    const bl = heightAt(en, en)
    const bc = heightAt(float(0), en)
    const br = heightAt(e, en)
    const denom = e.mul(8)
    const dHdu = tr
      .add(mr.mul(2))
      .add(br)
      .sub(tl.add(ml.mul(2)).add(bl))
      .div(denom)
      .mul(scale)
    const dHdv = tl
      .add(tc.mul(2))
      .add(tr)
      .sub(bl.add(bc.mul(2)).add(br))
      .div(denom)
      .mul(scale)
    return { dHdu, dHdv }
  }

  const fine = sobel(uBumpOffset, uBumpScale)
  const broad = sobel(uVolumeOffset, uVolumeScale)
  const slopeU = fine.dHdu.add(broad.dHdu)
  const slopeV = fine.dHdv.add(broad.dHdv)

  const dp1 = positionView.dFdx()
  const dp2 = positionView.dFdy()
  const duv1 = uvNode.dFdx()
  const duv2 = uvNode.dFdy()
  const dp2perp = dp2.cross(normalView)
  const dp1perp = normalView.cross(dp1)
  const tangentU = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x))
  const tangentV = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y))
  const invMax = tangentU.dot(tangentU).max(tangentV.dot(tangentV)).inverseSqrt()
  const offsetNormal = tangentU
    .mul(invMax.mul(slopeU).negate())
    .add(tangentV.mul(invMax.mul(slopeV).negate()))
    .add(normalView)
    .normalize()

  // Screen-derivative bump (Mikkelsen): perturb the geometry normal by the
  // screen-space gradient of the displayed luminance. `uScreenStrength` is the
  // dedicated control over its effect. Fades with camera distance by design.
  // dFdx/dFdy are typed for vector nodes only, so promote the scalar height to a
  // vec3 and read one component back.
  const dHdx = dFdx(vec3(lum)).x
  const dHdy = dFdy(vec3(lum)).x
  const sigmaX = positionView.dFdx()
  const sigmaY = positionView.dFdy()
  const r1 = sigmaY.cross(normalView)
  const r2 = normalView.cross(sigmaX)
  const det = sigmaX.dot(r1)
  const surfGrad = r1.mul(dHdx).add(r2.mul(dHdy)).mul(det.sign()).mul(uScreenStrength)
  const screenNormal = normalView.mul(det.abs()).sub(surfGrad).normalize()

  normalNodes = { offset: offsetNormal, screen: screenNormal }

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

export function setVolumeScale(v: number) {
  uVolumeScale.value = v
}

export function setVolumeOffset(v: number) {
  uVolumeOffset.value = v
}

export function setScreenStrength(v: number) {
  uScreenStrength.value = v
}

export function setDirectionalIntensity(v: number) {
  if (!keyLight) return
  keyLight.intensity = v
}
