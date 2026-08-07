import * as THREE from 'three'
import type { CameraState } from '../../../shared/types'

export interface Bounds {
  center: THREE.Vector3
  radius: number
}

export function boundsOf(object: THREE.Object3D): Bounds {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  return { center, radius: Math.max(sphere.radius, 1e-6) }
}

export const DEFAULT_CAMERA: CameraState = {
  az: Math.PI / 4,
  el: Math.PI / 6,
  distR: 2.4,
  target: [0, 0, 0],
}

/** World-space position for a bounds-relative state. */
export function statePosition(state: CameraState, bounds: Bounds): THREE.Vector3 {
  const target = stateTarget(state, bounds)
  const dist = state.distR * bounds.radius
  const dir = new THREE.Vector3(
    Math.sin(state.az) * Math.cos(state.el),
    Math.sin(state.el),
    Math.cos(state.az) * Math.cos(state.el),
  )
  return target.add(dir.multiplyScalar(dist))
}

export function stateTarget(state: CameraState, bounds: Bounds): THREE.Vector3 {
  return new THREE.Vector3(...state.target).multiplyScalar(bounds.radius).add(bounds.center)
}

export function applyState(camera: THREE.PerspectiveCamera, state: CameraState, bounds: Bounds): void {
  const target = stateTarget(state, bounds)
  camera.position.copy(statePosition(state, bounds))
  camera.up.set(0, 1, 0)
  camera.lookAt(target)
  camera.near = bounds.radius / 100
  camera.far = bounds.radius * 100
  camera.updateProjectionMatrix()
}

/** Bounds-relative state from a world-space camera position + target. */
export function captureState(position: THREE.Vector3, target: THREE.Vector3, bounds: Bounds): CameraState {
  const offset = position.clone().sub(target)
  const dist = Math.max(offset.length(), 1e-9)
  const el = Math.asin(THREE.MathUtils.clamp(offset.y / dist, -1, 1))
  const az = Math.atan2(offset.x, offset.z)
  const rel = target.clone().sub(bounds.center).divideScalar(bounds.radius)
  return { az, el, distR: dist / bounds.radius, target: [rel.x, rel.y, rel.z] }
}

