import * as THREE from 'three'
import type { CameraState, OrbitAxis } from '../../../shared/types'
import { getLightingMode } from '../viewer/lighting'
import { applyState, boundsOf, DEFAULT_CAMERA, rigQuaternion, type Bounds } from './camera'
import { encodeSrgbInPlace } from './srgb'

export const THUMB_SIZE = 512

/**
 * Version of the pixel recipe thumbnails are rendered with — bumped whenever
 * rendered output changes for the same input (rig contents, materials, tone
 * mapping). Cached PNGs carrying another (or no) version are re-rendered.
 * 1 = the pre-rim rig (implicit), 2 = red/blue rim accents.
 */
export const RIG_VERSION = 2

/**
 * The app's single WebGL context (design D2/D3): one WebGLRenderer shared by
 * the thumbnail render queue (offscreen render target) and the orbit
 * overlay/lightbox (visible canvas).
 */
let renderer: THREE.WebGLRenderer | null = null

export function getRenderer(): THREE.WebGLRenderer {
  if (renderer === null) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
  }
  return renderer
}

export interface LitScene {
  scene: THREE.Scene
  /** The light rig. Orient via quaternion; identity = the historical world-fixed lighting. */
  rig: THREE.Group
}

export function makeScene(): LitScene {
  const scene = new THREE.Scene()
  const rig = new THREE.Group()
  rig.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(1, 2, 1.5)
  rig.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-1.5, -0.5, -1)
  rig.add(fill)
  // Rim accents: rig-space −X/+X, slightly behind the subject — exact
  // screen-left/right in camera mode, model-fixed in axis mode (D1). Blue
  // carries more intensity: the hemisphere ground already tints the scene
  // cool, so equal intensities read red-dominant.
  const rimRed = new THREE.DirectionalLight(0xff4444, 1.4)
  rimRed.position.set(-1.5, 0.3, -0.6)
  rig.add(rimRed)
  const rimBlue = new THREE.DirectionalLight(0x3355ff, 2.5)
  rimBlue.position.set(1.5, 0.3, -0.6)
  rig.add(rimBlue)
  scene.add(rig)
  return { scene, rig }
}

export interface StagedModel {
  /** Centered bounds: center is the origin, box translated by −rawCenter. */
  bounds: Bounds
  pivot: THREE.Group
}

/**
 * Put a model into a scene the one way every view uses (D4): parent it to a
 * fresh pivot group, measure its raw bounds, then shift the pivot by −center so
 * the model straddles the world origin (D1). Camera state is bounds-relative,
 * so the centering moves no pixels.
 *
 * `_axis` is unused here — later work places a contact floor per spindle axis.
 */
export function stageModel(lit: LitScene, object: THREE.Object3D, _axis: OrbitAxis): StagedModel {
  const pivot = new THREE.Group()
  lit.scene.add(pivot)
  pivot.add(object)
  const raw = boundsOf(object)
  pivot.position.copy(raw.center).negate()
  return {
    bounds: {
      center: new THREE.Vector3(),
      radius: raw.radius,
      box: raw.box.translate(pivot.position),
    },
    pivot,
  }
}

/**
 * Undo a stageModel borrow. three's `add` reparents, so a borrowed object goes
 * home with a plain add; one that had no parent is only detached.
 */
export function unstage(
  object: THREE.Object3D,
  pivot: THREE.Group,
  originalParent: THREE.Object3D | null,
): void {
  if (originalParent === null) pivot.remove(object)
  else originalParent.add(object)
}

/**
 * Render a model to a 512×512 transparent PNG via an offscreen render target
 * on the shared renderer (never the visible canvas).
 */
export function renderThumbnail(
  object: THREE.Object3D,
  state: CameraState = DEFAULT_CAMERA,
  axis: OrbitAxis = 'y',
): Promise<Blob> {
  const r = getRenderer()
  const lit = makeScene()
  const { scene, rig } = lit
  // Staging reparents — the object may belong to a live ViewerSession scene
  // (it is LRU-shared), so its original parent must be restored after.
  const originalParent = object.parent
  const { bounds, pivot } = stageModel(lit, object, axis)
  const camera = new THREE.PerspectiveCamera(40, 1)
  applyState(camera, state, bounds, axis)
  if (getLightingMode() === 'camera') rig.quaternion.copy(camera.quaternion)
  else rig.quaternion.copy(rigQuaternion(axis))

  const target = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, {
    samples: 4,
    depthBuffer: true,
  })
  const prevTarget = r.getRenderTarget()
  const pixels = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 4)
  try {
    r.setRenderTarget(target)
    r.render(scene, camera)
    r.readRenderTargetPixels(target, 0, 0, THUMB_SIZE, THUMB_SIZE, pixels)
  } finally {
    r.setRenderTarget(prevTarget)
    target.dispose()
    unstage(object, pivot, originalParent)
  }

  // Render-target readback is linear; the visible canvas gets sRGB output
  // encoding from the renderer. Encode here so thumbnails match the live view.
  encodeSrgbInPlace(pixels)

  // GL readback is bottom-up; flip rows into ImageData.
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_SIZE
  canvas.height = THUMB_SIZE
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  const image = ctx.createImageData(THUMB_SIZE, THUMB_SIZE)
  const rowBytes = THUMB_SIZE * 4
  for (let y = 0; y < THUMB_SIZE; y++) {
    const src = (THUMB_SIZE - 1 - y) * rowBytes
    image.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes)
  }
  ctx.putImageData(image, 0, 0)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('toBlob failed'))
      else resolve(blob)
    }, 'image/png')
  })
}
