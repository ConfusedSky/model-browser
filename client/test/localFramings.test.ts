import { describe, expect, it, vi } from 'vitest'
import { FRAME_CONVENTION } from '../../shared/frames'
import type { CameraState } from '../../shared/types'
import { readLocalFraming, writeLocalFraming, type FramingStorage } from '../src/api/localFramings'

/**
 * The browser store's on-read migration (`file-frame-spindle` D5): a framing
 * held without the `frame` label was measured in the scene convention and is
 * re-expressed in the file convention the first time it is read, written back
 * labelled, and never migrated again. The shapes are the migration script's
 * (task 2.2), reached through `readLocalFraming` instead of a sidecar walk.
 */
describe('readLocalFraming migrates an unlabelled framing', () => {
  const LIB = (): string => 'lib-a'
  const CAM: CameraState = { az: Math.PI / 4, el: 0.3, distR: 2.5, target: [0.1, 0.2, 0.3] }

  /** A `Storage`-shaped map. `raw` is the bytes, for asserting what was kept. */
  function memStorage(): FramingStorage & { raw: Map<string, string> } {
    const raw = new Map<string, string>()
    return {
      raw,
      getItem: (k: string) => raw.get(k) ?? null,
      setItem: (k: string, v: string) => {
        raw.set(k, v)
      },
      removeItem: (k: string) => {
        raw.delete(k)
      },
    }
  }

  const keyOf = (path: string): string => `mb:framing:lib-a:${path}`

  /** Seed a framing the way a browser held it before the label existed. */
  function seed(store: { raw: Map<string, string> }, path: string, framing: object): void {
    store.raw.set(keyOf(path), JSON.stringify(framing))
  }

  const stored = (store: { raw: Map<string, string> }, path: string): unknown =>
    JSON.parse(store.raw.get(keyOf(path)) as string)

  it('relabels an STL axis y to z, leaves the camera, and writes the label back', () => {
    const store = memStorage()
    seed(store, '/k/a.stl', { camera: CAM, axis: 'y' })

    expect(readLocalFraming('/k/a.stl', store, LIB)).toEqual({ camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
    expect(stored(store, '/k/a.stl')).toEqual({ camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
  })

  it('relabels an STL axis -z to y', () => {
    const store = memStorage()
    seed(store, '/k/a.stl', { camera: CAM, axis: '-z' })

    expect(readLocalFraming('/k/a.stl', store, LIB)).toEqual({ camera: CAM, axis: 'y', frame: FRAME_CONVENTION })
    expect(stored(store, '/k/a.stl')).toEqual({ camera: CAM, axis: 'y', frame: FRAME_CONVENTION })
  })

  it('labels an STL camera without an axis and adds none', () => {
    // The entry drew about the old default `y` and draws about the new default
    // `z`, whose frame is the old `y` frame — and a written axis would withhold
    // an index pose the entry never suppressed.
    const store = memStorage()
    seed(store, '/k/a.stl', { camera: CAM })

    const read = readLocalFraming('/k/a.stl', store, LIB)
    expect(read).toEqual({ camera: CAM, frame: FRAME_CONVENTION })
    expect(read?.axis).toBeUndefined()
    expect(stored(store, '/k/a.stl')).toEqual({ camera: CAM, frame: FRAME_CONVENTION })
  })

  it("re-expresses an OBJ camera at spindle z by that frame's azimuth offset, keeping the axis", () => {
    const store = memStorage()
    seed(store, '/k/b.obj', { camera: CAM, axis: 'z' })

    const read = readLocalFraming('/k/b.obj', store, LIB)
    expect(read?.axis).toBe('z')
    expect(read?.frame).toBe(FRAME_CONVENTION)
    expect(read?.camera?.az).toBeCloseTo(Math.PI / 4 + Math.PI / 2, 10)
    expect(read?.camera).toMatchObject({ el: CAM.el, distR: CAM.distR, target: CAM.target })
    expect((stored(store, '/k/b.obj') as { camera: CameraState }).camera.az).toBeCloseTo(
      Math.PI / 4 + Math.PI / 2,
      10,
    )
  })

  it('leaves an OBJ camera at spindle y untouched, labelled', () => {
    const store = memStorage()
    seed(store, '/k/b.obj', { camera: CAM, axis: 'y' })

    expect(readLocalFraming('/k/b.obj', store, LIB)).toEqual({ camera: CAM, axis: 'y', frame: FRAME_CONVENTION })
    expect(stored(store, '/k/b.obj')).toEqual({ camera: CAM, axis: 'y', frame: FRAME_CONVENTION })
  })

  it('serves a labelled framing as is, touching nothing', () => {
    const store = memStorage()
    seed(store, '/k/a.stl', { camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
    const setItem = vi.spyOn(store, 'setItem')

    expect(readLocalFraming('/k/a.stl', store, LIB)).toEqual({ camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
    expect(setItem).not.toHaveBeenCalled()
  })

  it('keeps the label through a framing write after a migrated read, so a re-read does not migrate again', () => {
    const store = memStorage()
    seed(store, '/k/a.stl', { camera: CAM, axis: 'y' })
    expect(readLocalFraming('/k/a.stl', store, LIB)?.axis).toBe('z')

    // An orbit release: a new camera, the axis kept by silence.
    const moved: CameraState = { ...CAM, az: 1 }
    writeLocalFraming('/k/a.stl', { camera: moved }, store, LIB)

    expect(stored(store, '/k/a.stl')).toEqual({ camera: moved, axis: 'z', frame: FRAME_CONVENTION })
    // Without the label this read would migrate `z` a second time, to `-y`.
    expect(readLocalFraming('/k/a.stl', store, LIB)).toEqual({ camera: moved, axis: 'z', frame: FRAME_CONVENTION })
  })

  it('serves the transformed framing under a storage that refuses the write-back', () => {
    const store = memStorage()
    seed(store, '/k/a.stl', { camera: CAM, axis: 'y' })
    store.setItem = () => {
      throw new Error('QuotaExceededError')
    }

    expect(readLocalFraming('/k/a.stl', store, LIB)).toEqual({ camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
    // The bytes are as they were, and the next read transforms them the same way.
    expect(stored(store, '/k/a.stl')).toEqual({ camera: CAM, axis: 'y' })
    expect(readLocalFraming('/k/a.stl', store, LIB)).toEqual({ camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
  })

  it('answers two reads in one tick with the same framing', () => {
    const store = memStorage()
    seed(store, '/k/b.obj', { camera: CAM, axis: '-x' })

    const first = readLocalFraming('/k/b.obj', store, LIB)
    const second = readLocalFraming('/k/b.obj', store, LIB)
    expect(first).toBeDefined()
    expect(second).toEqual(first)
  })

  it('transforms a zip-interior key like the STL it names', () => {
    const store = memStorage()
    seed(store, '/k/a.zip!/parts/x.stl', { camera: CAM, axis: 'y' })

    expect(readLocalFraming('/k/a.zip!/parts/x.stl', store, LIB)).toEqual({
      camera: CAM,
      axis: 'z',
      frame: FRAME_CONVENTION,
    })
    expect(stored(store, '/k/a.zip!/parts/x.stl')).toEqual({ camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
  })

  it('returns an unclassifiable key untransformed and unlabelled, writing nothing', () => {
    // The app stores keys for model paths only, but the store is hand-editable,
    // and a frame nothing is known about is neither transformed nor stamped.
    const store = memStorage()
    seed(store, '/k/notes.txt', { camera: CAM, axis: 'y' })
    const setItem = vi.spyOn(store, 'setItem')

    expect(readLocalFraming('/k/notes.txt', store, LIB)).toEqual({ camera: CAM, axis: 'y' })
    expect(setItem).not.toHaveBeenCalled()
    expect(stored(store, '/k/notes.txt')).toEqual({ camera: CAM, axis: 'y' })
  })
})
