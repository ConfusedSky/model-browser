// The spindle frames in file coordinates, and the arithmetic the migration
// derives from the pre-bake table (file-frame-spindle D3/D5).
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { OrbitAxis } from '../../shared/types'
import {
  axisOfTriple,
  defaultAxisFor,
  FILE_FRAMES,
  migrateAxis,
  SCENE_FRAMES,
  swapOffset,
  unbake,
  type FrameTriples,
  type Triple,
} from '../../shared/frames'
import { boundsOf, captureState } from '../src/three/camera'

const AXES: OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']

/**
 * Design D3's table, typed by hand from the design — the cross-check against
 * the derivation in `shared/frames.ts`, which must never be edited to agree
 * with a table someone changed here (or the other way round).
 */
const D3_TABLE: Record<OrbitAxis, FrameTriples> = {
  z: { s: [0, 0, 1], a: [1, 0, 0], b: [0, -1, 0] },
  '-z': { s: [0, 0, -1], a: [0, -1, 0], b: [1, 0, 0] },
  '-y': { s: [0, -1, 0], a: [0, 0, 1], b: [1, 0, 0] },
  y: { s: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  x: { s: [1, 0, 0], a: [0, -1, 0], b: [0, 0, 1] },
  '-x': { s: [-1, 0, 0], a: [0, 0, 1], b: [0, -1, 0] },
}

/** `+ 0` on each component turns a −0 into +0, so `toEqual` compares values, not zero signs. */
function cross(u: Triple, v: Triple): Triple {
  return [
    u[1] * v[2] - u[2] * v[1] + 0,
    u[2] * v[0] - u[0] * v[2] + 0,
    u[0] * v[1] - u[1] * v[0] + 0,
  ]
}

const negate = (v: Triple): Triple => [0 - v[0], 0 - v[1], 0 - v[2]]

const deg = (rad: number): number => (rad * 180) / Math.PI

/** Signed angular difference wrapped into (−π, π]. */
function angleDelta(a: number, b: number): number {
  return ((((a - b + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
}

describe('FILE_FRAMES', () => {
  it("is design D3's table, all six entries", () => {
    for (const axis of AXES) expect(FILE_FRAMES[axis], axis).toEqual(D3_TABLE[axis])
  })

  it('keeps a × b = −s on every row, so no drag direction reverses', () => {
    for (const axis of AXES) {
      const { s, a, b } = FILE_FRAMES[axis]
      expect(cross(a, b), axis).toEqual(negate(s))
    }
  })

  it('is keyed by the axis its own spindle vector names', () => {
    for (const axis of AXES) expect(axisOfTriple(FILE_FRAMES[axis].s)).toBe(axis)
  })

  it('has y and -y as fixed points of the scene table', () => {
    expect(FILE_FRAMES.y).toEqual(SCENE_FRAMES.y)
    expect(FILE_FRAMES['-y']).toEqual(SCENE_FRAMES['-y'])
  })
})

describe('unbake and axisOfTriple', () => {
  it('unbake inverts the bake rotateX(−π/2): (x, z, −y) back to (x, y, z)', () => {
    const file: Triple = [1, 2, 3]
    const baked: Triple = [file[0], file[2], -file[1]]
    expect(unbake(baked)).toEqual(file)
  })

  it('axisOfTriple throws on anything but a unit axis vector', () => {
    expect(() => axisOfTriple([0, 0.999, 0.02])).toThrow(/not a unit axis vector/)
    expect(() => axisOfTriple([0, 0, 0])).toThrow()
  })
})

describe('migrateAxis', () => {
  it("is the spindle vector's image under R⁻¹: y→z, -y→-z, z→-y, -z→y, x→x, -x→-x", () => {
    const pairs: [OrbitAxis, OrbitAxis][] = [
      ['y', 'z'],
      ['-y', '-z'],
      ['z', '-y'],
      ['-z', 'y'],
      ['x', 'x'],
      ['-x', '-x'],
    ]
    for (const [from, to] of pairs) expect(migrateAxis(from), from).toBe(to)
  })
})

describe('swapOffset', () => {
  it('is x −90°, -x +90°, z +90°, -z −90°, y 0, -y 0', () => {
    const want: Record<OrbitAxis, number> = { x: -90, '-x': 90, z: 90, '-z': -90, y: 0, '-y': 0 }
    for (const axis of AXES) expect(deg(swapOffset(axis)), axis).toBeCloseTo(want[axis], 9)
  })

  it("has captureState's sign: a direction at old az θ captures at θ + offset under the new frame", () => {
    // Build the direction in the OLD (scene) frame the way `stateDirection`
    // does, then let the real `captureState` — which reads FILE_FRAMES — say
    // what azimuth that direction has now. The difference must be the offset
    // for every θ and elevation, not only at θ = 0.
    const bounds = boundsOf(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
    const origin = new THREE.Vector3()
    for (const axis of AXES) {
      const { s, a, b } = SCENE_FRAMES[axis]
      for (const az of [-2.5, -0.7, 0, 0.3, 1.1, 2.9]) {
        for (const el of [-0.5, 0, 0.4]) {
          const d = new THREE.Vector3()
            .addScaledVector(new THREE.Vector3(...a), Math.sin(az) * Math.cos(el))
            .addScaledVector(new THREE.Vector3(...b), Math.cos(az) * Math.cos(el))
            .addScaledVector(new THREE.Vector3(...s), Math.sin(el))
          const now = captureState(d.multiplyScalar(3), origin, bounds, axis)
          expect(angleDelta(now.az, az + swapOffset(axis)), `${axis} @${az}/${el}`).toBeCloseTo(0, 9)
          expect(now.el, `${axis} @${az}/${el}`).toBeCloseTo(el, 9)
        }
      }
    }
  })
})

describe('defaultAxisFor', () => {
  it('is z for STL and 3MF, y for OBJ', () => {
    expect(defaultAxisFor('stl')).toBe('z')
    expect(defaultAxisFor('3mf')).toBe('z')
    expect(defaultAxisFor('obj')).toBe('y')
  })
})
