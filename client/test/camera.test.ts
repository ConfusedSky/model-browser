import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { CameraState, OrbitAxis } from '../../shared/types'
import {
  applyState,
  boundsOf,
  captureState,
  frameFor,
  rigQuaternion,
  statePosition,
  stateTarget,
  type Bounds,
} from '../src/three/camera'

const STATE: CameraState = { az: 0.8, el: 0.4, distR: 3, target: [0.1, -0.2, 0.05] }
const AXES: OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']

function roundTrip(state: CameraState, bounds: Bounds, axis?: OrbitAxis): CameraState {
  const pos = statePosition(state, bounds, axis)
  const target = stateTarget(state, bounds)
  return captureState(pos, target, bounds, axis)
}

function expectClose(a: CameraState, b: CameraState): void {
  expect(a.az).toBeCloseTo(b.az, 6)
  expect(a.el).toBeCloseTo(b.el, 6)
  expect(a.distR).toBeCloseTo(b.distR, 6)
  for (let i = 0; i < 3; i++) expect(a.target[i]).toBeCloseTo(b.target[i]!, 6)
}

describe('bounds-relative camera state', () => {
  it('capture(apply(state)) round-trips', () => {
    const bounds: Bounds = { center: new THREE.Vector3(5, 2, -3), radius: 7 }
    expectClose(roundTrip(STATE, bounds), STATE)
  })

  it('survives a re-scaled re-export: same state, different bounds → same view', () => {
    const mm: Bounds = { center: new THREE.Vector3(10, 0, 0), radius: 25.4 }
    const inches: Bounds = { center: new THREE.Vector3(0.39, 0, 0), radius: 1 }

    // The state is unit-free: capturing from either sized world recovers it.
    expectClose(roundTrip(STATE, mm), STATE)
    expectClose(roundTrip(STATE, inches), STATE)

    // And the framing is identical: distance-to-target scales with the radius.
    const posMm = statePosition(STATE, mm)
    const posIn = statePosition(STATE, inches)
    expect(posMm.distanceTo(stateTarget(STATE, mm)) / mm.radius).toBeCloseTo(
      posIn.distanceTo(stateTarget(STATE, inches)) / inches.radius,
      6,
    )
  })

  it('applyState aims the camera at the state target', () => {
    const bounds: Bounds = { center: new THREE.Vector3(0, 0, 0), radius: 2 }
    const camera = new THREE.PerspectiveCamera(40, 1)
    applyState(camera, STATE, bounds)
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    const toTarget = stateTarget(STATE, bounds).sub(camera.position).normalize()
    expect(forward.dot(toTarget)).toBeCloseTo(1, 5)
  })

  it('capture(apply(state)) round-trips under every spindle axis', () => {
    const bounds: Bounds = { center: new THREE.Vector3(5, 2, -3), radius: 7 }
    for (const axis of AXES) expectClose(roundTrip(STATE, bounds, axis), STATE)
  })

  it('spindle round-trip survives a re-scaled re-export', () => {
    const mm: Bounds = { center: new THREE.Vector3(10, 0, 0), radius: 25.4 }
    const inches: Bounds = { center: new THREE.Vector3(0.39, 0, 0), radius: 1 }
    for (const axis of AXES) {
      expectClose(roundTrip(STATE, mm, axis), STATE)
      expectClose(roundTrip(STATE, inches, axis), STATE)
    }
  })

  it('the default axis reproduces the historical world-Y representation', () => {
    const bounds: Bounds = { center: new THREE.Vector3(1, 2, 3), radius: 4 }
    const legacy = statePosition(STATE, bounds) // axis omitted
    const explicit = statePosition(STATE, bounds, 'y')
    expect(legacy.distanceTo(explicit)).toBeLessThan(1e-9)
    // The world-Y formula the client used before spindle frames existed:
    const dist = STATE.distR * bounds.radius
    const manual = stateTarget(STATE, bounds).add(
      new THREE.Vector3(
        Math.sin(STATE.az) * Math.cos(STATE.el),
        Math.sin(STATE.el),
        Math.cos(STATE.az) * Math.cos(STATE.el),
      ).multiplyScalar(dist),
    )
    expect(explicit.distanceTo(manual)).toBeLessThan(1e-9)
  })

  it('every frame satisfies a×b = −s with unit vectors (consistent drag feel)', () => {
    for (const axis of AXES) {
      const { s, a, b } = frameFor(axis)
      expect(new THREE.Vector3().crossVectors(a, b).distanceTo(s.clone().negate())).toBeLessThan(1e-12)
      for (const v of [s, a, b]) expect(v.length()).toBeCloseTo(1, 12)
    }
  })

  it('applyState locks camera up to the spindle', () => {
    const bounds: Bounds = { center: new THREE.Vector3(0, 0, 0), radius: 2 }
    for (const axis of AXES) {
      const camera = new THREE.PerspectiveCamera(40, 1)
      applyState(camera, STATE, bounds, axis)
      expect(camera.up.distanceTo(frameFor(axis).s)).toBeLessThan(1e-12)
    }
  })

  it('boundsOf centers a mesh and finds a positive radius', () => {
    const geom = new THREE.BoxGeometry(2, 2, 2)
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial())
    mesh.position.set(10, 10, 10)
    mesh.updateMatrixWorld()
    const bounds = boundsOf(mesh)
    expect(bounds.center.x).toBeCloseTo(10, 5)
    expect(bounds.radius).toBeGreaterThan(0)
  })
})

describe('rigQuaternion', () => {
  it('maps the world basis onto every spindle frame as a proper rotation', () => {
    for (const axis of AXES) {
      const q = rigQuaternion(axis)
      const { s, a, b } = frameFor(axis)
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).distanceTo(s)).toBeLessThan(1e-12)
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(q).distanceTo(a)).toBeLessThan(1e-12)
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).distanceTo(b)).toBeLessThan(1e-12)
    }
  })

  it('is the identity for the default y spindle (historical lighting preserved)', () => {
    const q = rigQuaternion('y')
    expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-12)
  })
})
