// The index's pose, expressed in this app's camera model.
//
// The index measures its angles after rotating the mesh so `up` points at +Z,
// and reports `up` and `azimuth_zero` in the file's coordinates. Since
// file-frame-spindle this app renders every model in those same coordinates
// — no rotation is baked into STL geometry on load — so the index's up axis is
// the spindle, literally, and the only transform left to get right is the
// azimuth offset derived from `azimuth_zero`. Getting that wrong renders a
// model from the wrong side; getting the axis wrong rendered models lying
// down, which is exactly what shipped before these tests existed.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { axisOfTriple, FILE_FRAMES } from '../../shared/frames'
import type { IndexPose, OrbitAxis } from '../../shared/types'
import { boundsOf, DEFAULT_CAMERA, statePosition } from '../src/three/camera'
import { axisOf, cameraForPose } from '../src/three/pose'

const UP: Record<OrbitAxis, [number, number, number]> = {
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

function pose(up: [number, number, number], az: number, el: number): IndexPose {
  return {
    up,
    azimuth_zero: azimuthZero(up),
    source: 'siglip',
    confidence: 0.9,
    front: { view: 0, azimuth_deg: az, elevation_deg: el },
  }
}

const deg = (rad: number): number => (rad * 180) / Math.PI

describe('index pose → camera', () => {
  it("the index's up axis IS the spindle", () => {
    // Both are measured in the file's coordinates, so no mapping sits between
    // them: `[0,0,1]` is `z`. (Before file-frame-spindle a file-Z up became the
    // scene's `y` through the STL bake, and `[0,1,0]` became `-z`.)
    expect(axisOf(UP.z)).toBe('z')
    expect(axisOf(UP.y)).toBe('y')
    expect(axisOf(UP['-z'])).toBe('-z')
    expect(axisOf(UP.x)).toBe('x')
    expect(axisOf(UP['-x'])).toBe('-x')
    expect(axisOf(UP['-y'])).toBe('-y')
  })

  it('an up axis outside the six is a fault, not a rounding', () => {
    expect(axisOf([0.02, 0.999, 0])).toBeNull()
    expect(cameraForPose(pose([0.02, 0.999, 0], 0, 0), DEFAULT_CAMERA)).toBeNull()
  })

  it('an azimuth_zero not perpendicular to up is malformed, not projected', () => {
    const p = { ...pose(UP.y, 0, 0), azimuth_zero: [0, 1, 0] as [number, number, number] }
    expect(cameraForPose(p, DEFAULT_CAMERA)).toBeNull()
  })

  it('puts the camera where the index put it, for every axis and angle', () => {
    // The whole chain in one assertion, against a direction derived from the
    // index's own rotation rather than from a table this app maintains: for
    // each of the six ups and a spread of views, the camera this app computes
    // must point where the index's camera pointed. Both are in file space now,
    // so the comparison is direct. A round-trip would pass under any
    // consistent error; this cannot.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
    const bounds = boundsOf(mesh)
    for (const [name, up] of Object.entries(UP)) {
      for (const azDeg of [0, 45, 90, 225, 270]) {
        for (const elDeg of [-20, 0, 20]) {
          const out = cameraForPose(pose(up, azDeg, elDeg), DEFAULT_CAMERA)
          expect(out, `${name} @${azDeg}/${elDeg}`).not.toBeNull()
          const want = indexCameraDirection(up, azDeg, elDeg).normalize()
          const got = statePosition(out!.camera, bounds, out!.axis)
            .sub(bounds.center)
            .normalize()
          expect(got.distanceTo(want), `${name} @${azDeg}/${elDeg}`).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('derives az as the front azimuth plus atan2(a·u₀, b·u₀) in the file frame, about axisOfTriple(up)', () => {
    // The derivation itself, spelled out against the shared table (D4): the
    // spindle is the up vector's own axis, and the offset is `azimuth_zero`
    // re-measured in that spindle's file frame. `u₀` is any perpendicular to
    // `up` here, not only the one the index's rotation produces, so the cell
    // holds for an index whose rotation convention changes.
    for (const [name, up] of Object.entries(UP) as [OrbitAxis, [number, number, number]][]) {
      const { a, b } = FILE_FRAMES[name]
      for (const u0 of [a, b, [-a[0], -a[1], -a[2]] as const, [-b[0], -b[1], -b[2]] as const]) {
        const p: IndexPose = { ...pose(up, 30, 20), azimuth_zero: [u0[0], u0[1], u0[2]] }
        const out = cameraForPose(p, DEFAULT_CAMERA)!
        expect(out.axis, name).toBe(axisOfTriple(up))
        const offset = Math.atan2(
          a[0] * u0[0] + a[1] * u0[1] + a[2] * u0[2],
          b[0] * u0[0] + b[1] * u0[1] + b[2] * u0[2],
        )
        expect(out.camera.az, `${name} u0=${u0.join(',')}`).toBeCloseTo((30 * Math.PI) / 180 + offset, 9)
        expect(out.camera.el).toBeCloseTo((20 * Math.PI) / 180, 9)
      }
    }
  })

  it("reproduces the spike's posed root samples: Benchy z 90° 20°, bod_test_cube -x 405° 20°", () => {
    // The (axis, az, el) the pre-change code answered for two of the seven
    // posed root samples (file-frame-spindle tasks 1.2), with `azimuth_zero`
    // as the index's own rotation produces it. The same numbers after the bake
    // and the mapping went together is what lets POSE_VERSION stay at 2.
    const benchy = cameraForPose(pose(UP.z, 0, 20), DEFAULT_CAMERA)!
    expect(benchy.axis).toBe('z')
    expect(deg(benchy.camera.az)).toBeCloseTo(90, 9)
    expect(deg(benchy.camera.el)).toBeCloseTo(20, 9)
    const cube = cameraForPose(pose(UP['-x'], 315, 20), DEFAULT_CAMERA)!
    expect(cube.axis).toBe('-x')
    expect(deg(cube.camera.az)).toBeCloseTo(405, 9)
    expect(deg(cube.camera.el)).toBeCloseTo(20, 9)
  })

  it('keeps the model upright: camera up is the model up, in file space', () => {
    // What "the right way up" means concretely — and what a wrong spindle
    // breaks, since the spindle is also the camera's up vector (camera.ts
    // applyState). With no rotation between file and scene, the spindle must
    // equal the pose's `up` unrotated.
    for (const [name, up] of Object.entries(UP) as [OrbitAxis, [number, number, number]][]) {
      const out = cameraForPose(pose(up, 90, 20), DEFAULT_CAMERA)!
      const spindle = new THREE.Vector3(...FILE_FRAMES[out.axis].s)
      expect(spindle.distanceTo(new THREE.Vector3(...up)), name).toBeLessThan(1e-6)
    }
  })

  it('a missing front view keeps the axis and falls back to view 0’s angles', () => {
    const p = { ...pose(UP.y, 0, 0), front: null }
    const out = cameraForPose(p, DEFAULT_CAMERA)!
    expect(out.axis).toBe('y')
    expect(out.camera.el).toBe(0)
    expect(out.camera.distR).toBe(DEFAULT_CAMERA.distR)
  })
})

describe('cameraForPose on the no-pose path', () => {
  it('answers null rather than making every caller check first', () => {
    expect(cameraForPose(undefined, DEFAULT_CAMERA)).toBeNull()
  })
})
