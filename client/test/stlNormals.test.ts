import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { parseModel } from '../src/three/models'

type V3 = [number, number, number]

// An outward-wound unit tetrahedron: winding is the authoritative orientation
// the parser must shade from, whatever the file's normal field claims (D1/D3).
const TET: [V3, V3, V3][] = [
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
]

function windingNormal([a, b, c]: [V3, V3, V3]): V3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: V3 = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ]
  const l = Math.hypot(...n)
  return [n[0] / l, n[1] / l, n[2] / l]
}

/**
 * Craft a binary STL of the tetrahedron: an 80-byte header, a uint32 facet
 * count, then 50 bytes per facet — normal and three vertices as float32
 * triplets, plus a uint16 attribute. `storedFor` decides what normal the file
 * CLAIMS for each facet — per facet, independent of its winding.
 */
function craftStl(storedFor: (winding: V3, index: number) => V3): ArrayBuffer {
  const buf = new ArrayBuffer(84 + TET.length * 50)
  const dv = new DataView(buf)
  dv.setUint32(80, TET.length, true)
  TET.forEach((tri, i) => {
    const o = 84 + i * 50
    const stored = storedFor(windingNormal(tri), i)
    const floats = [...stored, ...tri[0], ...tri[1], ...tri[2]]
    floats.forEach((f, k) => dv.setFloat32(o + k * 4, f, true))
    dv.setUint16(o + 48, 0, true)
  })
  return buf
}

function parsedNormals(bytes: ArrayBuffer): { normal: Float32Array; position: Float32Array } {
  const mesh = parseModel(bytes, 'stl') as THREE.Mesh
  const geometry = mesh.geometry
  return {
    normal: geometry.getAttribute('normal')!.array as Float32Array,
    position: geometry.getAttribute('position')!.array as Float32Array,
  }
}

/** Every vertex normal must agree with the facet plane its parsed positions span. */
function assertNormalsMatchWinding({ normal, position }: ReturnType<typeof parsedNormals>): void {
  for (let f = 0; f < TET.length; f++) {
    const at = (v: number): V3 => [
      position[f * 9 + v * 3]!,
      position[f * 9 + v * 3 + 1]!,
      position[f * 9 + v * 3 + 2]!,
    ]
    const expected = windingNormal([at(0), at(1), at(2)])
    for (let v = 0; v < 3; v++) {
      const i = f * 9 + v * 3
      const dot =
        normal[i]! * expected[0] + normal[i + 1]! * expected[1] + normal[i + 2]! * expected[2]
      expect(dot).toBeGreaterThan(0.9999)
    }
  }
}

describe('STL shading normals derive from winding', () => {
  it('a file whose stored normals are rotated 90° about X parses to winding normals', () => {
    // The wild signature: stored = (x, z, −y) of the winding normal — the
    // Z-up/Y-up mismatch measured on Radroach_with_base and Almenhier_body.
    assertNormalsMatchWinding(
      parsedNormals(craftStl(([x, y, z]) => [x, z, -y])),
    )
  })

  it('zeroed stored normals parse to winding normals, not to unlit zeros', () => {
    const parsed = parsedNormals(craftStl(() => [0, 0, 0]))
    assertNormalsMatchWinding(parsed)
    for (let i = 0; i < parsed.normal.length; i += 3) {
      const l = Math.hypot(parsed.normal[i]!, parsed.normal[i + 1]!, parsed.normal[i + 2]!)
      expect(l).toBeCloseTo(1, 5)
    }
  })

  it('a healthy file is unchanged: parsed normals reproduce its stored field', () => {
    const parsed = parsedNormals(craftStl((winding) => winding))
    assertNormalsMatchWinding(parsed)
    // The stored field, carried through parseModel's Z-up → Y-up rotateX(-π/2),
    // is (x, z, −y) — the parsed normals must land exactly there.
    for (let f = 0; f < TET.length; f++) {
      const [x, y, z] = windingNormal(TET[f]!)
      for (let v = 0; v < 3; v++) {
        const i = f * 9 + v * 3
        expect(parsed.normal[i]!).toBeCloseTo(x, 5)
        expect(parsed.normal[i + 1]!).toBeCloseTo(z, 5)
        expect(parsed.normal[i + 2]!).toBeCloseTo(-y, 5)
      }
    }
  })

  it('an isolated inverted facet in an otherwise healthy file is corrected', () => {
    // The 3DBenchy case: a broadly correct normal field with a few stale or
    // inverted facets. The bad facet shades from its winding like every other.
    const parsed = parsedNormals(
      craftStl((winding, i) => (i === 2 ? [-winding[0], -winding[1], -winding[2]] : winding)),
    )
    assertNormalsMatchWinding(parsed)
    expect(parsed.normal).toEqual(parsedNormals(craftStl((w) => w)).normal)
  })

  it('all three variants parse to identical normals — the file has no say', () => {
    const healthy = parsedNormals(craftStl((w) => w)).normal
    const rotated = parsedNormals(craftStl(([x, y, z]) => [x, z, -y])).normal
    const zeroed = parsedNormals(craftStl(() => [0, 0, 0])).normal
    expect(rotated).toEqual(healthy)
    expect(zeroed).toEqual(healthy)
  })
})
