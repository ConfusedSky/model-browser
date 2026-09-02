// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import type { DirEntry, IndexPose } from '../../shared/types'
import type { ApiClient } from '../src/api/client'
import { useThumbnails, type ThumbState } from '../src/hooks/useThumbnails'
import type { MeshLru } from '../src/three/lru'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { POSE_VERSION } from '../src/three/pose'
import { RenderQueue, type Band } from '../src/three/queue'
import { renderThumbnail, RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

// The hook only reaches the renderer through renderThumbnail — fake it.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  // Spread, never a hand-listed factory: RIG_VERSION and THUMB_LIGHTING are the
  // recipe labels these tests assert, and a literal would keep passing across a
  // bump while asserting a value the app no longer writes (client/test/CLAUDE.md).
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The LRU as every cell fakes it (sweep-priority 5.1a): the park gates consult
 * the held-or-loading peek, so a hand-rolled `{ acquire }` object throws the
 * moment a cell sets bands. `warm` is the test-owned warm set — the parking
 * cells stage warm, cold and evicted meshes by mutating it — and `acquire` is
 * the observable read: this fake has no loader, so "the read the rule forbids"
 * is asserted on `acquire` itself.
 */
function fakeLru(
  warm: ReadonlySet<string> = new Set(),
  acquire = vi.fn().mockResolvedValue({} as THREE.Object3D),
): MeshLru<THREE.Object3D> {
  return {
    acquire,
    has: (path: string) => warm.has(path),
    holds: (path: string) => warm.has(path),
  } as unknown as MeshLru<THREE.Object3D>
}

function models(n: number): DirEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `m${i}.stl`,
    path: `/models/m${i}.stl`,
    kind: 'model' as const,
    format: 'stl' as const,
    size: 10,
    mtime: 1,
  }))
}

// `ao` and `poses` are props, not module reads: the hook takes the effective
// preference as a parameter since `ao-refreshes-thumbnails` (1.1), so a test
// changes the preference the way the pill does — by re-rendering with a new
// value — rather than by reaching into `aoToggle`'s closure.
function Harness({
  entries,
  api,
  lru,
  queue,
  ao = true,
  poses,
}: {
  entries: DirEntry[]
  api: ApiClient
  lru: MeshLru<THREE.Object3D>
  queue: RenderQueue
  ao?: boolean
  poses?: Record<string, IndexPose>
}) {
  const { thumbs, setThumb, setPlaceholder, setBands } = useThumbnails(
    entries,
    api,
    lru,
    queue,
    ao,
    poses,
  )
  lastThumbs = thumbs
  lastSetThumb = setThumb
  lastSetPlaceholder = setPlaceholder
  lastSetBands = setBands
  // One line per committed render, so a cell can assert what the grid *passed
  // through* and not only where it ended up — a toggle that blanks every tile
  // to a spinner and back lands on the same final statuses as one that does not.
  renderLog.push(entries.map((e) => `${thumbs.get(e.path)?.status ?? 'none'}:${thumbs.get(e.path)?.url ?? '-'}`))
  return (
    <div>
      {entries.map((e) => (
        <span
          key={e.path}
          data-path={e.path}
          data-status={thumbs.get(e.path)?.status ?? 'none'}
          data-url={thumbs.get(e.path)?.url ?? ''}
        />
      ))}
    </div>
  )
}

/** The hook's own setters, for the cells that write through them from outside. */
let lastSetThumb: ((path: string, state: ThumbState) => void) | null = null
let lastSetPlaceholder: ((path: string, url: string) => void) | null = null
let lastSetBands: ((bands: ReadonlyMap<string, Band>) => void) | null = null
let lastThumbs = new Map<string, ThumbState>()
let renderLog: string[][] = []

let root: Root | null = null
let container: HTMLElement | null = null
let minted = 0

async function render(el: React.ReactElement): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(el)
  })
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 50)))
/** Re-render into the SAME root — a preference change is a re-render, not a remount. */
const rerender = (el: React.ReactElement): Promise<void> =>
  act(async () => {
    root!.render(el)
  })

/** Object URLs minted but not yet revoked — the leak measure 2.2 is about. */
function liveUrls(): number {
  return (
    vi.mocked(URL.createObjectURL).mock.calls.length -
    vi.mocked(URL.revokeObjectURL).mock.calls.length
  )
}

function statuses(): string[] {
  return Array.from(container!.querySelectorAll('span')).map(
    (s) => s.getAttribute('data-status') ?? '',
  )
}

beforeEach(() => {
  // No `setAoEnabled` here any more: since `ao-refreshes-thumbnails` the hook
  // takes the effective preference as a parameter and never reads the store, so
  // every case below states its setting through the `ao` prop — which is also
  // how the pill states it.
  // Distinct per call: the reconciliation cells count live URLs, and one
  // constant string would make every mint and every revoke indistinguishable —
  // a leak and a clean handover would read the same.
  minted = 0
  renderLog = []
  lastThumbs = new Map()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:mint${minted++}`),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
  lastSetThumb = null
  lastSetPlaceholder = null
  // The renderThumbnail spy lives in the module mock, so its calls accumulate
  // across this file — a render *count* assertion reads the whole file's
  // history unless it is reset per test.
  vi.mocked(renderThumbnail).mockClear()
})

describe('thumbnail cache lookups vs the render queue', () => {
  it('cache hits resolve while the queue is suspended — lookups never occupy a slot', async () => {
    const api = {
      getThumb: vi
        .fn()
        .mockResolvedValue({ status: 'hit', pngUrl: 'blob:cached', lighting: THUMB_LIGHTING, rig: RIG_VERSION }),
    } as unknown as ApiClient
    const lru = fakeLru(new Set(), vi.fn())
    const queue = new RenderQueue(2)
    queue.suspend() // a suspended queue runs nothing; hits must not need it

    await render(<Harness entries={models(6)} api={api} lru={lru} queue={queue} />)
    await settle()

    expect(statuses()).toEqual(Array.from({ length: 6 }, () => 'ready'))
    expect(lru.acquire).not.toHaveBeenCalled()
  })

  it('the miss path stays gated: no render work while suspended, completes on resume', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={queue} />)
    await settle()

    expect(statuses()).toEqual(['loading', 'loading']) // lookups ran, tails blocked
    expect(api.getThumb).toHaveBeenCalledTimes(2)
    expect(lru.acquire).not.toHaveBeenCalled()

    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(statuses()).toEqual(['ready', 'ready'])
    expect(api.putThumb).toHaveBeenCalledTimes(2)
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
  })

  it('a hit carrying the retired axis label re-renders, preserving camera and axis', async () => {
    const camera = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] }
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:axisLit',
        camera,
        axis: '-z',
        lighting: 'axis', // the retired spindle-aligned label — no client writes it now
        rig: RIG_VERSION, // current rig — the lighting clause alone must trigger this
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    // The stale PNG was dropped and replaced through the render queue…
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:axisLit')
    expect(lru.acquire).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
    // …with the render PUT recording the producible label, and no camera or
    // axis write — both are preserved by omission.
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
  })

  it('a camera-lit hit serves directly while an axis-lit one re-renders', async () => {
    const api = {
      getThumb: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'hit',
          pngUrl: 'blob:cam',
          lighting: THUMB_LIGHTING,
          rig: RIG_VERSION,
        })
        .mockResolvedValueOnce({ status: 'hit', pngUrl: 'blob:ax', lighting: 'axis', rig: RIG_VERSION }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready', 'ready'])
    expect(lru.acquire).toHaveBeenCalledTimes(1) // only the axis-lit one re-rendered
    expect(api.putThumb).toHaveBeenCalledTimes(1)
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
  })

  // The spec's "A camera-lit cache needs nothing" scenario. The render count is
  // the assertion, not the status: a hit test that treated the label as always
  // stale would still land every tile on 'ready' — after re-rendering and
  // re-uploading all of them, which is exactly the cost this forbids.
  it('a camera-lit cache at the current rig needs nothing: no render, no PUT', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:fresh',
        camera: { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] },
        axis: '-z',
        lighting: THUMB_LIGHTING,
        rig: RIG_VERSION,
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()

    await render(<Harness entries={models(4)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready', 'ready', 'ready', 'ready'])
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
    expect(lru.acquire).not.toHaveBeenCalled()
    expect(api.putThumb).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:fresh')
  })

  it('a failed re-render falls back to the stale PNG instead of an error tile', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:fallback',
        camera: { az: 1, el: 0, distR: 2, target: [0, 0, 0] },
        lighting: 'axis',
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru(new Set(), vi.fn().mockRejectedValue(new Error('load failed')))

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready']) // not 'error' — the old PNG still shows
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:fallback')
  })

  it('a hit from an older rig re-renders, preserving camera, and PUTs the current version', async () => {
    const camera = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] }
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:oldRig',
        camera,
        axis: '-z',
        lighting: THUMB_LIGHTING, // label matches — only the rig version is stale
        rig: 1,
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:oldRig')
    expect(statuses()).toEqual(['ready'])
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING, rig: RIG_VERSION }),
    )
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.camera).toBeUndefined() // stored camera preserved by omission
  })

  it('a legacy hit with no stored label also re-renders', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'hit', pngUrl: 'blob:legacy' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:legacy')
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
    expect(statuses()).toEqual(['ready'])
  })

  it('abandoning a listing cancels its queued lookups', async () => {
    // The limiter replaced the render queue for lookups, so it has to carry
    // the queue's cancellation too — otherwise a dead listing's backlog runs
    // to completion and head-of-line blocks its successor.
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const api = {
      getThumb: vi.fn(() => gate.then(() => ({ status: 'miss' }))),
    } as unknown as ApiClient
    const lru = fakeLru(new Set(), vi.fn())

    await render(<Harness entries={models(20)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()
    expect(api.getThumb).toHaveBeenCalledTimes(8) // the limiter's ceiling

    await act(async () => {
      root!.unmount()
      root = null
    })
    release()
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(8) // the queued 12 never fired
  })

  it('a hit landing after the listing is gone revokes its object URL', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const api = {
      getThumb: vi.fn(() => gate.then(() => ({ status: 'hit', pngUrl: 'blob:orphan' }))),
    } as unknown as ApiClient
    const lru = fakeLru(new Set(), vi.fn())

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()
    await act(async () => {
      root!.unmount()
      root = null
    })
    release()
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:orphan')
  })
})

describe('the sweep follows the occlusion preference', () => {
  const CAM = { az: 1, el: 0.25, distR: 3, target: [0, 0, 0] as [number, number, number] }

  it('with the preference off, the lookup, the render and the PUT all name the unoccluded render', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))

    await render(
      <Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await settle()

    expect(api.getThumb).toHaveBeenCalledWith('/models/m0.stl', 1, false)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, DEFAULT_CAMERA, 'y', false)
    expect(vi.mocked(api.putThumb).mock.calls[0]![0].ao).toBe(false)
  })

  it('with the preference on, all three name the occluded render', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(api.getThumb).toHaveBeenCalledWith('/models/m0.stl', 1, true)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, DEFAULT_CAMERA, 'y', true)
    expect(vi.mocked(api.putThumb).mock.calls[0]![0].ao).toBe(true)
    // That the on-request is *byte-identical* to the one this client sent
    // before renders were keyed by occlusion is the ApiClient's contract, not
    // the hook's — pinned in apiClient.test.ts, which sees the URL. Here the
    // hook can only say which render it asked for.
  })

  it('a first look at the unoccluded render of an oriented model draws under the stored camera', async () => {
    // The server answers a never-written render of an entry that holds an
    // orientation as `stale` *with* the camera (D2), so the tile the user gets
    // after toggling is their own view — not a re-framed default. The hit test
    // is unchanged: this answer is about the render that was asked for.
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'stale', camera: CAM, axis: '-z' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))

    await render(
      <Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await settle()

    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, CAM, '-z', false)
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.ao).toBe(false)
    // Pixels only — the orientation was already the entry's and is preserved
    // by omission, which is also what keeps this PUT from invalidating the
    // occluded sibling it was just toggled away from.
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
  })
})

// ─── ao-refreshes-thumbnails ────────────────────────────────────────────────
// The preference is now an input to the sweep (§1) and a re-run reconciles
// rather than resets (§2). Every cell here changes the setting the way the pill
// does — by re-rendering with a new value — never by reaching into the store.

/** A model entry at an explicit mtime: identity is path **and** mtime (2.1). */
function one(path: string, mtime = 1): DirEntry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    kind: 'model',
    format: 'stl',
    size: 10,
    mtime,
  }
}

const CAM = { az: 1, el: 0.25, distR: 3, target: [0, 0, 0] as [number, number, number] }
const POSE: IndexPose = {
  up: [0, 0, 1],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}
/** The same pose, rebuilt — what a re-landing hands the hook (1.2a). */
const clonePose = (p: IndexPose): IndexPose => ({
  ...p,
  up: [...p.up],
  azimuth_zero: [...p.azimuth_zero],
  front: p.front === null ? null : { ...p.front },
})

/**
 * A cache answering per (path, ao), minting its PNG URL the way `ApiClient`
 * really does — so `liveUrls()` counts what the app would actually hold. A
 * fixed string would make a leak and a clean handover read alike.
 */
function fakeCache(answer: (path: string, ao: boolean) => Record<string, unknown>): ApiClient {
  return {
    getThumb: vi.fn((path: string, _mtime: number, ao: boolean) => Promise.resolve(answer(path, ao))),
    putThumb: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiClient
}
const freshHit = (extra: Record<string, unknown> = {}) => ({
  status: 'hit',
  pngUrl: URL.createObjectURL(new Blob()),
  lighting: THUMB_LIGHTING,
  rig: RIG_VERSION,
  ...extra,
})
const mesh = () => fakeLru()

describe('a preference change refreshes the grid in front of you', () => {
  it('the other setting’s cached render is shown at once: one lookup per tile, no render', async () => {
    // 3.1, cached half. The render count is the assertion: a refresh that
    // re-rendered everything would land on the same statuses.
    const entries = models(3)
    const api = fakeCache(() => freshHit({ camera: CAM, axis: '-z' }))
    const lru = mesh()

    await render(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    const before = entries.map((e) => lastThumbs.get(e.path)!.url!)
    expect(api.getThumb).toHaveBeenCalledTimes(3)

    await rerender(
      <Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await settle()

    // One lookup per tile, naming the *other* render…
    expect(api.getThumb).toHaveBeenCalledTimes(6)
    for (const e of entries) expect(api.getThumb).toHaveBeenCalledWith(e.path, 1, false)
    // …and nothing drawn or uploaded, because both variants are cached.
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
    expect(api.putThumb).not.toHaveBeenCalled()
    // No navigation happened, camera and axis came through unchanged, and each
    // tile is showing the new setting's image with the old one released.
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    for (const e of entries) {
      expect(lastThumbs.get(e.path)!.camera).toEqual(CAM)
      expect(lastThumbs.get(e.path)!.axis).toBe('-z')
    }
    const after = entries.map((e) => lastThumbs.get(e.path)!.url!)
    expect(after).not.toEqual(before)
    for (const url of before) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('a setting with no cached render is drawn, at the stored camera and axis', async () => {
    // 3.1, uncached half. `stale` *with* the orientation is what the server
    // answers for a never-written variant of an oriented entry.
    const entries = models(2)
    const api = fakeCache((_p, ao) =>
      ao ? freshHit({ camera: CAM, axis: '-z' }) : { status: 'stale', camera: CAM, axis: '-z' },
    )
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))

    await render(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()

    await rerender(
      <Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await settle()

    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, CAM, '-z', false)
    expect(api.putThumb).toHaveBeenCalledTimes(2)
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.ao).toBe(false)
    // Preserved by omission, as on a visit.
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
    expect(statuses()).toEqual(['ready', 'ready'])
    for (const e of entries) {
      expect(lastThumbs.get(e.path)!.camera).toEqual(CAM)
      expect(lastThumbs.get(e.path)!.axis).toBe('-z')
    }
  })

  it('a re-render that is not a preference change re-runs nothing', async () => {
    // 3.2, and the reason 1.2 insists on a primitive: an object rebuilt per
    // render would make every re-render a fresh sweep — a toggle into a render
    // loop, invisible to any correctness-only assertion.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    const queue = new RenderQueue(2)

    await render(<Harness entries={models(3)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(api.getThumb).toHaveBeenCalledTimes(3)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(3)
    const commits = renderLog.length

    // A rebuilt array of the same three entries under the same setting: the
    // reconciler runs and finds nothing to do.
    await rerender(<Harness entries={models(3)} api={api} lru={lru} queue={queue} ao />)
    await settle()

    expect(renderLog.length).toBeGreaterThan(commits) // it really did re-render
    expect(api.getThumb).toHaveBeenCalledTimes(3)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(3)
    expect(api.putThumb).toHaveBeenCalledTimes(3)
  })

  it('a toggle never shows a spinner where an image was, and the live URL count holds', async () => {
    // 3.2a — the property that decides whether this change is worth having
    // (D3). Asserted over every commit, not the final one.
    const entries = models(3)
    const api = fakeCache(() => freshHit())
    const lru = mesh()

    await render(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    expect(liveUrls()).toBe(3)

    renderLog = [] // from here on, no tile may lose its image
    for (const ao of [false, true, false, true]) {
      await rerender(
        <Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao={ao} />,
      )
      await settle()
    }

    for (const commit of renderLog) {
      for (const cell of commit) expect(cell.startsWith('ready:blob:')).toBe(true)
    }
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    // Four toggles over three tiles: twelve more PNGs minted, twelve released.
    expect(liveUrls()).toBe(3)
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
  })

  it('two toggles in quick succession settle under the setting chosen last', async () => {
    // 2.4. The first pass's lookups are still in flight when the second starts,
    // and the generation check is what keeps them from landing.
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const entries = models(2)
    const api = {
      getThumb: vi.fn((_p: string, _m: number, ao: boolean) =>
        ao
          ? Promise.resolve(freshHit())
          : gate.then(() => ({ status: 'stale' as const, pngUrl: URL.createObjectURL(new Blob()) })),
      ),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = mesh()

    await render(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    const firstPass = entries.map((e) => lastThumbs.get(e.path)!.url!)

    // Off, then straight back to on before the off pass can answer.
    await rerender(
      <Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await rerender(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    release()
    await settle()

    // Three passes' worth of lookups issued; the middle one landed nothing.
    expect(api.getThumb).toHaveBeenCalledTimes(6)
    expect(vi.mocked(api.getThumb).mock.calls.at(-1)![2]).toBe(true)
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled() // the stale answer was retired
    expect(api.putThumb).not.toHaveBeenCalled()
    expect(statuses()).toEqual(['ready', 'ready'])
    // What is on screen came from the third pass, not the first — each pass
    // mints its own PNG — and the off pass's URL was released, not displayed.
    for (const e of entries) expect(firstPass).not.toContain(lastThumbs.get(e.path)!.url)
    expect(liveUrls()).toBe(2)
  })

  it('a render already under way when the preference changes neither writes nor lands', async () => {
    // 2.3. `queue.suspend()` cannot stop a job that has started (`whenResumed`'s
    // own note), so the outgoing pass arrives here holding pixels drawn under
    // the old setting. `ao-as-recipe-dimension` made that write land under its
    // own key — but the tile it would paint is the one the new pass just
    // settled, which the delta's scenario forbids in as many words.
    let finish!: (png: Blob) => void
    vi.mocked(renderThumbnail).mockImplementationOnce(
      () =>
        new Promise<Blob>((r) => {
          finish = r
        }),
    )
    const api = fakeCache((_p, ao) => (ao ? { status: 'miss' } : freshHit()))
    const lru = mesh()
    const queue = new RenderQueue(2)

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1) // started, still drawing
    expect(statuses()).toEqual(['loading'])

    await rerender(
      <Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />,
    )
    await settle()
    const settled = lastThumbs.get('/models/m0.stl')!.url!
    expect(statuses()).toEqual(['ready']) // the unoccluded render was cached

    finish(new Blob()) // the outgoing pass's pixels arrive, too late
    await settle()

    expect(api.putThumb).not.toHaveBeenCalled()
    expect(lastThumbs.get('/models/m0.stl')!.url).toBe(settled)
    expect(liveUrls()).toBe(1)
  })

  it('a rig difference is upgraded on the visit and by nothing else', async () => {
    // 3.3 / D2: the shipped lazy-upgrade scenario, plus the half this change
    // could have broken — RIG_VERSION must not have become a trigger.
    const entries = models(1)
    const api = fakeCache(() => ({ ...freshHit({ camera: CAM }), rig: 1 }))
    const lru = mesh()

    await render(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1) // once, on the visit
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING, rig: RIG_VERSION }),
    )

    await rerender(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1) // and only once
  })
})

describe('the sweep reconciles its entries instead of resetting them', () => {
  it('adding entries leaves the shown tiles untouched and looks up only the additions', async () => {
    const api = fakeCache(() => freshHit())
    const lru = mesh()
    const first = [one('/models/a.stl'), one('/models/b.stl')]

    await render(<Harness entries={first} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    const kept = first.map((e) => lastThumbs.get(e.path)!.url!)
    expect(api.getThumb).toHaveBeenCalledTimes(2)

    const grown = [...first, one('/models/c.stl')]
    await rerender(<Harness entries={grown} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(3)
    expect(api.getThumb).toHaveBeenLastCalledWith('/models/c.stl', 1, true)
    expect(first.map((e) => lastThumbs.get(e.path)!.url)).toEqual(kept)
    for (const url of kept) expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url)
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
  })

  it('removing an entry revokes its URL and leaves the rest alone', async () => {
    const api = fakeCache(() => freshHit())
    const lru = mesh()
    const first = [one('/models/a.stl'), one('/models/b.stl')]

    await render(<Harness entries={first} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    const [aUrl, bUrl] = first.map((e) => lastThumbs.get(e.path)!.url!)

    await rerender(
      <Harness entries={[first[0]!]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(bUrl)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(aUrl)
    expect(lastThumbs.has('/models/b.stl')).toBe(false)
    expect(api.getThumb).toHaveBeenCalledTimes(2) // no new work
    expect(liveUrls()).toBe(1)
  })

  it('a peek landing mid-pass lets the loading tiles finish — once each, and they land', async () => {
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    const queue = new RenderQueue(2)
    queue.suspend() // the two tails are queued and blocked: still loading
    const first = [one('/models/a.stl'), one('/models/b.stl')]

    await render(<Harness entries={first} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(statuses()).toEqual(['loading', 'loading'])

    const grown = [...first, one('/models/c.stl')]
    await rerender(<Harness entries={grown} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await act(async () => {
      queue.resume()
    })
    await settle()

    // Three entries, three renders: the two in flight neither restarted nor
    // were cancelled by the arrival beside them.
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(3)
    expect(api.getThumb).toHaveBeenCalledTimes(3)
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
  })

  it('a same-path new-mtime entry is a removal, then an addition, on one key', async () => {
    const api = fakeCache(() => freshHit())
    const lru = mesh()

    await render(
      <Harness entries={[one('/models/a.stl', 1)]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    await settle()
    const old = lastThumbs.get('/models/a.stl')!.url!
    renderLog = []

    await rerender(
      <Harness entries={[one('/models/a.stl', 2)]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    // Revoked and reset to `loading` in the same commit — the one case where a
    // spinner replacing an image is correct: those pixels are for a file that
    // is no longer there.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(old)
    expect(renderLog).toContainEqual(['loading:-'])

    await settle()
    expect(api.getThumb).toHaveBeenCalledTimes(2)
    expect(api.getThumb).toHaveBeenLastCalledWith('/models/a.stl', 2, true)
    expect(lastThumbs.get('/models/a.stl')!.url).not.toBe(old)
    expect(liveUrls()).toBe(1)
  })

  it('a surviving entry whose pose changed by value is looked up again, keeping its image', async () => {
    // The rule 1.2a exists for: a meaning search over the tiles on screen
    // replaces `entries` and `poses` together, and the overlapping hits are the
    // same path at the same mtime.
    const api = fakeCache(() => freshHit({ posed: POSE_VERSION }))
    const lru = mesh()
    const queue = new RenderQueue(2)

    await render(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{}}
      />,
    )
    await settle()
    const before = lastThumbs.get('/models/a.stl')!.url!
    renderLog = []

    // A landing replaces `entries` and `poses` together. Same path, same mtime:
    // the entry survives, so this is the reconciler's by-value compare and not
    // an addition. (Since `pose-for-every-model` the map alone re-runs the
    // effect too — the cell below this pair drives that, which is the wave's
    // case; here both move, which is a landing's.)
    await rerender(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': POSE }}
      />,
    )
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(2)
    for (const commit of renderLog) expect(commit[0]!.startsWith('ready:blob:')).toBe(true)
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled() // the hit still holds
    expect(lastThumbs.get('/models/a.stl')!.url).not.toBe(before)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(before)
  })

  it('an identical pose under a rebuilt map issues nothing', async () => {
    // The other half of by-value: `poses` is a fresh object on every landing —
    // and, since `pose-for-every-model`, on every wave — and the map's identity
    // is now what re-runs the sweep, so reference comparison of the poses
    // *inside* it would re-look-up every tile on every one.
    const api = fakeCache(() => freshHit({ posed: POSE_VERSION }))
    const lru = mesh()
    const queue = new RenderQueue(2)

    await render(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': POSE }}
      />,
    )
    await settle()
    expect(api.getThumb).toHaveBeenCalledTimes(1)

    // The landing again: a new entries array, a new poses map, the same pose.
    await rerender(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': clonePose(POSE) }}
      />,
    )
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
  })

  it('a pose arriving over an unchanged listing re-looks-up only what it named', async () => {
    // The wave (`pose-for-every-model` D3), which is the case 1.2a did not
    // foresee: the poses map changes and `entries` does not — the SAME array,
    // by identity, because no landing happened. Without `poses` in the sweep's
    // dependency list this effect never re-runs at all and the wave is inert;
    // with it, the by-value walk above touches the one entry the index spoke
    // about and leaves the other exactly as it is.
    const api = fakeCache(() => freshHit({ posed: POSE_VERSION }))
    const lru = mesh()
    const queue = new RenderQueue(2)
    // Held in a const and passed to both renders: a fresh array would make this
    // cell a landing again and it would pass with `poses` out of the deps.
    const entries = [one('/models/a.stl'), one('/models/b.stl')]

    await render(
      <Harness entries={entries} api={api} lru={lru} queue={queue} ao poses={{}} />,
    )
    await settle()
    expect(api.getThumb).toHaveBeenCalledTimes(2)
    const bBefore = lastThumbs.get('/models/b.stl')!.url!
    renderLog = []

    await rerender(
      <Harness
        entries={entries}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': POSE }}
      />,
    )
    await settle()

    // One more lookup, and it is a's.
    expect(api.getThumb).toHaveBeenCalledTimes(3)
    expect(api.getThumb).toHaveBeenLastCalledWith('/models/a.stl', 1, true)
    // Every commit in between shows both tiles with an image: the wave does not
    // reset the grid (the delta's *A pose wave does not reset the grid*).
    for (const commit of renderLog) {
      for (const cell of commit) expect(cell.startsWith('ready:blob:')).toBe(true)
    }
    // The tile the index said nothing about was not touched at all.
    expect(lastThumbs.get('/models/b.stl')!.url).toBe(bBefore)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(bBefore)
  })

  it('a loading entry whose pose changes is restarted once', async () => {
    // Its in-flight render may be drawing under the old pose, so unlike a
    // finished tile it is cancelled and re-run — but exactly once.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': POSE }}
      />,
    )
    await settle()
    expect(statuses()).toEqual(['loading'])
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()

    await rerender(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': { ...clonePose(POSE), confidence: 0.4 } }}
      />,
    )
    await settle()
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(2)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1) // the retired tail never ran
    expect(api.putThumb).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
  })

  it('a loading entry whose pose did not change is left running', async () => {
    // The missing quadrant. The three cells above cover a *settled* tile under
    // an unchanged pose, a settled tile under a changed one, and a *loading*
    // tile under a changed one; this is a loading tile under an unchanged one,
    // which is the case a wave actually produces most often — the map's
    // identity moves for every entry it touches, and a grid mid-first-pass has
    // work in flight for all of them.
    //
    // Restarting it would be wrong and invisible: the render it cancels and the
    // one it starts draw the same pixels, so nothing on screen would say the
    // work had been thrown away and redone. The render count is the assertion.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    const queue = new RenderQueue(2)
    queue.suspend()
    // The same array through both renders: a fresh one would be a landing, and
    // a landing re-runs the sweep for its own reason. Here only the map moves,
    // which is exactly what a wave does.
    const entries = [one('/models/a.stl'), one('/models/b.stl')]

    await render(
      <Harness
        entries={entries}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': POSE }}
      />,
    )
    await settle()
    expect(statuses()).toEqual(['loading', 'loading'])
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled() // still suspended

    // The wave: a new map, `a`'s pose rebuilt but identical, `b` given one it
    // did not have. `b` is the control — without it a sweep that never re-ran
    // at all would pass this cell, and the claim is that it re-ran and chose to
    // leave `a` alone.
    await rerender(
      <Harness
        entries={entries}
        api={api}
        lru={lru}
        queue={queue}
        ao
        poses={{ '/models/a.stl': clonePose(POSE), '/models/b.stl': POSE }}
      />,
    )
    await settle()
    await act(async () => {
      queue.resume()
    })
    await settle()

    const lookups = (path: string): number =>
      vi.mocked(api.getThumb).mock.calls.filter((c) => c[0] === path).length
    // `a` was looked up once and never again: its in-flight work is the work
    // that finished. `b`'s pose genuinely arrived, so it was retired and re-run.
    expect(lookups('/models/a.stl')).toBe(1)
    expect(lookups('/models/b.stl')).toBe(2)
    // One render apiece — `b`'s retired tail never ran either.
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(2)
    expect(api.putThumb).toHaveBeenCalledTimes(2)
    expect(statuses()).toEqual(['ready', 'ready'])
  })

  it('a preference change retires every entry’s work while every image stays up', async () => {
    // 2.1's retirement rule, watched in the window where it is visible: the new
    // pass's lookups are in flight and the old images are still on screen.
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const entries = models(3)
    const api = {
      getThumb: vi.fn((_p: string, _m: number, ao: boolean) =>
        ao ? Promise.resolve(freshHit()) : gate.then(() => freshHit()),
      ),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = mesh()

    await render(<Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    const before = entries.map((e) => lastThumbs.get(e.path)!.url!)

    await rerender(
      <Harness entries={entries} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await settle()

    // Retired and re-looked-up…
    expect(api.getThumb).toHaveBeenCalledTimes(6)
    // …with nothing given up in the meantime.
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    expect(entries.map((e) => lastThumbs.get(e.path)!.url)).toEqual(before)
    for (const url of before) expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url)

    release()
    await settle()
    expect(entries.map((e) => lastThumbs.get(e.path)!.url)).not.toEqual(before)
    for (const url of before) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    expect(liveUrls()).toBe(3)
  })

  it('under StrictMode’s unmount → remount every entry starts again, and no URL leaks', async () => {
    // The invariant behind `slots.clear()`, and the only way to actually test
    // it: StrictMode simulates unmount→remount **on the same instance**, so the
    // ref survives where a fresh mount would hand out a new one. A disposal
    // that emptied the work but left the map populated would make the second
    // pass's reconciler see every entry as already present and start nothing —
    // the dev grid would sit on spinners for ever.
    const api = fakeCache(() => freshHit())
    const lru = mesh()

    await render(
      <StrictMode>
        <Harness entries={models(3)} api={api} lru={lru} queue={new RenderQueue(2)} ao />
      </StrictMode>,
    )
    await settle()

    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    expect(liveUrls()).toBe(3) // the discarded first pass left nothing behind
  })

  it('a real unmount releases every displayed URL, and a fresh mount starts over', async () => {
    const api = fakeCache(() => freshHit())
    const lru = mesh()
    const el = <Harness entries={models(3)} api={api} lru={lru} queue={new RenderQueue(2)} ao />

    await render(el)
    await settle()
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    expect(liveUrls()).toBe(3)

    await act(async () => {
      root!.unmount()
    })
    container!.remove()
    expect(liveUrls()).toBe(0)

    await render(el)
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(6)
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    expect(liveUrls()).toBe(3)
  })

  it('a setThumb from outside the hook revokes the URL it displaces', async () => {
    // 2.2: `App`'s `persist` and `entryActions` mint their own URLs and write
    // through this setter. Ownership lives on the entry, so the one actually
    // displayed is the one released.
    const api = fakeCache(() => freshHit())
    const lru = mesh()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    const shown = lastThumbs.get('/models/m0.stl')!.url!

    await act(async () => {
      lastSetThumb!('/models/m0.stl', { status: 'ready', url: 'blob:fromOutside' })
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(shown)
    expect(lastThumbs.get('/models/m0.stl')!.url).toBe('blob:fromOutside')
  })

  it('an embedded preview is released when the render that replaces it lands', async () => {
    // Beyond 2.2's letter, approved as part of it: `setPlaceholder` writes an
    // object URL the LRU minted for an embedded 3MF preview, and nothing used
    // to revoke it — one decoded PNG leaked per previewed model.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(statuses()).toEqual(['loading'])

    await act(async () => {
      lastSetPlaceholder!('/models/m0.stl', 'blob:preview')
    })
    expect(lastThumbs.get('/models/m0.stl')!.url).toBe('blob:preview')

    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(statuses()).toEqual(['ready'])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  // ── The aggregate review's four findings (2026-08-31) ─────────────────────
  // The reconciler landed with `setThumb` joining a URL to ownership only where
  // a slot existed, and retiring nothing. These four are the repro scenarios.

  it('a setThumb for an entry the listing dropped is released, not filed', async () => {
    // F1: an `entryActions` command is on no slot's cancel list, so it can
    // finish after a navigation removed its entry. Filed, its `thumbs` entry
    // would be deleted by nothing and its URL revoked by nothing — the removal
    // loop and the disposal both walk slots.
    const api = fakeCache(() => freshHit())
    const lru = mesh()

    await render(
      <Harness entries={[one('/models/a.stl')]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    await settle()
    const shown = lastThumbs.get('/models/a.stl')!.url!

    await rerender(<Harness entries={[]} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(lastThumbs.size).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(shown)

    await act(async () => {
      lastSetThumb!('/models/a.stl', { status: 'ready', url: 'blob:late' })
    })

    expect(lastThumbs.size).toBe(0) // no ghost
    expect(lastThumbs.has('/models/a.stl')).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late')
  })

  it('an outside setThumb retires the tail that would have landed on top of it', async () => {
    // F2: the persist shape — `App` writes the lightbox's closing render into
    // the map while the sweep's own tail is still parked behind a suspended
    // queue. That tail renders at the camera *its* lookup captured, so letting
    // it land would replace the newer image, revoke its URL, and pair
    // old-angle pixels with the fresh camera in the cache.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(
      <Harness entries={[one('/models/a.stl')]} api={api} lru={lru} queue={queue} ao />,
    )
    await settle()
    expect(statuses()).toEqual(['loading']) // the tail is queued, not run

    await act(async () => {
      lastSetThumb!('/models/a.stl', {
        status: 'ready',
        url: 'blob:persisted',
        camera: CAM,
        axis: '-z',
      })
    })

    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(lastThumbs.get('/models/a.stl')).toEqual({
      status: 'ready',
      url: 'blob:persisted',
      camera: CAM,
      axis: '-z',
    })
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:persisted')
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled() // never painted
    expect(api.putThumb).not.toHaveBeenCalled() // and never filed
  })

  it('a lookup that fails mid-toggle keeps the image the tile is showing', async () => {
    // F3: the lookup's own catch used to write a bare `{status:'error'}`,
    // which displaces the slot's URL and so revokes it — against "keep each
    // existing image until its replacement exists", and a failed lookup
    // produced no replacement.
    const lru = mesh()
    const api = {
      getThumb: vi.fn((_p: string, _m: number, ao: boolean) =>
        ao ? Promise.resolve(freshHit()) : Promise.reject(new Error('cache offline')),
      ),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient

    await render(
      <Harness entries={[one('/models/a.stl')]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    await settle()
    const shown = lastThumbs.get('/models/a.stl')!.url!
    expect(statuses()).toEqual(['ready'])

    await rerender(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={new RenderQueue(2)}
        ao={false}
      />,
    )
    await settle()

    const after = lastThumbs.get('/models/a.stl')!
    expect(after.status).toBe('error')
    expect(after.url).toBe(shown)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(shown)
    expect(liveUrls()).toBe(1)
  })

  it('a render that fails after a miss keeps the image the tile is showing', async () => {
    // The sibling of the F3 cell above, flagged in its review: when the
    // lookup answers a miss (no staleUrl to fall back on) and the *render*
    // then fails, the tail's catch wrote the same bare `{status:'error'}` and
    // blanked the image a previous pass had put on the tile.
    const lru = mesh()
    // The initial pass is a pure hit and never renders; the toggle's miss is
    // the first render call, and it dies.
    vi.mocked(renderThumbnail).mockRejectedValueOnce(new Error('render died'))
    const api = {
      getThumb: vi.fn((_p: string, _m: number, ao: boolean) =>
        Promise.resolve(ao ? freshHit() : { status: 'miss' }),
      ),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient

    await render(
      <Harness entries={[one('/models/a.stl')]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    await settle()
    const shown = lastThumbs.get('/models/a.stl')!.url!
    expect(statuses()).toEqual(['ready'])

    await rerender(
      <Harness
        entries={[one('/models/a.stl')]}
        api={api}
        lru={lru}
        queue={new RenderQueue(2)}
        ao={false}
      />,
    )
    await settle()

    const after = lastThumbs.get('/models/a.stl')!
    expect(after.status).toBe('error')
    expect(after.url).toBe(shown)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(shown)
  })

  it('a preview the state guard refuses is still owned, and released with the entry', async () => {
    // F4: the slot read and assignment moved out of the `setThumbs` updater,
    // which React may replay. The two views can still disagree in one place —
    // a bare `{status:'error'}` tile owns no URL, so the slot check passes
    // where the state guard refuses — and that is left alone deliberately: the
    // slot keeps the URL unshown but *owned*, which is what every release path
    // walks.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = mesh()
    vi.mocked(renderThumbnail).mockImplementationOnce(() => Promise.reject(new Error('no webgl')))

    await render(
      <Harness entries={[one('/models/a.stl')]} api={api} lru={lru} queue={new RenderQueue(2)} ao />,
    )
    await settle()
    expect(statuses()).toEqual(['error'])
    expect(lastThumbs.get('/models/a.stl')!.url).toBeUndefined()

    await act(async () => {
      lastSetPlaceholder!('/models/a.stl', 'blob:refused')
    })
    // Refused for display — the tile keeps its error — and not revoked here…
    expect(lastThumbs.get('/models/a.stl')!.url).toBeUndefined()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:refused')

    // …because the slot owns it, and the removal loop is one of the three
    // paths that release what a slot owns.
    await rerender(<Harness entries={[]} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:refused')

    // A preview for a path with no slot at all is released on the spot: the
    // LRU loader hands the URL over and keeps no handle of its own.
    await act(async () => {
      lastSetPlaceholder!('/models/a.stl', 'blob:orphan')
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:orphan')
    expect(lastThumbs.has('/models/a.stl')).toBe(false)
  })
})

// ─── thumbnail-sweep-priority ───────────────────────────────────────────────
// Visible-first ordering and the parked state. Bands reach the hook the way
// App forwards Grid's reports — through `setBands` — and the LRU's warm set is
// the 5.1a factory's, mutated to stage warm, cold and evicted meshes.

/** Push a band map the way a report arrives. */
const bands = (pairs: Record<string, Band>): Promise<void> =>
  act(async () => {
    lastSetBands!(new Map(Object.entries(pairs)))
  })

/** The paths `acquire` was asked for, in execution order — the observable
 *  reads, and (under concurrency 1) the render order. */
const acquired = (lru: MeshLru<THREE.Object3D>): string[] =>
  vi.mocked(lru.acquire).mock.calls.map((c) => c[0] as string)

describe('visible-first ordering and the parked state', () => {
  it('bottom tiles reported visible render before the earlier ones — fails under FIFO', async () => {
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend() // every tail queued, nothing started: ordering is rank's alone

    await render(<Harness entries={models(6)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m4.stl': 'visible', '/models/m5.stl': 'visible' })

    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(acquired(lru).slice(0, 2)).toEqual(['/models/m4.stl', '/models/m5.stl'])
    expect(statuses()).toEqual(Array.from({ length: 6 }, () => 'ready'))
  })

  it('a tile parked before starting is not rendered; unparked, it lands and never errors', async () => {
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m1.stl': 'far' })
    await act(async () => {
      queue.resume()
    })
    await settle()

    // The parked tile keeps its placeholder — loading, never the error state.
    expect(statuses()).toEqual(['ready', 'loading'])
    expect(acquired(lru)).toEqual(['/models/m0.stl'])

    await bands({ '/models/m1.stl': 'visible' })
    await settle()

    expect(statuses()).toEqual(['ready', 'ready'])
    // No commit in between showed the error state.
    for (const commit of renderLog) for (const cell of commit) expect(cell.startsWith('error')).toBe(false)
  })

  it('absent is never far: a path the map omits still renders', async () => {
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' }) // m1 unmentioned
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(statuses()).toEqual(['loading', 'ready'])
    expect(acquired(lru)).toEqual(['/models/m1.stl'])
  })

  it('a fully cached listing is unaffected by any band map', async () => {
    const api = fakeCache(() => freshHit())
    const lru = fakeLru()

    await render(<Harness entries={models(3)} api={api} lru={lru} queue={new RenderQueue(2)} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far', '/models/m1.stl': 'far', '/models/m2.stl': 'far' })
    await settle()

    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
    expect(lru.acquire).not.toHaveBeenCalled()
  })

  it('a preference change over a parked far tile shows a cached new-setting render at once', async () => {
    // 4.1's cached half: the retirement restarts the lookup, parked or not.
    const api = fakeCache((_p, ao) => (ao ? { status: 'miss' } : freshHit()))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' })

    await rerender(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />)
    await settle()

    expect(statuses()).toEqual(['ready']) // repainted from the cache, still parked
    expect(api.getThumb).toHaveBeenCalledTimes(2)
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
    expect(lru.acquire).not.toHaveBeenCalled()
  })

  it('a retirement of a parked cold slot issues its lookup and no push and no acquire', async () => {
    // 4.1's uncached half — D5's own path through the tail gate: the fresh
    // lookup runs, and it is the tail's own gate that withholds the render.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' })
    await act(async () => {
      queue.resume()
    })

    await rerender(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />)
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(2) // the retirement's fresh lookup ran
    expect(lru.acquire).not.toHaveBeenCalled() // and its tail was withheld
    expect(statuses()).toEqual(['loading'])
  })

  it('a parked tail restarts under the current recipe, never the parked one', async () => {
    // 4.2: parking does not freeze a pass, it cancels one; unparking reads the
    // slot's recipe as it is then.
    const api = fakeCache(() => ({ status: 'miss' }))
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' }) // parked under ao=true
    await act(async () => {
      queue.resume()
    })

    await rerender(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />)
    await settle()
    await bands({ '/models/m0.stl': 'visible' }) // unpark under ao=false
    await settle()

    expect(vi.mocked(api.getThumb).mock.calls.at(-1)![2]).toBe(false)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, DEFAULT_CAMERA, 'y', false)
    expect(vi.mocked(api.putThumb).mock.calls[0]![0].ao).toBe(false)
  })

  it('a far tile whose mesh is warm renders after every visible tile, and its PNG is filed', async () => {
    // 3.4a, with its control: the same tile cold is parked instead.
    const warm = new Set(['/models/m2.stl'])
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru(warm)
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(3)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({
      '/models/m0.stl': 'visible',
      '/models/m1.stl': 'visible',
      '/models/m2.stl': 'far',
    })
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(acquired(lru)).toEqual(['/models/m0.stl', '/models/m1.stl', '/models/m2.stl'])
    expect(api.putThumb).toHaveBeenCalledTimes(3) // the kept job filed its PNG
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])

    // The control, cold: same shape, no warm set — the far tile parks.
    await act(async () => {
      root!.unmount()
    })
    vi.mocked(renderThumbnail).mockClear()
    const lru2 = fakeLru()
    const api2 = fakeCache(() => ({ status: 'miss' }))
    const queue2 = new RenderQueue(1)
    queue2.suspend()
    await render(<Harness entries={models(3)} api={api2} lru={lru2} queue={queue2} ao />)
    await settle()
    await bands({
      '/models/m0.stl': 'visible',
      '/models/m1.stl': 'visible',
      '/models/m2.stl': 'far',
    })
    await act(async () => {
      queue2.resume()
    })
    await settle()
    expect(acquired(lru2)).toEqual(['/models/m0.stl', '/models/m1.stl'])
    expect(statuses()).toEqual(['ready', 'ready', 'loading'])
  })

  it('a kept job woken cold and still far parks itself — proven by rendering on return', async () => {
    // The self-park sets the flag, asserted by consequence: report the path
    // visible afterwards and it renders, which only happens if the unpark path
    // could reach it — re-ranking alone would find no queued job.
    const warm = new Set(['/models/m0.stl'])
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru(warm)
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' }) // kept: warm, so not parked
    warm.delete('/models/m0.stl') // evicted before its turn
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(lru.acquire).not.toHaveBeenCalled() // parking never causes a mesh read
    expect(statuses()).toEqual(['loading']) // never error

    await bands({ '/models/m0.stl': 'visible' })
    await settle()

    expect(acquired(lru)).toEqual(['/models/m0.stl'])
    expect(statuses()).toEqual(['ready'])
  })

  it('a kept job woken with its tile no longer far reads and renders — no stranded tile', async () => {
    // The round-2 regression: kept means never flagged, so if the wake-up
    // check consulted only the mesh, a visible tile would sit on loading with
    // nothing to ever restart it.
    const warm = new Set(['/models/m0.stl'])
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru(warm)
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' }) // kept at the far rank
    warm.delete('/models/m0.stl') // evicted while queued
    await bands({ '/models/m0.stl': 'visible' }) // the user scrolled back
    await act(async () => {
      queue.resume()
    })
    await settle()

    // Woken visible: it pays the read — exactly right for a tile on screen.
    expect(acquired(lru)).toEqual(['/models/m0.stl'])
    expect(statuses()).toEqual(['ready'])
  })

  it('a slot created after the last report is still gated far by the band ref', async () => {
    // The reconciler's same-path-new-mtime replacement starts unconditionally;
    // the tail's read of the band in force is what parks it.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)

    await render(<Harness entries={[one('/models/a.stl', 1)]} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(statuses()).toEqual(['ready'])
    await bands({ '/models/a.stl': 'far' })

    await rerender(
      <Harness entries={[one('/models/a.stl', 2)]} api={api} lru={lru} queue={queue} ao />,
    )
    await settle()

    expect(api.getThumb).toHaveBeenLastCalledWith('/models/a.stl', 2, true)
    expect(acquired(lru)).toEqual(['/models/a.stl']) // the first render's read only
    expect(statuses()).toEqual(['loading'])
  })

  it('an unpark landing while the retirement’s lookup is in flight runs one pass, not two', async () => {
    // 3.3b: unpark is clear-flag → retire → start, so the in-flight pass is
    // dead before its successor exists. A bare start beside it runs two passes
    // of one generation — both stay alive() into the queue, and at the queue's
    // real concurrency of two they read and render the same mesh twice.
    // (`setThumb`'s own retire dedupes the *PUT* either way — the second pass
    // dies at its pre-PUT check — so the read and the render are the
    // observables here, not the write. Falsified against the bare-start
    // variant, which is how the PUT-count claim was caught overstating.)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const api = {
      getThumb: vi.fn((_p: string, _m: number, ao: boolean) =>
        ao ? Promise.resolve({ status: 'miss' }) : gate.then(() => ({ status: 'miss' })),
      ),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = fakeLru()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' }) // parked cold
    await act(async () => {
      queue.resume()
    })

    // The toggle retires the parked slot; its fresh lookup hangs on the gate.
    await rerender(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />)
    // The tile comes back while that lookup is still in flight.
    await bands({ '/models/m0.stl': 'visible' })
    release()
    await settle()

    expect(lru.acquire).toHaveBeenCalledTimes(1) // one mesh read, not two
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1)
    expect(api.putThumb).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
  })

  it('a park landing after a render started leaves its stale-PNG fallback intact', async () => {
    // 1.2a: the cancel handle answers false for a started job, so the park
    // must not fire dropStale — the render's own catch still needs the stale
    // PNG, and revoking it would write the error state 3.4 forbids.
    let fail!: (err: Error) => void
    vi.mocked(renderThumbnail).mockImplementationOnce(
      () =>
        new Promise<Blob>((_r, reject) => {
          fail = reject
        }),
    )
    const api = fakeCache(() => ({
      status: 'hit',
      pngUrl: URL.createObjectURL(new Blob()),
      lighting: 'axis', // the retired label: stale pixels, re-render queued
    }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1) // started, drawing

    await bands({ '/models/m0.stl': 'far' }) // the park lands under it
    fail(new Error('render died'))
    await settle()

    // The catch fell back to the stale PNG — never the error state.
    expect(statuses()).toEqual(['ready'])
    for (const commit of renderLog) for (const cell of commit) expect(cell.startsWith('error')).toBe(false)
  })
})
