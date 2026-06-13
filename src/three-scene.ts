// WebGPU sphere preview. The material is built entirely from the luminance
// texture + uniforms in TSL: the color node derives shadows/highlights from a
// single base color, and the normal node layers two central-difference bump
// passes (fine detail + broad volume) in a Schüler screen-derivative cotangent
// frame, like Mana Blade's BumpNode. Three's built-in bumpMap() is avoided for
// the same reason as there: it forward-differences across one screen pixel and
// fades with camera distance.

import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  NoColorSpace,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from 'three/webgpu'
import { normalView, positionView, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

let renderer: WebGPURenderer | null = null
let scene: Scene
let camera: PerspectiveCamera
let controls: OrbitControls
let keyLight: DirectionalLight
let lumTexture: CanvasTexture | null = null

const uRepeat = uniform(2)
const uBumpScale = uniform(0.02)
const uBumpOffset = uniform(0.003)
const uVolumeScale = uniform(0.04)
const uVolumeOffset = uniform(0.05)
const uBaseColor = uniform(new Color('#a0764b'))
const uDarken = uniform(0.7)
const uLighten = uniform(0.25)
const uShadowHueShift = uniform(0)

function buildColorNode(tex: CanvasTexture) {
  const uvN = uv().mul(uRepeat)
  const lum = texture(tex, uvN).r
  const t = lum.mul(2).sub(1)
  const shadow = t.negate().max(0).mul(uDarken).clamp(0, 1)
  const highlight = t.max(0).mul(uLighten).clamp(0, 1)

  const k = vec3(0.57735, 0.57735, 0.57735)
  const angle = uShadowHueShift.mul(shadow)
  const cosA = angle.cos()
  const sinA = angle.sin()
  const base = vec3(uBaseColor)
  const rotated = base
    .mul(cosA)
    .add(k.cross(base).mul(sinA))
    .add(k.mul(k.dot(base)).mul(cosA.oneMinus()))

  const darkened = rotated.mul(shadow.oneMinus())
  return darkened.add(darkened.oneMinus().mul(highlight))
}

function buildNormalNode(tex: CanvasTexture) {
  const uvN = uv().mul(uRepeat)
  const heightAt = (offset: ReturnType<typeof vec2>) => texture(tex, uvN.add(offset)).r

  const slopesAt = (e: typeof uBumpOffset, scale: typeof uBumpScale) => {
    const span = e.mul(2)
    const dHdu = heightAt(vec2(e, 0))
      .sub(heightAt(vec2(e.negate(), 0)))
      .div(span)
      .mul(scale)
    const dHdv = heightAt(vec2(0, e))
      .sub(heightAt(vec2(0, e.negate())))
      .div(span)
      .mul(scale)
    return { dHdu, dHdv }
  }

  const fine = slopesAt(uBumpOffset, uBumpScale)
  const broad = slopesAt(uVolumeOffset, uVolumeScale)
  const slopeU = fine.dHdu.add(broad.dHdu)
  const slopeV = fine.dHdv.add(broad.dHdv)

  const dp1 = positionView.dFdx()
  const dp2 = positionView.dFdy()
  const duv1 = uvN.dFdx()
  const duv2 = uvN.dFdy()
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

export function initThreeScene(container: HTMLElement, lumCanvas: HTMLCanvasElement) {
  if (renderer) return

  renderer = new WebGPURenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  container.appendChild(renderer.domElement)

  scene = new Scene()
  camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 0, 3)

  scene.add(new AmbientLight(0xffffff, 0.4))
  keyLight = new DirectionalLight(0xffffff, 3)
  keyLight.position.set(2, 2, 3)
  scene.add(keyLight)

  lumTexture = new CanvasTexture(lumCanvas)
  lumTexture.colorSpace = NoColorSpace
  lumTexture.wrapS = lumTexture.wrapT = RepeatWrapping

  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 })
  material.colorNode = buildColorNode(lumTexture)
  material.normalNode = buildNormalNode(lumTexture)

  const sphere = new Mesh(new SphereGeometry(1, 128, 128), material)
  scene.add(sphere)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  void renderer.init().then(() => {
    if (!renderer) return
    renderer.setAnimationLoop(() => {
      if (!renderer) return
      controls.update()
      void renderer.render(scene, camera)
    })
  })

  const resizeObserver = new ResizeObserver(() => {
    if (!renderer) return
    const w = container.clientWidth
    if (w === 0) return
    renderer.setSize(w, w, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(container)
}

export function notifyLuminanceChanged() {
  if (lumTexture) lumTexture.needsUpdate = true
}

export function setTextureRepeat(v: number) {
  uRepeat.value = v
}

export function setLightIntensity(v: number) {
  if (keyLight) keyLight.intensity = v
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

export function setBaseColor(hex: string) {
  uBaseColor.value.set(hex)
}

export function setDarken(v: number) {
  uDarken.value = v
}

export function setLighten(v: number) {
  uLighten.value = v
}

export function setShadowHueShift(radians: number) {
  uShadowHueShift.value = radians
}
