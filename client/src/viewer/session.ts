import * as THREE from 'three'
import type { CameraState } from '../../../shared/types'
import {
  boundsOf,
  DEFAULT_CAMERA,
  statePosition,
  stateTarget,
  type Bounds,
} from '../three/camera'
import { getRenderer, makeScene, renderThumbnail } from '../three/renderer'
import { getOrbitFlip, getOrbitMode, type OrbitMode } from './orbitModes'

const ROT_SPEED = 0.01
const EL_LIMIT = Math.PI / 2 - 0.01
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Turntable frames per orbit mode: spindle `s` (yaw axis, also camera up) and
 * a plane basis (a, b) chosen with a×b = -s so yaw direction feels identical
 * across variants.
 */
const FRAMES: Record<OrbitMode, { s: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3 }> = {
  turntable: {
    s: new THREE.Vector3(0, 1, 0),
    a: new THREE.Vector3(1, 0, 0),
    b: new THREE.Vector3(0, 0, 1),
  },
  'turntable-x': {
    s: new THREE.Vector3(1, 0, 0),
    a: new THREE.Vector3(0, 0, 1),
    b: new THREE.Vector3(0, 1, 0),
  },
  'turntable-z': {
    s: new THREE.Vector3(0, 0, 1),
    a: new THREE.Vector3(0, 1, 0),
    b: new THREE.Vector3(1, 0, 0),
  },
}

/**
 * A live view of one model, driven by the orbit overlay or the lightbox.
 * Clamped turntable around the active mode's spindle axis; camera up is
 * locked to the spindle. The model object belongs to the mesh LRU — close()
 * detaches it, never disposes it.
 */
export class ViewerSession {
  private scene: THREE.Scene
  private camera = new THREE.PerspectiveCamera(40, 1)
  private bounds: Bounds
  private target: THREE.Vector3
  /** Camera position relative to target — the live source of truth. */
  private offset: THREE.Vector3
  private up = WORLD_UP.clone()
  /** Rest state (world-Y az/el) — persisted; approximate for X/Z spindles. */
  state: CameraState

  constructor(
    readonly object: THREE.Object3D,
    initial: CameraState = DEFAULT_CAMERA,
  ) {
    this.scene = makeScene()
    this.scene.add(object)
    this.bounds = boundsOf(object)
    this.state = initial
    this.target = stateTarget(initial, this.bounds)
    this.offset = statePosition(initial, this.bounds).sub(this.target)
    this.camera.near = this.bounds.radius / 100
    this.camera.far = this.bounds.radius * 100
  }

  render(width: number, height: number): void {
    const r = getRenderer()
    r.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.position.copy(this.target).add(this.offset)
    this.camera.up.copy(this.up)
    this.camera.lookAt(this.target)
    this.camera.updateProjectionMatrix()
    r.render(this.scene, this.camera)
  }

  /** Clamped turntable around the active mode's spindle. */
  orbit(dx: number, dy: number): void {
    const frame = FRAMES[getOrbitMode()]
    // Flip negates the spindle; swapping the plane basis keeps a×b = -s, so
    // drag direction feels the same in the flipped frame.
    const s = getOrbitFlip() ? frame.s.clone().negate() : frame.s
    const a = getOrbitFlip() ? frame.b : frame.a
    const b = getOrbitFlip() ? frame.a : frame.b
    const len = this.offset.length()
    const dir = this.offset.clone().divideScalar(len)
    const el = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dir.dot(s), -1, 1)) + dy * ROT_SPEED,
      -EL_LIMIT,
      EL_LIMIT,
    )
    const az = Math.atan2(dir.dot(a), dir.dot(b)) - dx * ROT_SPEED
    this.offset
      .copy(a)
      .multiplyScalar(Math.sin(az) * Math.cos(el))
      .addScaledVector(b, Math.cos(az) * Math.cos(el))
      .addScaledVector(s, Math.sin(el))
      .multiplyScalar(len)
    this.up.copy(s)
  }

  zoom(factor: number): void {
    const len = THREE.MathUtils.clamp(
      this.offset.length() * factor,
      1.1 * this.bounds.radius,
      20 * this.bounds.radius,
    )
    this.offset.setLength(len)
    this.state = { ...this.state, distR: len / this.bounds.radius }
  }

  /**
   * Rebase the persisted rest state to the current view. Never moves the live
   * view. The stored format is world-Y az/el, so for X/Z spindles this is the
   * nearest level approximation (persistence fidelity is settled once a
   * spindle winner is chosen).
   */
  settle(render: () => void = () => {}): Promise<void> {
    const len = this.offset.length()
    const dir = this.offset.clone().divideScalar(len)
    const el = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
      -EL_LIMIT,
      EL_LIMIT,
    )
    const horizontal = Math.hypot(dir.x, dir.z)
    const az = horizontal > 1e-4 ? Math.atan2(dir.x, dir.z) : Math.atan2(-this.up.x, -this.up.z)
    const rel = this.target.clone().sub(this.bounds.center).divideScalar(this.bounds.radius)
    this.state = { az, el, distR: len / this.bounds.radius, target: [rel.x, rel.y, rel.z] }
    render()
    return Promise.resolve()
  }

  /** 512×512 PNG of the rest state. */
  snapshot(): Promise<Blob> {
    return renderThumbnail(this.object, this.state)
  }

  close(): void {
    this.scene.remove(this.object)
  }
}
