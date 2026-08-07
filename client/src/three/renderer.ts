import * as THREE from 'three'
import type { CameraState } from '../../../shared/types'
import { applyState, boundsOf, DEFAULT_CAMERA } from './camera'

export const THUMB_SIZE = 512

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

export function makeScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(1, 2, 1.5)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-1.5, -0.5, -1)
  scene.add(fill)
  return scene
}

/**
 * Render a model to a 512×512 transparent PNG via an offscreen render target
 * on the shared renderer (never the visible canvas).
 */
export function renderThumbnail(object: THREE.Object3D, state: CameraState = DEFAULT_CAMERA): Promise<Blob> {
  const r = getRenderer()
  const scene = makeScene()
  // scene.add() reparents — the object may belong to a live ViewerSession
  // scene (it is LRU-shared), so its original parent must be restored after.
  const originalParent = object.parent
  scene.add(object)
  const bounds = boundsOf(object)
  const camera = new THREE.PerspectiveCamera(40, 1)
  applyState(camera, state, bounds)

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
    scene.remove(object)
    originalParent?.add(object)
  }

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
