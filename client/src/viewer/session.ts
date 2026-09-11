import * as THREE from 'three'
import type { CameraState, OrbitAxis } from '../../../shared/types'
import {
  captureState,
  DEFAULT_CAMERA,
  frameFor,
  statePosition,
  stateTarget,
  type Bounds,
  type SpindleFrame,
} from '../three/camera'
import {
  getLiveChain,
  getRenderer,
  makeScene,
  placeFloor,
  renderThumbnail,
  stageModel,
} from '../three/renderer'
import { aoEnabled } from './aoToggle'

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
  /** Contact floor, snapped to the spindle's resting face (D3). */
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
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
    axis: OrbitAxis,
    initial: CameraState = DEFAULT_CAMERA,
    private readonly now: () => number = () => performance.now(),
  ) {
    const lit = makeScene()
    this.scene = lit.scene
    this.rig = lit.rig
    const staged = stageModel(lit, object, axis)
    this.pivot = staged.pivot
    this.bounds = staged.bounds
    this.floor = staged.floor
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
    // The rig is fixed in camera space, every frame and unconditionally (D1):
    // the lit side follows the viewer whatever the spindle. An axis change
    // stays continuous for free — the camera is what tweens, and the rig copies
    // it, so there is nothing left for the tween to animate here.
    this.rig.quaternion.copy(this.camera.quaternion)
    // Never a direct renderer.render: ambient occlusion lives in the shared
    // live chain, which sizes itself to this host only when it actually
    // changed and re-points its passes at this scene every frame (D1).
    // The one place this session reads the preference *itself*. Thumbnails see
    // it too since `ao-as-recipe-dimension` — occlusion is a key dimension and
    // a render is filed under the recipe that drew it — but they are never
    // handed this read: `snapshot` takes the value from its caller, so the
    // pixels and the slot cannot come from two readings a toggle fell between
    // (D4a). A live frame has no slot to disagree with, which is why it may
    // read the store and repaint on the spot.
    getLiveChain(width, height).render(this.scene, this.camera, this.bounds, aoEnabled())
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
    if (t >= 1) {
      this.tween = null
      this.up.copy(this.frame.s)
    }
  }

  /**
   * Whether the user has moved this view. An index-supplied orientation is a
   * default, not a decision: a session opened at one and closed untouched must
   * leave no camera behind, or the index's opinion becomes the user's stored
   * orientation after a single open — durably, invisibly, and thereafter
   * winning over the very re-classification that would correct it
   * (semantic-search D5).
   */
  private manipulated = false

  get everManipulated(): boolean {
    return this.manipulated
  }

  /**
   * Switch the spindle. The rest state jumps straight to the new spindle's
   * default view (so persistence never waits on the animation) while the live
   * pose tweens there — an eased rotation that carries the new axis to
   * screen-up. Called mid-tween it retargets from the current pose.
   */
  setAxis(axis: OrbitAxis): void {
    this.manipulated = true
    if (axis === this._axis) return
    this.tweenTo(DEFAULT_CAMERA, axis)
  }

  /**
   * Re-frame this live view to `state` about `axis` — the lightbox panel's
   * *reset framing* (entry-context-menu D7's margin), which is why it also
   * gives up the session's claim on the orientation.
   *
   * The claim is the point. `everManipulated` is what the closing persist reads
   * to decide whether this view records a decision worth storing, and the
   * orientation being installed here is precisely *not* the user's — it is what
   * the model resolves to now that theirs has been discarded. Left standing, an
   * orbit made before the reset would have the close write that orbit back over
   * the discard, which is the race that keeps this command off the right-click
   * menu (`LIGHTBOX_MENU_EXCLUDES`).
   *
   * The move is the axis picker's own tween, not a snap: a reset can change the
   * spindle, and a spindle change made without the animated rotation that
   * carries the new axis to screen-up is the illegible outcome D7 rejects.
   */
  reframe(state: CameraState, axis: OrbitAxis): void {
    this.tweenTo(state, axis)
    this.manipulated = false
  }

  /**
   * The shared body of every programmatic move: retarget from the pose of now,
   * adopt the spindle, and ease the live camera to `state` while the rest state
   * jumps there at once (so persistence never waits on the animation).
   */
  private tweenTo(state: CameraState, axis: OrbitAxis): void {
    this.advance()
    this._axis = axis
    this.frame = frameFor(axis)
    // The floor snaps while the camera tweens: an eased floor would read as
    // the model's resting face interpolating, which means nothing (D3).
    placeFloor(this.floor, this.bounds, axis)
    this.state = { ...state }
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
    }
  }

  /** Clamped turntable around the spindle. A drag cancels any axis tween. */
  orbit(dx: number, dy: number): void {
    this.manipulated = true
    this.advance() // cancel from the pose of *now*, not the last rendered frame
    this.tween = null
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
    this.manipulated = true
    this.advance()
    if (this.tween !== null) {
      // Cancelling mid-tween must re-lock up to the spindle — nothing else
      // ever restores it, and a half-slerped up would stick as a permanent
      // camera roll.
      this.tween = null
      this.up.copy(this.frame.s)
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

  /**
   * `THUMB_SIZE`² WebP of the rest state.
   *
   * `ao` is the caller's, never this session's own `aoEnabled()` read — the
   * one place `render` and `snapshot` deliberately differ. `App.tsx`'s
   * `persist` captures the preference beside `state` and `axis` before its
   * await and hands the same value to this and to its PUT, so the pixels and
   * the slot they are filed under cannot come from two readings a toggle
   * happened to fall between (D4a).
   *
   * **Required, and that is the point.** It defaulted to `true` — "what every
   * snapshot was before occlusion became a key dimension" — which stopped being
   * true when `ao-default-off` flipped the unset read, leaving a default that
   * contradicted the shipped one. A caller that omitted it would have filed
   * occluded pixels while the app was unoccluded, under whichever slot the PUT
   * named. There is one caller and it has always passed the value; making the
   * parameter required is how the next one cannot inherit the old answer.
   */
  snapshot(ao: boolean): Promise<Blob> {
    return renderThumbnail(this.object, this.state, this._axis, ao)
  }

  close(): void {
    this.pivot.remove(this.object)
    // The scene dies with the session; its key light owns a shadow-map texture
    // (D5). Every directional light is disposed — same rule as
    // renderThumbnail's teardown — so no future caster can be missed here. The
    // floor owns geometry/material. The model belongs to the LRU — only
    // detached, above.
    for (const light of this.rig.children) {
      if (light instanceof THREE.DirectionalLight) light.dispose()
    }
    this.floor.geometry.dispose()
    this.floor.material.dispose()
  }
}
