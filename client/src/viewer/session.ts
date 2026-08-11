import * as THREE from 'three'
import type { CameraState, OrbitAxis } from '../../../shared/types'
import {
  captureState,
  DEFAULT_CAMERA,
  frameFor,
  rigQuaternion,
  statePosition,
  stateTarget,
  type Bounds,
  type SpindleFrame,
} from '../three/camera'
import { getRenderer, makeScene, renderThumbnail, stageModel } from '../three/renderer'
import { getLightingMode } from './lighting'
import { rimsEnabled } from './rims'

const ROT_SPEED = 0.01
const EL_LIMIT = Math.PI / 2 - 0.01
/** Duration of the axis-change camera tween. */
export const AXIS_TWEEN_MS = 350

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** In-flight axis-change animation: slerp direction and up, lerp length/target. */
interface AxisTween {
  start: number
  fromDir: THREE.Vector3
  fromUp: THREE.Vector3
  fromTarget: THREE.Vector3
  fromLen: number
  dirRot: THREE.Quaternion
  upRot: THREE.Quaternion
  toLen: number
  toTarget: THREE.Vector3
  /** Light-rig orientation endpoints (axis mode, D4). */
  fromRigQ: THREE.Quaternion
  toRigQ: THREE.Quaternion
}

/**
 * A live view of one model, driven by the orbit overlay or the lightbox.
 * Clamped turntable around the model's spindle axis; camera up is locked to
 * the spindle. The model object belongs to the mesh LRU — close() detaches
 * it, never disposes it.
 */
export class ViewerSession {
  private scene: THREE.Scene
  /** Light rig — public so tests can assert its orientation. */
  readonly rig: THREE.Group
  /** Origin-centering group the model hangs from (D1). */
  private pivot: THREE.Group
  private camera = new THREE.PerspectiveCamera(40, 1)
  private bounds: Bounds
  private frame: SpindleFrame
  private target: THREE.Vector3
  /** Camera position relative to target — the live source of truth. */
  private offset: THREE.Vector3
  private up: THREE.Vector3
  private tween: AxisTween | null = null
  private _axis: OrbitAxis
  /** Rest state (spindle-relative az/el) — persisted, exact for every axis. */
  state: CameraState

  constructor(
    readonly object: THREE.Object3D,
    axis: OrbitAxis = 'y',
    initial: CameraState = DEFAULT_CAMERA,
    private readonly now: () => number = () => performance.now(),
  ) {
    const lit = makeScene()
    this.scene = lit.scene
    this.rig = lit.rig
    this.rig.quaternion.copy(rigQuaternion(axis))
    const staged = stageModel(lit, object, axis)
    this.pivot = staged.pivot
    this.bounds = staged.bounds
    this._axis = axis
    this.frame = frameFor(axis)
    this.state = initial
    this.target = stateTarget(initial, this.bounds)
    this.offset = statePosition(initial, this.bounds, axis).sub(this.target)
    this.up = this.frame.s.clone()
    this.camera.near = this.bounds.radius / 100
    this.camera.far = this.bounds.radius * 100
  }

  get axis(): OrbitAxis {
    return this._axis
  }

  get animating(): boolean {
    return this.tween !== null
  }

  render(width: number, height: number): void {
    this.advance()
    const r = getRenderer()
    r.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.position.copy(this.target).add(this.offset)
    this.camera.up.copy(this.up)
    this.camera.lookAt(this.target)
    this.camera.updateProjectionMatrix()
    // Rig orientation per mode (D2): camera space every frame in 'camera'
    // mode; the spindle frame in 'axis' mode, where advance() owns it while a
    // tween is running (D4).
    if (getLightingMode() === 'camera') this.rig.quaternion.copy(this.camera.quaternion)
    else if (this.tween === null) this.rig.quaternion.copy(rigQuaternion(this._axis))
    // SCAFFOLDING: the rim-comparison toggle, live view only — snapshot()
    // goes through renderThumbnail, which builds a fresh full-recipe scene.
    const rims = rimsEnabled()
    for (const light of this.rig.children) if (light.name === 'rim') light.visible = rims
    r.render(this.scene, this.camera)
  }

  /**
   * Move the live pose along the axis tween (per the session clock); snaps
   * and clears when done. render() calls this every frame.
   */
  advance(): void {
    const tw = this.tween
    if (tw === null) return
    const t = THREE.MathUtils.clamp((this.now() - tw.start) / AXIS_TWEEN_MS, 0, 1)
    const e = easeInOutCubic(t)
    const q = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), tw.dirRot, e)
    const dir = tw.fromDir.clone().applyQuaternion(q)
    this.offset.copy(dir).multiplyScalar(THREE.MathUtils.lerp(tw.fromLen, tw.toLen, e))
    const uq = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), tw.upRot, e)
    this.up.copy(tw.fromUp).applyQuaternion(uq)
    this.target.lerpVectors(tw.fromTarget, tw.toTarget, e)
    this.rig.quaternion.slerpQuaternions(tw.fromRigQ, tw.toRigQ, e)
    if (t >= 1) {
      this.tween = null
      this.up.copy(this.frame.s)
    }
  }

  /**
   * Switch the spindle. The rest state jumps straight to the new spindle's
   * default view (so persistence never waits on the animation) while the live
   * pose tweens there — an eased rotation that carries the new axis to
   * screen-up. Called mid-tween it retargets from the current pose.
   */
  setAxis(axis: OrbitAxis): void {
    if (axis === this._axis) return
    this.advance()
    this._axis = axis
    this.frame = frameFor(axis)
    this.state = { ...DEFAULT_CAMERA }
    const toTarget = stateTarget(this.state, this.bounds)
    const toOffset = statePosition(this.state, this.bounds, axis).sub(toTarget)
    const fromLen = this.offset.length()
    const fromDir = this.offset.clone().divideScalar(fromLen)
    const toLen = toOffset.length()
    const toDir = toOffset.divideScalar(toLen)
    this.tween = {
      start: this.now(),
      fromDir,
      fromUp: this.up.clone(),
      fromTarget: this.target.clone(),
      fromLen,
      dirRot: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
      upRot: new THREE.Quaternion().setFromUnitVectors(
        this.up.clone().normalize(),
        this.frame.s,
      ),
      toLen,
      toTarget,
      fromRigQ: this.rig.quaternion.clone(),
      toRigQ: rigQuaternion(axis),
    }
  }

  /** Clamped turntable around the spindle. A drag cancels any axis tween. */
  orbit(dx: number, dy: number): void {
    this.advance() // cancel from the pose of *now*, not the last rendered frame
    if (this.tween !== null) {
      this.tween = null
      this.rig.quaternion.copy(rigQuaternion(this._axis))
    }
    const { s, a, b } = this.frame
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
    this.advance()
    if (this.tween !== null) {
      // Cancelling mid-tween must re-lock up to the spindle — nothing else
      // ever restores it, and a half-slerped up would stick as a permanent
      // camera roll. The rig snaps with it.
      this.tween = null
      this.up.copy(this.frame.s)
      this.rig.quaternion.copy(rigQuaternion(this._axis))
    }
    const len = THREE.MathUtils.clamp(
      this.offset.length() * factor,
      1.1 * this.bounds.radius,
      20 * this.bounds.radius,
    )
    this.offset.setLength(len)
    this.state = { ...this.state, distR: len / this.bounds.radius }
  }

  /**
   * Rebase the persisted rest state to the current view, exactly, in the
   * spindle frame. Never moves the live view. During an axis tween this is a
   * no-op: the rest state is already the tween's end state.
   */
  settle(render: () => void = () => {}): Promise<void> {
    if (this.tween !== null) {
      render()
      return Promise.resolve()
    }
    const position = this.target.clone().add(this.offset)
    const state = captureState(position, this.target, this.bounds, this._axis)
    this.state = { ...state, el: THREE.MathUtils.clamp(state.el, -EL_LIMIT, EL_LIMIT) }
    render()
    return Promise.resolve()
  }

  /** 512×512 PNG of the rest state. */
  snapshot(): Promise<Blob> {
    return renderThumbnail(this.object, this.state, this._axis)
  }

  close(): void {
    this.pivot.remove(this.object)
    // The scene dies with the session; its key light owns a shadow-map
    // texture (D5). The model belongs to the LRU — only detached, above.
    const key = this.rig.getObjectByName('key')
    if (key instanceof THREE.DirectionalLight) key.dispose()
  }
}
