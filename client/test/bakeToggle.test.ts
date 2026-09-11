// TEMPORARY — `file-frame-spindle` D7's compare pill: the module flag, the
// three legacy branches it selects, and the write guard that holds while the
// pill exists. Deleted by task 5.2 with `bakeToggle.ts`.
//
// `vi.unmock` first: the suite-wide setup (`bakePillGuard.setup.ts`) lifts the
// guard constant for every other file, and this one exercises the real guard —
// removing the first line of `LocalFramingClient.putThumb` fails the last cell
// here and nowhere else.
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILE_FRAMES, SCENE_FRAMES, type FrameTriples } from '../../shared/frames'
import type { FeatureReport } from '../../shared/types'
import type { ApiClient, ThumbSave } from '../src/api/client'
import { withLocalFramings, type FramingStorage } from '../src/api/localFramings'
import { BAKE_PILL_PRESENT, legacyBake, setLegacyBake } from '../src/three/bakeToggle'
import { frameFor, type SpindleFrame } from '../src/three/camera'
import { parseModel } from '../src/three/models'
import { axisOf } from '../src/three/pose'

vi.unmock('../src/three/bakeToggle')

afterEach(() => setLegacyBake(false))

type V3 = [number, number, number]

/** Binary STL: 80-byte header, uint32 count, 50 bytes per facet (models.test.ts). */
function stlBytes(facets: [V3, V3, V3][]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50 * facets.length)
  const view = new DataView(buffer)
  view.setUint32(80, facets.length, true)
  facets.forEach((tri, f) => {
    const floats = [0, 0, 0, ...tri[0], ...tri[1], ...tri[2]]
    floats.forEach((x, i) => view.setFloat32(84 + f * 50 + i * 4, x, true))
  })
  return buffer
}

/** Two facets whose extents are X 1, Y 2, Z 3 — distinguishable under any axis swap. */
const EXTENTS_123: [V3, V3, V3][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
  ],
  [
    [0, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ],
]

/** Components rounded past float32 rotation noise; `+ 0` folds −0 into 0. */
function rounded(v: THREE.Vector3): number[] {
  return v.toArray().map((c) => Math.round(c * 1e6) / 1e6 + 0)
}

function plain(f: SpindleFrame): FrameTriples {
  return { s: f.s.toArray() as V3, a: f.a.toArray() as V3, b: f.b.toArray() as V3 }
}

describe('legacyBake', () => {
  it('is off by default, and the setter flips it — not persisted, so a reload is off', () => {
    expect(legacyBake()).toBe(false)
    setLegacyBake(true)
    expect(legacyBake()).toBe(true)
  })
})

describe('parseModel bake argument', () => {
  it('parses an STL rotated by the retired bake only when asked, whatever the flag says', () => {
    // The two LRU instances pass `bake` explicitly; the flag is not read here.
    setLegacyBake(true)
    const file = new THREE.Box3().setFromObject(parseModel(stlBytes(EXTENTS_123), 'stl', false))
    expect(rounded(file.min)).toEqual([0, 0, 0])
    expect(rounded(file.max)).toEqual([1, 2, 3])
    // rotateX(−π/2): (x, y, z) ↦ (x, z, −y), so Z 3 becomes Y 3 and Y 2 becomes Z −2.
    const baked = new THREE.Box3().setFromObject(parseModel(stlBytes(EXTENTS_123), 'stl', true))
    expect(rounded(baked.min)).toEqual([0, 0, -2])
    expect(rounded(baked.max)).toEqual([1, 3, 0])
  })

  it('defaults to the file frame, so every existing caller is unchanged', () => {
    const box = new THREE.Box3().setFromObject(parseModel(stlBytes(EXTENTS_123), 'stl'))
    expect(rounded(box.max)).toEqual([1, 2, 3])
  })
})

describe('frameFor under the flag', () => {
  it('serves the lifted scene table on, and the file table off', () => {
    expect(plain(frameFor('z'))).toEqual(FILE_FRAMES.z)
    expect(plain(frameFor('y'))).toEqual(FILE_FRAMES.y)
    setLegacyBake(true)
    expect(plain(frameFor('z'))).toEqual(SCENE_FRAMES.z)
    expect(plain(frameFor('y'))).toEqual(SCENE_FRAMES.y)
    // The cell only means something where the two tables disagree.
    expect(SCENE_FRAMES.z).not.toEqual(FILE_FRAMES.z)
  })
})

describe('axisOf under the flag', () => {
  it('maps the index up axis through the legacy (x, z, −y) on, and reads it as is off', () => {
    expect(axisOf([0, 0, 1])).toBe('z')
    setLegacyBake(true)
    expect(axisOf([0, 0, 1])).toBe('y')
    expect(axisOf([0, 1, 0])).toBe('-z')
  })
})

describe('putThumb guard while the pill exists', () => {
  const save: ThumbSave = {
    path: '/m.stl',
    mtime: 42,
    png: new Blob(['pixels'], { type: 'image/webp' }),
    camera: { az: 0.3, el: 0.2, distR: 2, target: [0, 0, 0] },
    axis: 'z',
  }

  function storage(): FramingStorage & { setItem: ReturnType<typeof vi.fn> } {
    return { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }
  }

  it('is on, and drops a PUT before the wire and before the local branch, with the flag off', async () => {
    expect(BAKE_PILL_PRESENT).toBe(true)
    expect(legacyBake()).toBe(false)
    const inner = { putThumb: vi.fn().mockResolvedValue({ gen: 5 }) } as unknown as ApiClient
    // A refusing deployment: without the guard this branch writes to storage.
    const refusing = storage()
    const off = { thumbWrites: false } as FeatureReport
    const local = withLocalFramings(inner, () => off, refusing, () => 'lib')
    expect(await local.putThumb(save)).toEqual({ dropped: true })
    expect(refusing.setItem).not.toHaveBeenCalled()
    // A writing deployment: without the guard this reaches the inner client.
    const remote = withLocalFramings(inner, () => null, storage(), () => 'lib')
    expect(await remote.putThumb(save)).toEqual({ dropped: true })
    expect(inner.putThumb).not.toHaveBeenCalled()
  })

  it('lets a discard through to the local branch, so reset framing still clears a held framing', async () => {
    const inner = { putThumb: vi.fn().mockResolvedValue({ gen: 5 }) } as unknown as ApiClient
    const off = { thumbWrites: false } as FeatureReport
    // A held framing, then a reset's save: pixels plus `null` for both halves.
    const held = storage()
    held.getItem = () => JSON.stringify({ camera: save.camera, axis: 'z' })
    const local = withLocalFramings(inner, () => off, held, () => 'lib')
    const reset: ThumbSave = { path: '/m.stl', mtime: 42, png: save.png, camera: null, axis: null }
    expect(await local.putThumb(reset)).toEqual({ dropped: true })
    expect(held.removeItem).toHaveBeenCalledTimes(1)
    expect(held.setItem).not.toHaveBeenCalled()
    expect(inner.putThumb).not.toHaveBeenCalled()
    // A camera-only discard keeps the held axis: a write, not a removal.
    const partial = storage()
    partial.getItem = () => JSON.stringify({ camera: save.camera, axis: 'z' })
    const local2 = withLocalFramings(inner, () => off, partial, () => 'lib')
    await local2.putThumb({ path: '/m.stl', mtime: 42, camera: null })
    expect(partial.setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(partial.setItem.mock.calls[0]![1] as string)).toEqual({ axis: 'z' })
    // On a writing deployment the discard's pixels still never reach the wire.
    const remote = withLocalFramings(inner, () => null, storage(), () => 'lib')
    expect(await remote.putThumb(reset)).toEqual({ dropped: true })
    expect(inner.putThumb).not.toHaveBeenCalled()
  })
})
