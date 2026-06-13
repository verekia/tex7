// WebGPU sphere preview. The luminance texture drives both the albedo — a
// three-band recolor (dark / mid / light) the artist hand-authors — and the
// bump, all in TSL.
//
// Bump uses Mana Blade's technique: the luminance height is sampled around each
// texel with a 3×3 Sobel stencil (central differences averaged across the
// perpendicular axis — far less texel-grid pixelation than a 2-tap difference)
// and applied in a screen-derivative cotangent frame (Schüler), so strength
// stays stable across camera distance. `bumpOffset` is the slope's sampling
// spacing, `bumpScale` its strength — matching the game's BumpNode.

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
  mix,
  normalView,
  smoothstep,
  texture,
  uniform,
  uv,
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
let materialType: MaterialType = 'lambert'

function buildNodes(tex: CanvasTexture) {
  const uvNode = uv().mul(uRepeat)
  const lum = texture(tex, uvNode).r

  // Three-band recolor: cross-fade dark→mid at the dark pivot and mid→light at
  // the light pivot, each transition `uCrossfade` wide. Authored colors, so the
  // defaults (black / gray / white) read as the raw luminance.
  const toMid = smoothstep(uDarkPivot.sub(uCrossfade), uDarkPivot.add(uCrossfade), lum)
  const toLight = smoothstep(uLightPivot.sub(uCrossfade), uLightPivot.add(uCrossfade), lum)
  const colorNode = mix(mix(uDarkColor, uMidColor, toMid), uLightColor, toLight)

  // Experiment: hand the luminance straight to Three's built-in bumpMap node and
  // let it do the height→normal conversion (Mikkelsen screen-space forward
  // differencing). `bumpScale` is its intensity; `bumpOffset` no longer applies
  // since Three samples the height at the screen-space UV derivative, not a fixed
  // texel offset.
  const normalNode = bumpMap(texture(tex, uvNode), uBumpScale)

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

export function setDirectionalIntensity(v: number) {
  if (!keyLight) return
  keyLight.intensity = v
}
