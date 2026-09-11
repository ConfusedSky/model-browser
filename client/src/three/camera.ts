import * as THREE from 'three'
import type { CameraState, OrbitAxis } from '../../../shared/types'
import { FILE_FRAMES, SCENE_FRAMES, type FrameTriples } from '../../../shared/frames'
import { legacyBake } from './bakeToggle'

export { defaultAxisFor } from '../../../shared/frames'

export interface Bounds {
  center: THREE.Vector3
  radius: number
  /** The measured box — translated alongside the model when it is staged (D1). */
  box: THREE.Box3
}

export function boundsOf(object: THREE.Object3D): Bounds {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  return { center, radius: Math.max(sphere.radius, 1e-6), box }
}

export const DEFAULT_CAMERA: CameraState = {
  az: Math.PI / 4,
  el: Math.PI / 6,
  distR: 2.4,
  target: [0, 0, 0],
}

export interface SpindleFrame {
  s: THREE.Vector3
  a: THREE.Vector3
  b: THREE.Vector3
}

/**
 * Turntable frame per spindle axis, in the model file's own coordinates:
 * `s` is the spindle (yaw axis, also camera up); (a, b) span the yaw plane,
 * chosen with a×b = −s so a rightward drag spins the same visual direction
 * under every spindle. The table is `FILE_FRAMES` (shared/frames.ts) lifted
 * into `Vector3`s — the derivation from the pre-bake scene table lives there,
 * not here. The 'y' frame is unchanged from that scene table, so an OBJ at the
 * default reads exactly as it always did.
 */
const FRAMES: Record<OrbitAxis, SpindleFrame> = lift(FILE_FRAMES)

/**
 * TEMPORARY — the compare pill's legacy lookup (`file-frame-spindle` D7): the
 * pre-bake scene table lifted the same way, selected while `legacyBake()` is
 * on. Deleted with the pill by task 5.2; `SCENE_FRAMES` itself stays, since
 * `migrateAxis` and `swapOffset` derive from it.
 */
const LEGACY_FRAMES: Record<OrbitAxis, SpindleFrame> = lift(SCENE_FRAMES)

function lift(table: Record<OrbitAxis, FrameTriples>): Record<OrbitAxis, SpindleFrame> {
  return Object.fromEntries(
    (Object.entries(table) as [OrbitAxis, FrameTriples][]).map(([axis, { s, a, b }]) => [
      axis,
      { s: new THREE.Vector3(...s), a: new THREE.Vector3(...a), b: new THREE.Vector3(...b) },
    ]),
  ) as Record<OrbitAxis, SpindleFrame>
}

export function frameFor(axis: OrbitAxis): SpindleFrame {
  // TEMPORARY branch on the pill's flag (D7), deleted by task 5.2.
  return legacyBake() ? LEGACY_FRAMES[axis] : FRAMES[axis]
}

/** Unit view direction (target → camera) for spindle-relative az/el. */
function stateDirection(state: CameraState, frame: SpindleFrame): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(frame.a, Math.sin(state.az) * Math.cos(state.el))
    .addScaledVector(frame.b, Math.cos(state.az) * Math.cos(state.el))
    .addScaledVector(frame.s, Math.sin(state.el))
}

/** World-space position for a bounds- and spindle-relative state. */
export function statePosition(state: CameraState, bounds: Bounds, axis: OrbitAxis): THREE.Vector3 {
  const target = stateTarget(state, bounds)
  const dist = state.distR * bounds.radius
  return target.add(stateDirection(state, frameFor(axis)).multiplyScalar(dist))
}

export function stateTarget(state: CameraState, bounds: Bounds): THREE.Vector3 {
  return new THREE.Vector3(...state.target).multiplyScalar(bounds.radius).add(bounds.center)
}

export function applyState(
  camera: THREE.PerspectiveCamera,
  state: CameraState,
  bounds: Bounds,
  axis: OrbitAxis,
): void {
  const target = stateTarget(state, bounds)
  camera.position.copy(statePosition(state, bounds, axis))
  camera.up.copy(frameFor(axis).s)
  camera.lookAt(target)
  camera.near = bounds.radius / 100
  camera.far = bounds.radius * 100
  camera.updateProjectionMatrix()
}

/** Bounds- and spindle-relative state from a world-space position + target. */
export function captureState(
  position: THREE.Vector3,
  target: THREE.Vector3,
  bounds: Bounds,
  axis: OrbitAxis,
): CameraState {
  const { s, a, b } = frameFor(axis)
  const offset = position.clone().sub(target)
  const dist = Math.max(offset.length(), 1e-9)
  const dir = offset.divideScalar(dist)
  const el = Math.asin(THREE.MathUtils.clamp(dir.dot(s), -1, 1))
  const az = Math.atan2(dir.dot(a), dir.dot(b))
  const rel = target.clone().sub(bounds.center).divideScalar(bounds.radius)
  return { az, el, distR: dist / bounds.radius, target: [rel.x, rel.y, rel.z] }
}
