import * as THREE from "three";
import type { CameraState, OrbitAxis } from "../../../shared/types";
import {
  captureState,
  DEFAULT_CAMERA,
  frameFor,
  statePosition,
  stateTarget,
  type Bounds,
  type SpindleFrame,
} from "../three/camera";
import {
  getLiveChain,
  getRenderer,
  makeScene,
  placeFloor,
  renderThumbnail,
  stageModel,
} from "../three/renderer";
import { aoEnabled } from "./aoToggle";

const ROT_SPEED = 0.01;
const EL_LIMIT = Math.PI / 2 - 0.01;
export const AXIS_TWEEN_MS = 350;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Slerp direction and up, lerp length and target. */
interface AxisTween {
  start: number;
  fromDir: THREE.Vector3;
  fromUp: THREE.Vector3;
  fromTarget: THREE.Vector3;
  fromLen: number;
  dirRot: THREE.Quaternion;
  upRot: THREE.Quaternion;
  toLen: number;
  toTarget: THREE.Vector3;
}

/** A live view of one model: a clamped turntable about its spindle, with camera
 *  up locked to it. The model belongs to the mesh LRU — `close()` detaches it,
 *  never disposes it. */
export class ViewerSession {
  private scene: THREE.Scene;
  /** Public so tests can assert its orientation. */
  readonly rig: THREE.Group;
  private pivot: THREE.Group;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private camera = new THREE.PerspectiveCamera(40, 1);
  private bounds: Bounds;
  private frame: SpindleFrame;
  private target: THREE.Vector3;
  /** The live source of truth. */
  private offset: THREE.Vector3;
  private up: THREE.Vector3;
  private tween: AxisTween | null = null;
  private _axis: OrbitAxis;
  /** Spindle-relative, and what is persisted. */
  state: CameraState;

  constructor(
    readonly object: THREE.Object3D,
    axis: OrbitAxis,
    initial: CameraState = DEFAULT_CAMERA,
    private readonly now: () => number = () => performance.now(),
  ) {
    const lit = makeScene();
    this.scene = lit.scene;
    this.rig = lit.rig;
    const staged = stageModel(lit, object, axis);
    this.pivot = staged.pivot;
    this.bounds = staged.bounds;
    this.floor = staged.floor;
    this._axis = axis;
    this.frame = frameFor(axis);
    this.state = initial;
    this.target = stateTarget(initial, this.bounds);
    this.offset = statePosition(initial, this.bounds, axis).sub(this.target);
    this.up = this.frame.s.clone();
    this.camera.near = this.bounds.radius / 100;
    this.camera.far = this.bounds.radius * 100;
  }

  get axis(): OrbitAxis {
    return this._axis;
  }

  get animating(): boolean {
    return this.tween !== null;
  }

  render(width: number, height: number): void {
    this.advance();
    const r = getRenderer();
    r.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    // Fixed in camera space, so the lit side follows the viewer whatever the
    // spindle, and an axis change stays continuous for free (D1).
    this.rig.quaternion.copy(this.camera.quaternion);
    // Never a direct `renderer.render`: occlusion lives in the shared chain
    // (D1). The one place this session reads the AO preference itself — a live
    // frame has no cache slot to disagree with, where `snapshot` does (D4a).
    getLiveChain(width, height).render(
      this.scene,
      this.camera,
      this.bounds,
      aoEnabled(),
    );
  }

  /** Snaps and clears when done; `render` calls it every frame. */
  advance(): void {
    const tw = this.tween;
    if (tw === null) return;
    const t = THREE.MathUtils.clamp(
      (this.now() - tw.start) / AXIS_TWEEN_MS,
      0,
      1,
    );
    const e = easeInOutCubic(t);
    const q = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion(),
      tw.dirRot,
      e,
    );
    const dir = tw.fromDir.clone().applyQuaternion(q);
    this.offset
      .copy(dir)
      .multiplyScalar(THREE.MathUtils.lerp(tw.fromLen, tw.toLen, e));
    const uq = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion(),
      tw.upRot,
      e,
    );
    this.up.copy(tw.fromUp).applyQuaternion(uq);
    this.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (t >= 1) {
      this.tween = null;
      this.up.copy(this.frame.s);
    }
  }

  /** An index-supplied orientation is a default, not a decision: a session
   *  opened at one and closed untouched must leave no camera behind, or the
   *  index's opinion outranks the re-classification that would correct it
   *  (semantic-search D5). */
  private manipulated = false;

  get everManipulated(): boolean {
    return this.manipulated;
  }

  /** The rest state jumps to the new spindle's default while the live pose
   *  tweens there, so persistence never waits on the animation. */
  setAxis(axis: OrbitAxis): void {
    this.manipulated = true;
    if (axis === this._axis) return;
    this.tweenTo(DEFAULT_CAMERA, axis);
  }

  /**
   * The panel's *reset framing* (entry-context-menu D7), which is why it **gives
   * up the session's claim**: what is installed here is precisely not the user's
   * orientation, and left standing, an orbit made before the reset would have the
   * close write that orbit back over the discard.
   *
   * The axis picker's own tween, not a snap: a reset can change the spindle, and
   * one without the rotation carrying the new axis to screen-up is illegible.
   */
  reframe(state: CameraState, axis: OrbitAxis): void {
    this.tweenTo(state, axis);
    this.manipulated = false;
  }

  /** Retarget from the pose of now, adopt the spindle, ease there. */
  private tweenTo(state: CameraState, axis: OrbitAxis): void {
    this.advance();
    this._axis = axis;
    this.frame = frameFor(axis);
    // The floor snaps while the camera tweens: an eased one reads as the
    // resting face interpolating, which means nothing (D3).
    placeFloor(this.floor, this.bounds, axis);
    this.state = { ...state };
    const toTarget = stateTarget(this.state, this.bounds);
    const toOffset = statePosition(this.state, this.bounds, axis).sub(toTarget);
    const fromLen = this.offset.length();
    const fromDir = this.offset.clone().divideScalar(fromLen);
    const toLen = toOffset.length();
    const toDir = toOffset.divideScalar(toLen);
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
    };
  }

  /** Clamped turntable around the spindle. A drag cancels any axis tween. */
  orbit(dx: number, dy: number): void {
    this.manipulated = true;
    this.advance(); // from the pose of *now*, not the last rendered frame
    this.tween = null;
    const { s, a, b } = this.frame;
    const len = this.offset.length();
    const dir = this.offset.clone().divideScalar(len);
    const el = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dir.dot(s), -1, 1)) + dy * ROT_SPEED,
      -EL_LIMIT,
      EL_LIMIT,
    );
    const az = Math.atan2(dir.dot(a), dir.dot(b)) - dx * ROT_SPEED;
    this.offset
      .copy(a)
      .multiplyScalar(Math.sin(az) * Math.cos(el))
      .addScaledVector(b, Math.cos(az) * Math.cos(el))
      .addScaledVector(s, Math.sin(el))
      .multiplyScalar(len);
    this.up.copy(s);
  }

  zoom(factor: number): void {
    this.manipulated = true;
    this.advance();
    if (this.tween !== null) {
      // Nothing else restores `up`, and a half-slerped one sticks as a
      // permanent camera roll.
      this.tween = null;
      this.up.copy(this.frame.s);
    }
    const len = THREE.MathUtils.clamp(
      this.offset.length() * factor,
      1.1 * this.bounds.radius,
      20 * this.bounds.radius,
    );
    this.offset.setLength(len);
    this.state = { ...this.state, distR: len / this.bounds.radius };
  }

  /** Rebase the rest state to the current view; never moves the live view. A
   *  no-op mid-tween, where the rest state is already the end state. */
  settle(render: () => void = () => {}): Promise<void> {
    if (this.tween !== null) {
      render();
      return Promise.resolve();
    }
    const position = this.target.clone().add(this.offset);
    const state = captureState(position, this.target, this.bounds, this._axis);
    this.state = {
      ...state,
      el: THREE.MathUtils.clamp(state.el, -EL_LIMIT, EL_LIMIT),
    };
    render();
    return Promise.resolve();
  }

  /**
   * `ao` is the caller's, never this session's own read — the one place
   * `render` and `snapshot` deliberately differ, so the pixels and the slot
   * they are filed under cannot come from two readings a toggle fell between
   * (D4a). Required, so no caller can inherit a default recipe.
   */
  snapshot(ao: boolean): Promise<Blob> {
    return renderThumbnail(this.object, this.state, this._axis, ao);
  }

  close(): void {
    this.pivot.remove(this.object);
    // **Dispose what this session made**: shadow maps and the floor's
    // geometry/material are VRAM (D5). Every directional light, so no future
    // caster is missed. The model belongs to the LRU — detached, above.
    for (const light of this.rig.children) {
      if (light instanceof THREE.DirectionalLight) light.dispose();
    }
    this.floor.geometry.dispose();
    this.floor.material.dispose();
  }
}
