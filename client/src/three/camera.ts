import * as THREE from 'three'
import type { CameraState, OrbitAxis } from '../../../shared/types'

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
 * Turntable frame per spindle axis: `s` is the spindle (yaw axis, also camera
 * up); (a, b) span the yaw plane, chosen with a×b = −s so a rightward drag
 * spins the same visual direction under every spindle. Negated axes swap
 * (a, b), which preserves the invariant. The 'y' frame reproduces the
 * historical world-Y az/el exactly.
 */
const FRAMES: Record<OrbitAxis, SpindleFrame> = {
  y: { s: new THREE.Vector3(0, 1, 0), a: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 0, 1) },
  '-y': { s: new THREE.Vector3(0, -1, 0), a: new THREE.Vector3(0, 0, 1), b: new THREE.Vector3(1, 0, 0) },
  x: { s: new THREE.Vector3(1, 0, 0), a: new THREE.Vector3(0, 0, 1), b: new THREE.Vector3(0, 1, 0) },
  '-x': { s: new THREE.Vector3(-1, 0, 0), a: new THREE.Vector3(0, 1, 0), b: new THREE.Vector3(0, 0, 1) },
  z: { s: new THREE.Vector3(0, 0, 1), a: new THREE.Vector3(0, 1, 0), b: new THREE.Vector3(1, 0, 0) },
  '-z': { s: new THREE.Vector3(0, 0, -1), a: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 1, 0) },
}

export function frameFor(axis: OrbitAxis): SpindleFrame {
  return FRAMES[axis]
}

/**
 * Light-rig orientation for a spindle: maps x̂→a, ŷ→s, ẑ→b. The frame
 * invariant a×b = −s makes this a proper rotation for every spindle, and the
 * 'y' frame gives the identity — default-axis models keep the historical
 * world-fixed lighting.
 */
export function rigQuaternion(axis: OrbitAxis): THREE.Quaternion {
  const { s, a, b } = frameFor(axis)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, s, b))
}

/** Unit view direction (target → camera) for spindle-relative az/el. */
function stateDirection(state: CameraState, frame: SpindleFrame): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(frame.a, Math.sin(state.az) * Math.cos(state.el))
    .addScaledVector(frame.b, Math.cos(state.az) * Math.cos(state.el))
    .addScaledVector(frame.s, Math.sin(state.el))
}

/** World-space position for a bounds- and spindle-relative state. */
export function statePosition(state: CameraState, bounds: Bounds, axis: OrbitAxis = 'y'): THREE.Vector3 {
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
  axis: OrbitAxis = 'y',
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
  axis: OrbitAxis = 'y',
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
