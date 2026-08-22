// @vitest-environment happy-dom
//
// The two thumbnail commands (§4b), asked directly through the command table:
// what orientation each one renders from, what it writes back, and what it
// leaves alone. The wiring — which tiles offer them, and the lightbox seeing
// the result — is entryMenu.test.tsx's job.
//
// Everything here goes through `ENTRY_COMMANDS` rather than an exported body,
// because "the menu shows it" and "this is what it does" have to be the same
// object: a command whose body drifted from its table entry would pass a test
// written against the body alone.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import type { CameraState, DirEntry, IndexPose, LightingMode, OrbitAxis } from '../../shared/types'
import type { ApiClient, ThumbSave } from '../src/api/client'
import { useThumbnails } from '../src/hooks/useThumbnails'
import type { MeshLru } from '../src/three/lru'
import { ENTRY_COMMANDS, RENDER_FAILED, type ActionHost } from '../src/lib/entryActions'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose, POSE_VERSION } from '../src/three/pose'
import { RenderQueue } from '../src/three/queue'
import { RIG_VERSION } from '../src/three/renderer'
import { getLightingMode, setLightingMode } from '../src/viewer/lighting'

// The command reaches the shared renderer only through `renderThumbnail`.
// Spread the real module so RIG_VERSION arrives real — a literal here would go
// on passing across a bump while asserting a version the app no longer writes.
const renderThumbnail = vi.hoisted(() => vi.fn(() => Promise.resolve(new Blob(['png']))))
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  renderThumbnail,
}))

const HERO: DirEntry = {
  name: 'hero.stl',
  path: '/models/hero.stl',
  kind: 'model',
  format: 'stl',
  size: 1,
  mtime: 7,
}
const CAM = { az: 1, el: 0.25, distR: 3, target: [0, 0, 0] as [number, number, number] }
const MESH = {} as THREE.Object3D

/** A pose the app can express: file-space `up` (0,-1,0) is scene +Z, and
 *  `azimuth_zero` is perpendicular to it. Deliberately not 'y' — the axis has
 *  to be visibly different from the default for "the axis moved" to mean
 *  anything. */
const POSE: IndexPose = {
  up: [0, -1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'test',
  confidence: 1,
  front: { view: 0, azimuth_deg: 40, elevation_deg: 20 },
}
/** The same pose with no cached front view. Kept on purpose by `pose.ts`, and
 *  deliberately NOT an exception here (D7): the sweep applies it too. */
const POSE_NO_FRONT: IndexPose = { ...POSE, front: null }
/** Malformed: `up` is not one of the six axes, so `cameraForPose` returns null
 *  and there is nothing to trade a real axis for. */
const POSE_OFF_AXIS: IndexPose = { ...POSE, up: [0.7, -0.7, 0] }

interface Harness {
  host: ActionHost
  queue: RenderQueue
  getThumb: ReturnType<typeof vi.fn>
  putThumb: ReturnType<typeof vi.fn>
  setThumb: ReturnType<typeof vi.fn>
  report: ReturnType<typeof vi.fn>
  acquire: ReturnType<typeof vi.fn>
}

function harness(
  cached: Record<string, unknown> = { status: 'miss' },
  poses: Record<string, IndexPose> = {},
): Harness {
  const queue = new RenderQueue(1)
  const getThumb = vi.fn().mockResolvedValue(cached)
  const putThumb = vi.fn().mockResolvedValue(undefined)
  const setThumb = vi.fn()
  const report = vi.fn()
  const acquire = vi.fn().mockResolvedValue(MESH)
  const host = {
    navigate: vi.fn(),
    dispatch: vi.fn(),
    markOnArrival: vi.fn(),
    open: vi.fn(),
    confirm: vi.fn(),
    report,
    poses,
    api: { getThumb, putThumb },
    lru: { acquire },
    queue,
    setThumb,
  } as unknown as ActionHost
  return { host, queue, getThumb, putThumb, setThumb, report, acquire }
}

const run = (id: 'reRenderThumbnail' | 'resetFraming', host: ActionHost): void => {
  ENTRY_COMMANDS.find((c) => c.id === id)!.run!(HERO, host, null)
}
/** Let the queued job run to completion — every await in it resolves at once. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  renderThumbnail.mockClear()
  // A module-closure preference: it does not reset between files.
  setLightingMode('axis')
})

describe('re-render thumbnail', () => {
  it('renders from the stored camera and axis, and writes pixels with their labels — no viewpoint', async () => {
    const h = harness({ status: 'hit', camera: CAM, axis: '-x' })
    run('reRenderThumbnail', h.host)
    await flush()

    expect(renderThumbnail).toHaveBeenCalledWith(MESH, CAM, '-x')
    const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.path).toBe(HERO.path)
    expect(put.mtime).toBe(HERO.mtime)
    expect(put.png).toBeInstanceOf(Blob)
    // Silence means keep: the orientation is left exactly as it was found.
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
    // But the pixels' own labels are not optional. cache.ts clears every label
    // a PNG-bearing PUT omits, so an unlabelled write would fail the hit test
    // forever and re-render this tile on every single visit.
    expect(put.lighting).toBe(getLightingMode())
    expect(put.rig).toBe(RIG_VERSION)
    expect(put.posed).toBeUndefined() // nothing was posed
    expect(h.setThumb).toHaveBeenCalledWith(HERO.path, {
      status: 'ready',
      url: expect.any(String),
      camera: CAM,
      axis: '-x',
    })
  })

  it('renders a posed model at the pose, declares the recipe, and leaves it with no orientation of its own', async () => {
    // The pose is an input to the pixels the cache key does not carry. Without
    // the label the next sweep sees `poseStale` and renders the tile again.
    const h = harness({ status: 'hit' }, { [HERO.path]: POSE })
    const resolved = cameraForPose(POSE, DEFAULT_CAMERA)!
    expect(resolved.axis).toBe('z') // the fixture is not the default spindle
    run('reRenderThumbnail', h.host)
    await flush()

    expect(renderThumbnail).toHaveBeenCalledWith(MESH, resolved.camera, resolved.axis)
    const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.posed).toBe(POSE_VERSION)
    // Still nothing of the user's: a re-classification still governs this model.
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
    expect(h.setThumb.mock.calls[0]![1]).toMatchObject({ camera: undefined, axis: undefined })
  })

  it('never moves the axis, whether or not a pose exists — and draws about the one stored', async () => {
    // A stored axis is enough to withhold the pose: half a pose is not a pose.
    for (const poses of [{}, { [HERO.path]: POSE }]) {
      const h = harness({ status: 'hit', axis: '-z' }, poses)
      renderThumbnail.mockClear()
      run('reRenderThumbnail', h.host)
      await flush()

      expect(renderThumbnail).toHaveBeenCalledWith(MESH, DEFAULT_CAMERA, '-z')
      const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
      expect(put.axis).toBeUndefined() // keep, never discard
      expect(put.posed).toBeUndefined() // the pose was withheld, so was its label
      expect(h.setThumb.mock.calls[0]![1]).toMatchObject({ axis: '-z' })
    }
  })
})

describe('reset framing', () => {
  it('discards the camera and the axis together when a usable pose can replace both', async () => {
    const h = harness({ status: 'hit', camera: CAM, axis: '-x' }, { [HERO.path]: POSE })
    const resolved = cameraForPose(POSE, DEFAULT_CAMERA)!
    run('resetFraming', h.host)
    await flush()

    // Rendered as an untouched model is rendered: the index's orientation
    // entire, rather than the default about the axis it used to have.
    expect(renderThumbnail).toHaveBeenCalledWith(MESH, resolved.camera, resolved.axis)
    const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.camera).toBeNull() // null discards; undefined would keep
    expect(put.axis).toBeNull()
    expect(put.posed).toBe(POSE_VERSION)
    expect(put.rig).toBe(RIG_VERSION)
    expect(put.lighting).toBe(getLightingMode())
    // The session's own copy, so the lightbox opens where the tile now shows.
    expect(h.setThumb).toHaveBeenCalledWith(HERO.path, {
      status: 'ready',
      url: expect.any(String),
      camera: undefined,
      axis: undefined,
    })
  })

  it('never writes a default in place of the discarded camera', async () => {
    // A stored default is an orientation of the user's own: it would make
    // `cached.camera !== undefined` and disqualify this model from the pose
    // path forever. The fix for a badly framed thumbnail would guarantee one.
    const h = harness({ status: 'hit', camera: CAM }, { [HERO.path]: POSE })
    run('resetFraming', h.host)
    await flush()
    const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.camera).not.toEqual(DEFAULT_CAMERA)
    expect(put.camera).toBeNull()
  })

  it('keeps the axis when the pose offered is malformed, and when there is none at all', async () => {
    // Trading a real axis for 'y' with nothing to replace it would lay a Z-up
    // model on its side — the failure D7 refuses. "Usable" is `cameraForPose`'s
    // answer and nothing else.
    for (const poses of [{}, { [HERO.path]: POSE_OFF_AXIS }]) {
      expect(cameraForPose(poses[HERO.path], DEFAULT_CAMERA)).toBeNull()
      const h = harness({ status: 'hit', camera: CAM, axis: '-x' }, poses)
      renderThumbnail.mockClear()
      run('resetFraming', h.host)
      await flush()

      // Framed by default about the axis the user established.
      expect(renderThumbnail).toHaveBeenCalledWith(MESH, DEFAULT_CAMERA, '-x')
      const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
      expect(put.camera).toBeNull()
      expect(put.axis).toBeUndefined() // kept
      expect(put.posed).toBeUndefined()
      expect(h.setThumb.mock.calls[0]![1]).toMatchObject({ camera: undefined, axis: '-x' })
    }
  })

  it('treats a pose with no cached front view as usable, exactly as the sweep does', async () => {
    // The tempting exception, and a wrong one: pose.ts keeps that pose on
    // purpose ("the orientation is still worth keeping — only the angles are
    // missing"), and reset framing's promise is that the model ends up where
    // an untouched one would be.
    const h = harness({ status: 'hit', camera: CAM, axis: '-x' }, { [HERO.path]: POSE_NO_FRONT })
    const resolved = cameraForPose(POSE_NO_FRONT, DEFAULT_CAMERA)!
    run('resetFraming', h.host)
    await flush()

    expect(renderThumbnail).toHaveBeenCalledWith(MESH, resolved.camera, resolved.axis)
    const put = h.putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.axis).toBeNull()
    expect(put.posed).toBe(POSE_VERSION)
  })
})

describe('both commands', () => {
  it('do not touch the renderer when a viewer takes it mid-job, and finish when it gives it back', async () => {
    // The case `queue.push` alone does not cover, and the reason both commands
    // gate on `whenResumed` the way the sweep does: `suspend()` cannot stop a
    // job that has already started, so a lightbox opened while the mesh loads
    // would otherwise find its render stolen by this one. There is exactly one
    // WebGLRenderer app-wide.
    for (const id of ['reRenderThumbnail', 'resetFraming'] as const) {
      const h = harness({ status: 'hit', camera: CAM })
      renderThumbnail.mockClear()
      let deliverMesh: () => void = () => {}
      h.acquire.mockReturnValue(new Promise<THREE.Object3D>((r) => (deliverMesh = () => r(MESH))))

      run(id, h.host) // the job starts: nothing is suspended yet
      await flush()
      expect(h.acquire).toHaveBeenCalled()

      h.queue.suspend() // a viewer opens while the mesh is still loading
      deliverMesh()
      await flush()
      expect(renderThumbnail).not.toHaveBeenCalled()
      expect(h.putThumb).not.toHaveBeenCalled()

      h.queue.resume()
      await flush()
      expect(renderThumbnail).toHaveBeenCalledTimes(1)
      expect(h.putThumb).toHaveBeenCalledTimes(1)
    }
  })

  it('are not started at all while the queue is already suspended', async () => {
    for (const id of ['reRenderThumbnail', 'resetFraming'] as const) {
      const h = harness({ status: 'hit', camera: CAM })
      renderThumbnail.mockClear()
      h.queue.suspend()
      run(id, h.host)
      await flush()
      expect(h.getThumb).not.toHaveBeenCalled()
      expect(renderThumbnail).not.toHaveBeenCalled()

      h.queue.resume()
      await flush()
      expect(renderThumbnail).toHaveBeenCalledTimes(1)
    }
  })

  it('read the stored orientation from the cache, not from a tile that may have none', async () => {
    // Both are offered on a tile whose thumbnail failed (4b.7), and such a tile
    // carries no camera at all — resolving from it would redraw a user's own
    // orbit at the default.
    const h = harness({ status: 'hit', camera: CAM, axis: '-x' })
    run('reRenderThumbnail', h.host)
    await flush()
    expect(h.getThumb).toHaveBeenCalledWith(HERO.path, HERO.mtime)
    expect(renderThumbnail).toHaveBeenCalledWith(MESH, CAM, '-x')
  })

  it('say so when the render fails, and leave the tile showing what it had', async () => {
    const h = harness({ status: 'hit', camera: CAM })
    h.acquire.mockRejectedValue(new Error('mesh is not a mesh'))
    run('resetFraming', h.host)
    await flush()
    expect(h.report).toHaveBeenCalledWith(RENDER_FAILED)
    expect(h.putThumb).not.toHaveBeenCalled()
    expect(h.setThumb).not.toHaveBeenCalled()
  })
})

/**
 * A cache that keeps the two rules of `server/src/cache.ts` this stage depends
 * on, so the round trip below is a round trip rather than two assertions that
 * happen to agree:
 *   - `:104-105` — a value sets, silence keeps, `null` discards.
 *   - `:108-110` — a PNG-bearing PUT's labels are exactly the ones it declares;
 *     every label it omits is cleared, because an old label must not describe
 *     new pixels.
 */
function fakeCache(): Pick<ApiClient, 'getThumb' | 'putThumb'> {
  interface Row {
    mtime?: number
    png?: Blob
    camera?: CameraState
    axis?: OrbitAxis
    lighting?: LightingMode
    rig?: number
    posed?: number
  }
  const rows = new Map<string, Row>()
  return {
    getThumb: async (path: string, mtime: number) => {
      const row = rows.get(path)
      if (row === undefined) return { status: 'miss' as const }
      const labels = { camera: row.camera, axis: row.axis, lighting: row.lighting, rig: row.rig, posed: row.posed }
      if (row.mtime !== mtime || row.png === undefined) return { status: 'stale' as const, ...labels }
      return { status: 'hit' as const, ...labels, pngUrl: 'blob:cached' }
    },
    putThumb: async (save: ThumbSave) => {
      const prev = rows.get(save.path)
      const fresh = save.png !== undefined
      rows.set(save.path, {
        mtime: fresh ? save.mtime : prev?.mtime,
        png: save.png ?? prev?.png,
        camera: save.camera === null ? undefined : (save.camera ?? prev?.camera),
        axis: save.axis === null ? undefined : (save.axis ?? prev?.axis),
        lighting: fresh ? save.lighting : (save.lighting ?? prev?.lighting),
        rig: fresh ? save.rig : (save.rig ?? prev?.rig),
        posed: fresh ? save.posed : (save.posed ?? prev?.posed),
      })
    },
  }
}

describe('what the next visit makes of the pixels', () => {
  it('a posed re-render is a hit on the next visit, not another re-render', async () => {
    // The whole reason a "pixels only" write still declares lighting, rig and
    // the pose recipe. Drop any one of them and the cache clears that label,
    // the sweep's hit test fails on it, and this tile re-renders on every
    // single visit — for ever, since each re-render writes the same silence.
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const api = fakeCache()
    const poses = { [HERO.path]: POSE }
    const queue = new RenderQueue(2)
    const lru = { acquire: () => Promise.resolve(MESH) } as unknown as MeshLru<THREE.Object3D>
    const host = {
      report: vi.fn(),
      poses,
      api,
      lru,
      queue,
      setThumb: vi.fn(),
    } as unknown as ActionHost

    run('reRenderThumbnail', host)
    await flush()
    expect(renderThumbnail).toHaveBeenCalledTimes(1)

    // Now the grid arrives at this model the ordinary way.
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    // Hoisted: the hook's effect keys off the array's identity, so building it
    // inside the component would re-run the sweep on every render.
    const entries = [HERO]
    const Probe = (): null => {
      useThumbnails(entries, api as ApiClient, lru, queue, poses)
      return null
    }
    await act(async () => root.render(createElement(Probe)))
    await flush()
    await act(async () => {
      await flush()
    })

    expect(renderThumbnail).toHaveBeenCalledTimes(1) // served from the cache
    await act(async () => root.unmount())
    el.remove()
  })
})
