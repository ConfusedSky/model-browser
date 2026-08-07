import * as THREE from 'three'
import type { CameraState } from '../../../shared/types'
import {
  applyState,
  boundsOf,
  DEFAULT_CAMERA,
  orbitState,
  zoomState,
  type Bounds,
} from '../three/camera'
import { getRenderer, makeScene, renderThumbnail } from '../three/renderer'

/**
 * A live view of one model, driven by the orbit overlay or the lightbox. Owns
 * the scene and bounds-relative camera state; renders on the shared renderer's
 * visible canvas. The model object belongs to the mesh LRU — close() detaches
 * it, never disposes it.
 */
export class ViewerSession {
  private scene: THREE.Scene
  private camera = new THREE.PerspectiveCamera(40, 1)
  private bounds: Bounds
  state: CameraState

  constructor(
    readonly object: THREE.Object3D,
    initial: CameraState = DEFAULT_CAMERA,
  ) {
    this.scene = makeScene()
    this.scene.add(object)
    this.bounds = boundsOf(object)
    this.state = initial
  }

  render(width: number, height: number): void {
    const r = getRenderer()
    r.setSize(width, height, false)
    this.camera.aspect = width / height
    applyState(this.camera, this.state, this.bounds)
    r.render(this.scene, this.camera)
  }

  orbit(dx: number, dy: number): void {
    this.state = orbitState(this.state, dx, dy)
  }

  zoom(factor: number): void {
    this.state = zoomState(this.state, factor)
  }

  /** 512×512 PNG of the current view. */
  async snapshot(): Promise<Blob> {
    const blob = await renderThumbnail(this.object, this.state)
    this.scene.add(this.object) // renderThumbnail borrows the object into its own scene
    return blob
  }

  close(): void {
    this.scene.remove(this.object)
  }
}
