// The index's pose, expressed in this app's camera model. The offset is derived
// from azimuth_zero rather than tabulated (D5); these pin that it lands on the
// six values the current index produces, and that a fault is surfaced.
import { describe, expect, it } from 'vitest'
import type { OrbitAxis } from '../../shared/types'
import { DEFAULT_CAMERA, frameFor, statePosition, boundsOf } from '../src/three/camera'
import { axisOf, cameraForPose, type IndexPose } from '../src/three/pose'
import * as THREE from 'three'

const UP: Record<OrbitAxis, [number, number, number]> = {
  x: [1, 0, 0],
  '-x': [-1, 0, 0],
  y: [0, 1, 0],
  '-y': [0, -1, 0],
  z: [0, 0, 1],
  '-z': [0, 0, -1],
}

/** rotation_to_z_up(up).T @ [1,0,0], the index's own derivation. */
function azimuthZero(up: [number, number, number]): [number, number, number] {
  const v = new THREE.Vector3(...up)
  const z = new THREE.Vector3(0, 0, 1)
  if (v.distanceTo(z) < 1e-9) return [1, 0, 0]
  if (v.clone().add(z).length() < 1e-9) {
    // The antiparallel branch: Rx(pi).
    const m = new THREE.Matrix4().makeRotationX(Math.PI)
    const out = new THREE.Vector3(1, 0, 0).applyMatrix4(m.transpose())
    return [out.x, out.y, out.z]
  }
  const axis = new THREE.Vector3().crossVectors(v, z).normalize()
  const angle = Math.acos(Math.min(1, Math.max(-1, v.dot(z))))
  const m = new THREE.Matrix4().makeRotationAxis(axis, angle)
  const out = new THREE.Vector3(1, 0, 0).applyMatrix4(m.transpose())
  return [out.x, out.y, out.z]
}

function pose(up: [number, number, number], az: number, el: number): IndexPose {
  return {
    up,
    azimuth_zero: azimuthZero(up),
    source: 'siglip',
    confidence: 0.9,
    front: { view: 0, azimuth_deg: az, elevation_deg: el },
  }
}

describe('index pose → camera', () => {
  it('maps the six up axes by exact lookup', () => {
    for (const [axis, up] of Object.entries(UP)) expect(axisOf(up)).toBe(axis)
  })

  it('an up axis outside the six is a fault, not a rounding', () => {
    // A few degrees off is exactly the case a nearest-axis snap would absorb.
    expect(axisOf([0.02, 0.999, 0])).toBeNull()
    expect(cameraForPose(pose([0.02, 0.999, 0], 0, 0), DEFAULT_CAMERA)).toBeNull()
  })

  it('an azimuth_zero not perpendicular to up is malformed, not projected', () => {
    const p = { ...pose(UP.y, 0, 0), azimuth_zero: [0, 1, 0] as [number, number, number] }
    expect(cameraForPose(p, DEFAULT_CAMERA)).toBeNull()
  })

  it('derives the offset the index’s rotation implies — the six current values', () => {
    const expected: Record<OrbitAxis, number> = { z: 0, '-y': 0, '-x': 0, y: 90, '-z': 90, x: -90 }
    for (const [axis, up] of Object.entries(UP) as [OrbitAxis, [number, number, number]][]) {
      const out = cameraForPose(pose(up, 0, 0), DEFAULT_CAMERA)!
      expect(out.axis).toBe(axis)
      expect((out.camera.az * 180) / Math.PI).toBeCloseTo(expected[axis], 6)
    }
  })

  it('a y-up model is framed from the side the index rendered — not a quarter turn off', () => {
    // The mandatory case: y is the library's commonest up axis (1,118 of 2,945)
    // and one of the three the pass-through shortcut gets wrong. Asserted
    // against a known camera direction, never a round-trip, which would pass
    // under any consistent wrong offset.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
    const bounds = boundsOf(mesh)
    const out = cameraForPose(pose(UP.y, 90, 0), DEFAULT_CAMERA)!
    const pos = statePosition(out.camera, bounds, out.axis)
    // Index azimuth 90 about y-up, with its zero at model-space +X: the camera
    // sits on −Z. (Pass-through would put it on +X.)
    expect(pos.x).toBeCloseTo(0, 5)
    expect(pos.z).toBeLessThan(0)
  })

  it('a missing front view keeps the axis and falls back to view 0’s angles', () => {
    const p = { ...pose(UP.y, 0, 0), front: null }
    const out = cameraForPose(p, DEFAULT_CAMERA)!
    expect(out.axis).toBe('y')
    expect(out.camera.el).toBe(0)
    expect(out.camera.distR).toBe(DEFAULT_CAMERA.distR)
  })
})
