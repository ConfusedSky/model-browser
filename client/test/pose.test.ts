// The index's pose, expressed in this app's camera model.
//
// Two transforms have to compose correctly and neither is visible in the
// numbers on the wire: the index measures its angles after rotating the mesh so
// `up` points at +Z, and this app's STL loader bakes `rotateX(-π/2)` into every
// mesh (file is Z-up, the scene is Y-up). Getting either wrong renders a model
// lying down, which is exactly what shipped before these tests existed.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { OrbitAxis } from '../../shared/types'
import { boundsOf, DEFAULT_CAMERA, statePosition } from '../src/three/camera'
import { axisOf, cameraForPose, type IndexPose } from '../src/three/pose'

const UP: Record<string, [number, number, number]> = {
  x: [1, 0, 0],
  '-x': [-1, 0, 0],
  y: [0, 1, 0],
  '-y': [0, -1, 0],
  z: [0, 0, 1],
  '-z': [0, 0, -1],
}

/** `rotation_to_z_up` from the index (src/pose.py), ported. */
function rotationToZUp(up: [number, number, number]): THREE.Matrix4 {
  const v = new THREE.Vector3(...up)
  const z = new THREE.Vector3(0, 0, 1)
  if (v.distanceTo(z) < 1e-9) return new THREE.Matrix4()
  if (v.clone().add(z).length() < 1e-9) return new THREE.Matrix4().makeRotationX(Math.PI)
  const axis = new THREE.Vector3().crossVectors(v, z).normalize()
  return new THREE.Matrix4().makeRotationAxis(axis, Math.acos(Math.min(1, Math.max(-1, v.dot(z)))))
}

/** The index publishes this: the model-space direction its azimuth 0 is from. */
function azimuthZero(up: [number, number, number]): [number, number, number] {
  const o = new THREE.Vector3(1, 0, 0).applyMatrix4(rotationToZUp(up).clone().transpose())
  return [o.x, o.y, o.z]
}

/** Where the index's camera sits, in *file* space, for one of its views. */
function indexCameraDirection(up: [number, number, number], azDeg: number, elDeg: number) {
  const az = (azDeg * Math.PI) / 180
  const el = (elDeg * Math.PI) / 180
  const inZUp = new THREE.Vector3(
    Math.cos(az) * Math.cos(el),
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
  )
  return inZUp.applyMatrix4(rotationToZUp(up).clone().transpose())
}

/** models.ts bakes rotateX(-π/2) into STL geometry: file (x,y,z) → scene (x,z,-y). */
const toScene = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(v.x, v.z, -v.y)

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
  it('maps a file up axis to the spindle it becomes in the scene', () => {
    // The bug this pins: a file Y-up model was mapped to the `y` spindle, which
    // in the scene is 90° from its actual up, so it rendered lying down.
    expect(axisOf(UP.y!)).toBe('-z')
    expect(axisOf(UP.z!)).toBe('y')
    expect(axisOf(UP['-y']!)).toBe('z')
    expect(axisOf(UP['-z']!)).toBe('-y')
    expect(axisOf(UP.x!)).toBe('x')
    expect(axisOf(UP['-x']!)).toBe('-x')
  })

  it('an up axis outside the six is a fault, not a rounding', () => {
    expect(axisOf([0.02, 0.999, 0])).toBeNull()
    expect(cameraForPose(pose([0.02, 0.999, 0], 0, 0), DEFAULT_CAMERA)).toBeNull()
  })

  it('an azimuth_zero not perpendicular to up is malformed, not projected', () => {
    const p = { ...pose(UP.y!, 0, 0), azimuth_zero: [0, 1, 0] as [number, number, number] }
    expect(cameraForPose(p, DEFAULT_CAMERA)).toBeNull()
  })

  it('puts the camera where the index put it, for every axis and angle', () => {
    // The whole chain in one assertion, against a direction derived from the
    // index's own rotation rather than from a table this app maintains: for
    // each of the six ups and a spread of views, the camera this app computes
    // must point where the index's camera pointed, once both are in scene
    // space. A round-trip would pass under any consistent error; this cannot.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
    const bounds = boundsOf(mesh)
    for (const [name, up] of Object.entries(UP)) {
      for (const azDeg of [0, 45, 90, 225, 270]) {
        for (const elDeg of [-20, 0, 20]) {
          const out = cameraForPose(pose(up, azDeg, elDeg), DEFAULT_CAMERA)
          expect(out, `${name} @${azDeg}/${elDeg}`).not.toBeNull()
          const want = toScene(indexCameraDirection(up, azDeg, elDeg)).normalize()
          const got = statePosition(out!.camera, bounds, out!.axis)
            .sub(bounds.center)
            .normalize()
          expect(got.distanceTo(want), `${name} @${azDeg}/${elDeg}`).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('keeps the model upright: camera up is the model up, in scene space', () => {
    // What "the right way up" means concretely — and what a wrong spindle
    // breaks, since the spindle is also the camera's up vector.
    for (const [, up] of Object.entries(UP)) {
      const out = cameraForPose(pose(up, 90, 20), DEFAULT_CAMERA)!
      const modelUpInScene = toScene(new THREE.Vector3(...up)).normalize()
      const { s } = { s: new THREE.Vector3() }
      void s
      const camera = new THREE.PerspectiveCamera(40, 1)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
      const bounds = boundsOf(mesh)
      camera.position.copy(statePosition(out.camera, bounds, out.axis))
      // The spindle is the camera's up (camera.ts applyState), so asserting the
      // spindle equals the model's scene-space up is asserting uprightness.
      const spindleAxis = out.axis
      const sign = spindleAxis.startsWith('-') ? -1 : 1
      const letter = spindleAxis.replace('-', '')
      const spindle = new THREE.Vector3(
        letter === 'x' ? sign : 0,
        letter === 'y' ? sign : 0,
        letter === 'z' ? sign : 0,
      )
      expect(spindle.distanceTo(modelUpInScene)).toBeLessThan(1e-6)
    }
  })

  it('a missing front view keeps the axis and falls back to view 0’s angles', () => {
    const p = { ...pose(UP.y!, 0, 0), front: null }
    const out = cameraForPose(p, DEFAULT_CAMERA)!
    expect(out.axis).toBe('-z')
    expect(out.camera.el).toBe(0)
    expect(out.camera.distR).toBe(DEFAULT_CAMERA.distR)
  })
})

describe('cameraForPose on the no-pose path', () => {
  it('answers null rather than making every caller check first', () => {
    expect(cameraForPose(undefined, DEFAULT_CAMERA)).toBeNull()
  })
})
