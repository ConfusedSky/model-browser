// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import type { DirEntry, FeatureReport, IndexPose } from '../../shared/types'
import type { ApiClient } from '../src/api/client'
import { withLocalFramings, writeLocalFraming } from '../src/api/localFramings'
import { resetLookupQueueForTests, useThumbnails, type ThumbState } from '../src/hooks/useThumbnails'
import { thumbImageUrl } from '../src/api/thumbUrl'
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
 * The LRU as every cell fakes it (sweep-priority 5.1a): one factory so the
 * hook's view of the LRU cannot drift from cell to cell. `warm` answers `has`;
 * `acquire` is the observable read — this fake has no loader, so "what was
 * read, and in what order" is asserted on `acquire` itself.
 */
function fakeLru(
  warm: ReadonlySet<string> = new Set(),
  acquire = vi.fn().mockResolvedValue({} as THREE.Object3D),
): MeshLru<THREE.Object3D> {
  return {
    acquire,
    has: (path: string) => warm.has(path),
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
  features,
  libraryId,
}: {
  entries: DirEntry[]
  api: ApiClient
  lru: MeshLru<THREE.Object3D>
  queue: RenderQueue
  ao?: boolean
  poses?: Record<string, IndexPose>
  /**
   * The feature report, as App passes it: a getter, not the report, so a
   * resolving report cannot re-run the sweep (`public-deployment` D6). Omitted
   * by every cell but the local-framing ones, which is "the report is unknown".
   */
  features?: () => FeatureReport | null
  /**
   * The library the tiles belong to, also as App passes it — the local-framing
   * store keys by library and path, so a cell that expects a kept framing must
   * name one. Omitted elsewhere, which is "the library is not known yet" and
   * keeps nothing.
   */
  libraryId?: () => string | null
}) {
  const { thumbs, setThumb, refetch, setPlaceholder, applyLocalFramings, setBands, reportImageError } = useThumbnails(
    entries,
    api,
    lru,
    queue,
    ao,
    poses,
    entries,
    features,
    libraryId,
  )
  lastThumbs = thumbs
  lastSetThumb = setThumb
  lastRefetch = refetch
  lastApplyLocalFramings = applyLocalFramings
  lastSetPlaceholder = setPlaceholder
  lastSetBands = setBands
  lastReportImageError = reportImageError
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
let lastRefetch: ((path: string) => void) | null = null
/** The report-resolved overlay (`public-deployment`, review F4), called the way
 *  App's own effect calls it. */
let lastApplyLocalFramings: (() => void) | null = null
let lastSetPlaceholder: ((path: string, url: string) => void) | null = null
let lastSetBands: ((bands: ReadonlyMap<string, Band>) => void) | null = null
let lastReportImageError: ((path: string) => void) | null = null
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
  // The lookup queue is module-level and ranked: a held far lookup one cell
  // leaves behind would be dispatched by the next cell's report.
  resetLookupQueueForTests()
  // A real constructor, statics overridden — see `appHarness`'s `mount` for
  // why a spread copy is not one.
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => `blob:mint${minted++}`),
      revokeObjectURL: vi.fn(),
    }),
  )
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
  lastRefetch = null
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))

    await render(
      <Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} ao={false} />,
    )
    await settle()

    expect(api.getThumb).toHaveBeenCalledWith('/models/m0.stl', 1, false)
    // 'z': an STL with no stored axis renders about its format's up axis (D2).
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, DEFAULT_CAMERA, 'z', false)
    expect(vi.mocked(api.putThumb).mock.calls[0]![0].ao).toBe(false)
  })

  it('with the preference on, all three name the occluded render', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(api.getThumb).toHaveBeenCalledWith('/models/m0.stl', 1, true)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, DEFAULT_CAMERA, 'z', true)
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
      putThumb: vi.fn().mockResolvedValue({}),
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
    putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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
      putThumb: vi.fn().mockResolvedValue({}),
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

describe('visible-first ordering and deferral', () => {
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

  it('far work waits behind everything nearer, then drains — a listing left open warms itself', async () => {
    // Deferral, not parking (D4): the far tile is never rendered ahead of
    // nearer work, and it is rendered once nothing nearer is pending. Under
    // the parked design this cell's last assertion fails — the far tile stays
    // `loading` forever.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(3)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far', '/models/m1.stl': 'visible', '/models/m2.stl': 'near' })
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(acquired(lru)).toEqual(['/models/m1.stl', '/models/m2.stl', '/models/m0.stl'])
    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
    for (const commit of renderLog) for (const cell of commit) expect(cell.startsWith('error')).toBe(false)
  })

  it('absent is never far: a path the map omits runs before deferred work', async () => {
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

    expect(acquired(lru)).toEqual(['/models/m1.stl', '/models/m0.stl'])
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
    expect(api.getThumb).toHaveBeenCalledTimes(3) // a re-rank re-looks-up nothing
  })

  it('a preference change over a far tile shows a cached new-setting render at once', async () => {
    // 4.1's cached half: the retirement restarts the lookup whatever the band.
    const api = fakeCache((_p, ao) => (ao ? { status: 'miss' } : freshHit()))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' })

    await rerender(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />)
    await settle()

    expect(statuses()).toEqual(['ready']) // repainted from the cache
    expect(api.getThumb).toHaveBeenCalledTimes(2)
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
  })

  it('a retirement’s fresh render queues at the position in force, behind nearer work', async () => {
    // 4.1's uncached half under deferral (D5): the fresh tail is pushed, not
    // withheld — and it waits behind the visible tile.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()

    // The same array through both renders: a toggle keeps `thumbEntries`'
    // identity, and a fresh array would be a landing — which resets the
    // ranking (the cell below this one).
    const entries = models(2)
    await render(<Harness entries={entries} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far', '/models/m1.stl': 'visible' })
    await rerender(<Harness entries={entries} api={api} lru={lru} queue={queue} ao={false} />)
    await settle()
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(acquired(lru)).toEqual(['/models/m1.stl', '/models/m0.stl'])
    expect(vi.mocked(api.putThumb).mock.calls.every((c) => c[0].ao === false)).toBe(true)
  })

  it('deferred work renders under the current recipe, never the one it was queued under', async () => {
    // 4.2: the job reads `slot.ao`/`slot.pose` when it runs; a retirement in
    // between kills the old tail through the generation check.
    const api = fakeCache(() => ({ status: 'miss' }))
    const obj = {} as THREE.Object3D
    const lru = fakeLru(new Set(), vi.fn().mockResolvedValue(obj))
    const queue = new RenderQueue(1)
    queue.suspend()

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far' }) // queued far under ao=true
    await rerender(<Harness entries={models(1)} api={api} lru={lru} queue={queue} ao={false} />)
    await settle()
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderThumbnail)).toHaveBeenCalledWith(obj, DEFAULT_CAMERA, 'z', false)
    expect(vi.mocked(api.putThumb).mock.calls[0]![0].ao).toBe(false)
  })

  it('a listing change resets the ranking: the old listing’s verdicts do not order the new one', async () => {
    // Code-review finding 5. The same paths survive into a new `entries`
    // identity; without the reset, m0's `far` from the old listing would still
    // push it behind m1.
    const api = fakeCache(() => ({ status: 'miss' }))
    const lru = fakeLru()
    const queue = new RenderQueue(1)
    queue.suspend()
    const first = models(2)

    await render(<Harness entries={first} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await bands({ '/models/m0.stl': 'far', '/models/m1.stl': 'visible' })

    // A landing: a fresh array of the same entries. Survivors keep their slots
    // and their queued tails; the ranking must not survive with them.
    await rerender(<Harness entries={models(2)} api={api} lru={lru} queue={queue} ao />)
    await settle()
    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(acquired(lru)).toEqual(['/models/m0.stl', '/models/m1.stl']) // insertion order: unreported
  })
})

/**
 * The write generation the hook carries per entry
 * (`immutable-thumbnail-serving` 2.2). It is learned passively — from the
 * answers the hook already reads — and spent on the next fetch for that entry.
 */
describe('the generation a tile keys its next fetch from', () => {
  /** A cache that reports generations and records what each lookup asked for. */
  function genCache(answer: (path: string, ao: boolean) => Record<string, unknown>, putGen: number) {
    const asked: (number | undefined)[] = []
    const api = {
      getThumb: vi.fn((path: string, _mtime: number, ao: boolean, gen?: number) => {
        asked.push(gen)
        return Promise.resolve(answer(path, ao))
      }),
      putThumb: vi.fn().mockResolvedValue({ gen: putGen }),
    } as unknown as ApiClient
    return { api, asked }
  }

  it('asks with nothing on a first sight, then with what the answer taught it', async () => {
    // A hit, so no render and no PUT: the only thing that can teach the slot a
    // generation here is the GET echo itself.
    const { api, asked } = genCache(() => freshHit({ gen: 42 }), 0)
    const queue = new RenderQueue(2)
    const entries = models(1)

    await render(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao />)
    await settle()
    expect(asked).toEqual([undefined]) // nothing known yet: the validator tier

    // A toggle retires the pass and looks the same entry up again. The slot
    // survives a retirement, so the generation it learned survives with it —
    // and it is entry-level, so the *other* render's request carries it too.
    await rerender(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao={false} />)
    await settle()
    expect(asked).toEqual([undefined, 42])
  })

  it("spends a PUT's echoed generation on the entry's next lookup", async () => {
    // A miss drives the full tail: render, PUT, and the echo the PUT answers
    // with. Nothing in the GET can supply the number here — the miss reports
    // none — so a second lookup carrying it can only have come from the write.
    const { api, asked } = genCache(() => ({ status: 'miss' }), 7)
    const queue = new RenderQueue(2)
    const entries = models(1)

    await render(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao />)
    await settle()
    expect(vi.mocked(api.putThumb)).toHaveBeenCalledTimes(1)
    expect(asked).toEqual([undefined])

    await rerender(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao={false} />)
    await settle()
    expect(asked).toEqual([undefined, 7])
  })

  it('forgets its key when an outside writer hands pixels in without one', async () => {
    // The pinning hole the 2026-09-02 review confirmed: an out-of-hook PUT
    // (App's persist, entryActions') moves the server's generation, and a
    // subsequent fetch under the OLD number is answered by the browser's
    // immutable cache without the server ever seeing it — the stale-gen tier
    // cannot fire on a request that is never made. So `setThumb` adopts a
    // write's generation *including its absence*: pixels handed in without a
    // number invalidate the learned one, demoting the next fetch to the
    // validator tier, which asks the server and gets the truth.
    const { api, asked } = genCache(() => freshHit({ gen: 42 }), 0)
    const queue = new RenderQueue(2)
    const entries = models(1)

    await render(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao />)
    await settle()
    expect(asked).toEqual([undefined]) // learned 42 from the echo

    act(() => lastSetThumb!(entries[0]!.path, { status: 'ready', url: 'blob:external' }))
    await rerender(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao={false} />)
    await settle()
    // Not [undefined, 42]: the outside write outdated that number.
    expect(asked).toEqual([undefined, undefined])
  })

  it("adopts the generation an outside writer does know", async () => {
    // The common outside writer (App's orbit persist) has the PUT echo in hand
    // and passes it through, so the next fetch is immutable-keyed at the NEW
    // number rather than paying a revalidation for a value the write knew.
    const { api, asked } = genCache(() => freshHit({ gen: 42 }), 0)
    const queue = new RenderQueue(2)
    const entries = models(1)

    await render(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao />)
    await settle()

    act(() => lastSetThumb!(entries[0]!.path, { status: 'ready', url: 'blob:external', gen: 9 }))
    await rerender(<Harness entries={entries} api={api} lru={mesh()} queue={queue} ao={false} />)
    await settle()
    expect(asked).toEqual([undefined, 9])
  })

  it('starts a genuinely new entry unkeyed rather than inheriting a neighbour’s', async () => {
    // The generation belongs to one entry. A slot created for a different path
    // has learned nothing, whatever its neighbours know.
    const { api, asked } = genCache(() => freshHit({ gen: 42 }), 0)
    const queue = new RenderQueue(2)

    await render(<Harness entries={models(1)} api={api} lru={mesh()} queue={queue} ao />)
    await settle()
    await rerender(<Harness entries={models(2)} api={api} lru={mesh()} queue={queue} ao />)
    await settle()

    // m0 was not re-looked-up (nothing about it moved); m1 is new and unkeyed.
    expect(asked).toEqual([undefined, undefined])
  })
})

// ─── thumbnail-image-serving §0 ─────────────────────────────────────────────
// Lookups are ranked by the band map — far last, after everything nearer, but
// taken: a recipe change must consult every entry's cache "at once whatever
// its position" (main's Client-side thumbnail rendering), so a far lookup is
// ordered, never held. The lookup queue is eight wide, so its order is
// observable only with all eight slots held (client/test/CLAUDE.md's
// render-order rule, applied to lookups): `gateLookups` parks every getThumb
// until released, and the cells release in a chosen order.

/** A cache whose lookups park until released — per path, in a chosen order. */
function gateLookups(answer: () => Record<string, unknown> = () => ({ status: 'miss' })) {
  const waiting = new Map<string, () => void>()
  const asked: string[] = []
  const api = {
    getThumb: vi.fn(
      (path: string) =>
        new Promise((resolve) => {
          asked.push(path)
          waiting.set(path, () => resolve(answer()))
        }),
    ),
    putThumb: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiClient
  return {
    api,
    asked,
    release: async (path: string) => {
      const go = waiting.get(path)
      waiting.delete(path)
      await act(async () => {
        go?.()
      })
      await settle()
    },
  }
}

describe('lookups are ranked with renders', () => {
  it('a far tile’s lookup runs after everything nearer — and does run', async () => {
    // Ten models: eight lookups start at once and hold the slots; m8 and m9
    // queue, m8 pushed first. m9 near, m8 far: m9 goes first when a slot
    // frees, and m8 follows on the next — ordered, not held (D0). Falsify by
    // ranking only the render queue (m8 first) or by holding far (m8 never).
    const gate = gateLookups()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(10)} api={gate.api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    expect(gate.asked).toHaveLength(8)
    await bands({ '/models/m8.stl': 'far', '/models/m9.stl': 'near' })
    await gate.release('/models/m0.stl')
    expect(gate.asked[8]).toBe('/models/m9.stl')
    await gate.release('/models/m1.stl')
    expect(gate.asked[9]).toBe('/models/m8.stl')
  })

  it('a visible tile’s lookup is taken ahead of earlier-queued off-screen ones', async () => {
    const gate = gateLookups()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(10)} api={gate.api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    await bands({ '/models/m9.stl': 'visible', '/models/m8.stl': 'near' })
    await gate.release('/models/m0.stl')

    expect(gate.asked[8]).toBe('/models/m9.stl')
  })

  it('a suspended render queue does not stall a lookup', async () => {
    // The lookup queue is a RenderQueue too, and is never the one App
    // suspends. Pinned here rather than trusted.
    const api = fakeCache(() => freshHit())
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(3)} api={api} lru={fakeLru()} queue={queue} ao />)
    await settle()

    expect(statuses()).toEqual(['ready', 'ready', 'ready'])
  })

  it('a listing change resets the lookup ranking too', async () => {
    // The old listing ranked m9 ahead of m8; a landing with the same paths
    // keeps their queued lookups and must forget that order. Falsify by
    // resetting only the render queue's ranking (m9 would still go first).
    const gate = gateLookups()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(10)} api={gate.api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    await bands({ '/models/m9.stl': 'visible', '/models/m8.stl': 'far' })
    await rerender(<Harness entries={models(10)} api={gate.api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    await gate.release('/models/m0.stl')

    expect(gate.asked[8]).toBe('/models/m8.stl') // insertion order: both unreported
  })

  it('the test reset drops a pending lookup so it cannot fire in the next cell', async () => {
    const gate = gateLookups()
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(10)} api={gate.api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    resetLookupQueueForTests()
    await gate.release('/models/m0.stl') // a slot frees on the *old* instance

    expect(gate.asked).toHaveLength(8) // m8/m9 were dropped, not dispatched
  })
})


// ─── bulk-thumbnail-jobs 1.3 ────────────────────────────────────────────────
// `refetch(path)` is the in-memory half of a write somebody else made to the
// entry on the server — the bulk reset's. Nothing else restarts a slot on such
// a write: the sweep effect restarts one only on an add, an mtime change, an
// `ao` change or a pose change by value, and a reset moves none of them.
describe('refetch restarts one slot after a write the hook did not make', () => {
  it('blanks the tile, forgets the generation, and runs the whole pipeline again', async () => {
    const entries = models(1)
    const path = entries[0]!.path
    const api = {
      getThumb: vi
        .fn()
        .mockResolvedValueOnce(freshHit({ gen: 42 }))
        .mockResolvedValueOnce({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue({ gen: 43 }),
    } as unknown as ApiClient
    const lru = mesh()
    const queue = new RenderQueue(2)

    await render(<Harness entries={entries} api={api} lru={lru} queue={queue} ao />)
    await settle()
    expect(statuses()).toEqual(['ready'])
    expect(lru.acquire).not.toHaveBeenCalled() // a hit: nothing rendered yet
    const shown = lastThumbs.get(path)!.url!

    const pushed = vi.spyOn(queue, 'push')
    // Held so the blank is observable: without it the refill lands inside the
    // same settle and the tile is only ever seen `ready`.
    queue.suspend()
    await act(async () => {
      lastRefetch!(path)
    })
    await settle()

    // Blanked, not kept — the opposite of this hook's keep-until-replaced rule
    // and deliberately so (D3): those pixels were deleted for lying.
    expect(statuses()).toEqual(['loading'])
    expect(lastThumbs.get(path)!.url).toBeUndefined()
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter((c) => c[0] === shown)).toHaveLength(1)
    // One new lookup, riding the validator tier: the entry's generation moved
    // under the hook, so 42 is no longer a number worth asking under. Exactly
    // three arguments — the call a slot that has learned nothing makes.
    expect(vi.mocked(api.getThumb).mock.calls).toHaveLength(2)
    expect(vi.mocked(api.getThumb).mock.calls[1]).toEqual([path, entries[0]!.mtime, true])
    // The miss queued a render keyed by the path and at *no* pinned band — the
    // tile's own place in the ranking, exactly as a visit's render is.
    expect(pushed).toHaveBeenCalledWith(expect.any(Function), path)

    await act(async () => {
      queue.resume()
    })
    await settle()
    expect(statuses()).toEqual(['ready'])
    expect(api.putThumb).toHaveBeenCalledTimes(1)
  })

  it('goes through the lookup even when the listing still vouches for the render', async () => {
    // Found live (2026-09-02): after a bulk reset deleted a tile's renders,
    // the tile sat on "loading" forever. The entry's annotation was the
    // listing's word from before the write, `start` trusted it first and
    // seeded an image URL at pixels the server no longer had — and returned
    // that seed to a caller that discards it.
    const entries = models(1)
    const path = entries[0]!.path
    entries[0]!.thumb = {
      gen: 5,
      framed: true,
      ao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION },
      noao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION },
    }
    const api = {
      thumbImageUrl: () => 'http://localhost/api/thumb/image?vouched',
      getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue({ gen: 6 }),
    } as unknown as ApiClient
    const lru = mesh()
    const queue = new RenderQueue(2)

    await render(<Harness entries={entries} api={api} lru={lru} queue={queue} ao />)
    await settle()
    // Listing-drawn: ready at the image URL, and no lookup was ever made.
    expect(statuses()).toEqual(['ready'])
    expect(api.getThumb).not.toHaveBeenCalled()

    await act(async () => {
      lastRefetch!(path)
    })
    await settle()
    // The annotation is refused, the lookup runs, the miss renders, the tile
    // comes back with real pixels — not with the vouched-for URL, and not
    // stuck on loading.
    expect(api.getThumb).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
    expect(lastThumbs.get(path)!.url).toMatch(/^blob:/)
    expect(api.putThumb).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all for a path this listing does not have', async () => {
    // A tile off screen is simply not in the map, and the reset job calls
    // `refetch` for every entry in its scope.
    const api = {
      getThumb: vi.fn().mockResolvedValue(freshHit()),
      putThumb: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient
    const queue = new RenderQueue(2)

    await render(<Harness entries={models(1)} api={api} lru={mesh()} queue={queue} ao />)
    await settle()
    const before = statuses()
    const commits = renderLog.length
    const revokes = vi.mocked(URL.revokeObjectURL).mock.calls.length
    vi.mocked(api.getThumb).mockClear()

    await act(async () => {
      lastRefetch!('/models/not-here.stl')
    })
    await settle()

    expect(api.getThumb).not.toHaveBeenCalled()
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(revokes)
    expect(statuses()).toEqual(before)
    // Not even a commit: `refetch` returns before it touches state.
    expect(renderLog).toHaveLength(commits)
  })

  it('retires the pass already in flight, so its answer never paints', async () => {
    // The reset's PUT and the tile's own first lookup race by construction —
    // the job writes while the grid is still filling. `retire` is what keeps
    // the pre-write answer off the tile, and **both** lookups have to be
    // parked for this cell to say so: released after the restart has painted,
    // the stale pass is stopped by `setThumb`'s own retirement instead and the
    // cell would pass with `refetch`'s removed (checked — it did).
    const entries = models(1)
    const path = entries[0]!.path
    // Built up front so the URL each answer would put on the tile is known.
    const beforeAnswer = freshHit({ gen: 1 })
    const afterAnswer = freshHit({ gen: 2 })
    let releaseBefore = (): void => {}
    let releaseAfter = (): void => {}
    const first = new Promise<Record<string, unknown>>((resolve) => {
      releaseBefore = () => resolve(beforeAnswer)
    })
    const second = new Promise<Record<string, unknown>>((resolve) => {
      releaseAfter = () => resolve(afterAnswer)
    })
    const api = {
      getThumb: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
      putThumb: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient

    await render(<Harness entries={entries} api={api} lru={mesh()} queue={new RenderQueue(2)} ao />)
    await settle()
    expect(statuses()).toEqual(['loading']) // the first lookup is parked

    await act(async () => {
      lastRefetch!(path)
    })
    await settle()
    expect(vi.mocked(api.getThumb)).toHaveBeenCalledTimes(2)

    // The pre-refetch answer lands while the restart is still in flight —
    // the one ordering where nothing but `refetch`'s retirement can stop it.
    await act(async () => {
      releaseBefore()
    })
    await settle()
    expect(statuses()).toEqual(['loading'])
    expect(lastThumbs.get(path)!.url).toBeUndefined()
    // Released rather than leaked: the lookup minted a PNG for a pass that no
    // longer answers for this tile.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(beforeAnswer.pngUrl)

    // The restart's own answer is the one that paints.
    await act(async () => {
      releaseAfter()
    })
    await settle()
    expect(statuses()).toEqual(['ready'])
    expect(lastThumbs.get(path)!.url).toBe(afterAnswer.pngUrl)
  })

  it('never lets the pre-write lookup hand its generation to the restart', async () => {
    // The other order of the same race (`bulk-thumbnail-jobs` Stage A2 review).
    // A generation used to be adopted *before* the liveness gate, on the
    // reasoning that it is a fact about the entry rather than about the pass —
    // which holds only while both passes see the same server state, and the
    // reset's write between them is exactly what breaks it. Released
    // new-then-old, the retired pass's number would land last, the next fetch
    // would ask under it, and the browser's immutable cache would answer for
    // bytes the server has already deleted. Falsify by moving the adoption back
    // above the `alive()` gate: the last lookup then asks with 3.
    const entries = models(1)
    const path = entries[0]!.path
    let releaseBefore = (): void => {}
    let releaseAfter = (): void => {}
    const first = new Promise<Record<string, unknown>>((resolve) => {
      releaseBefore = () => resolve(freshHit({ gen: 3 }))
    })
    const second = new Promise<Record<string, unknown>>((resolve) => {
      releaseAfter = () => resolve(freshHit({ gen: 7 }))
    })
    const asked: (number | undefined)[] = []
    const api = {
      getThumb: vi
        .fn((_p: string, _m: number, _ao: boolean, gen?: number) => {
          asked.push(gen)
          return asked.length === 1 ? first : asked.length === 2 ? second : Promise.resolve(freshHit({ gen: 7 }))
        }),
      putThumb: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient

    await render(<Harness entries={entries} api={api} lru={mesh()} queue={new RenderQueue(2)} ao />)
    await settle()
    await act(async () => {
      lastRefetch!(path)
    })
    await settle()

    // The restart answers first and paints; the pre-write pass lands after it.
    await act(async () => {
      releaseAfter()
    })
    await settle()
    await act(async () => {
      releaseBefore()
    })
    await settle()
    expect(statuses()).toEqual(['ready'])

    // A toggle looks the same entry up again, under whatever the slot now
    // holds. 7 is the restart's; 3 belongs to the entry the write deleted.
    await rerender(<Harness entries={entries} api={api} lru={mesh()} queue={new RenderQueue(2)} ao={false} />)
    await settle()
    expect(asked[2]).toBe(7)
  })
})

/**
 * A listing-known thumbnail is drawn without a lookup (`thumbnail-image-serving`
 * D2/D3): where the entry carries a render the client's own predicate accepts,
 * the tile is seeded `ready` at the image route's URL in the sweep's own
 * batch, and no `getThumb` is issued for it.
 */
describe('a listing-known thumbnail is drawn without a lookup', () => {
  const CAMERA = { az: 0.4, el: 0.2, distR: 2, target: [0, 0, 0] as [number, number, number] }
  /** `n` models whose listing entries vouch for a current, usable render. */
  function annotated(n: number, over: Partial<NonNullable<DirEntry['thumb']>> = {}, gen = 5): DirEntry[] {
    return models(n).map((e) => ({
      ...e,
      thumb: {
        gen,
        framed: true,
        camera: CAMERA,
        axis: 'z' as const,
        ao: { state: 'hit' as const, lighting: THUMB_LIGHTING, rig: RIG_VERSION },
        noao: { state: 'miss' as const },
        ...over,
      },
    }))
  }
  function fakeApi(getThumb = vi.fn().mockResolvedValue({ status: 'miss' })): ApiClient {
    return {
      getThumb,
      thumbImageUrl,
      putThumb: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient
  }
  const urlOf = (path: string): string => lastThumbs.get(path)?.url ?? ''

  it('a fully annotated listing issues no lookups: every tile is ready at its image URL, camera and axis included', async () => {
    const api = fakeApi()
    const entries = annotated(4)
    await render(<Harness entries={entries} api={api} lru={fakeLru()} queue={new RenderQueue(2)} />)
    await settle()
    expect(api.getThumb).not.toHaveBeenCalled()
    expect(statuses()).toEqual(['ready', 'ready', 'ready', 'ready'])
    for (const e of entries) {
      const state = lastThumbs.get(e.path)!
      expect(state.url).toBe(thumbImageUrl(e.path, e.mtime, true, 5))
      expect(state.camera).toEqual(CAMERA)
      expect(state.axis).toBe('z')
      // The generation rides the seed, so the slot's next fetch is pinned.
      expect(state.gen).toBe(5)
    }
    // The F1 property: the sweep's own added-entry seed did not overwrite the
    // listing's answer — the tile never passed through `loading` at all.
    expect(renderLog.some((row) => row.some((cell) => cell.startsWith('loading')))).toBe(false)
  })

  it('the client’s constants decide: an old rig, an absent annotation, and a predating pose each take the lookup', async () => {
    const getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
    const api = fakeApi(getThumb)
    const oldRig = annotated(1, { ao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION - 1 } })
    const bare = models(1).map((e) => ({ ...e, path: '/models/bare.stl', name: 'bare.stl' }))
    const unposed = annotated(1, { camera: undefined, axis: undefined, framed: false }).map((e) => ({
      ...e,
      path: '/models/unposed.stl',
      name: 'unposed.stl',
    }))
    const pose: IndexPose = {
      up: [0, 1, 0],
      azimuth_zero: [1, 0, 0],
      source: 'siglip',
      confidence: 0.9,
      front: null,
    }
    const queue = new RenderQueue(2)
    queue.suspend()
    await render(
      <Harness
        entries={[...oldRig, ...bare, ...unposed]}
        api={api}
        lru={fakeLru()}
        queue={queue}
        poses={{ '/models/unposed.stl': pose }}
      />,
    )
    await settle()
    expect(getThumb.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/models/bare.stl',
      '/models/m0.stl',
      '/models/unposed.stl',
    ])
    expect(statuses()).toEqual(['loading', 'loading', 'loading'])
  })

  it('a later listing naming a newer generation redraws the survivor from the new URL, still without a lookup', async () => {
    const api = fakeApi()
    const first = annotated(1)
    await render(<Harness entries={first} api={api} lru={fakeLru()} queue={new RenderQueue(2)} />)
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('gen=5')

    await rerender(<Harness entries={annotated(1, {}, 6)} api={api} lru={fakeLru()} queue={new RenderQueue(2)} />)
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('gen=6')
    expect(lastThumbs.get('/models/m0.stl')!.gen).toBe(6)
    expect(api.getThumb).not.toHaveBeenCalled()

    // The same generation again — a peek landing beside it, a re-landing —
    // is not a new fact and restarts nothing.
    const before = renderLog.length
    await rerender(<Harness entries={annotated(1, {}, 6)} api={api} lru={fakeLru()} queue={new RenderQueue(2)} />)
    await settle()
    expect(renderLog.slice(before).every((row) => row[0] === `ready:${urlOf('/models/m0.stl')}`)).toBe(true)
  })

  it('a tile drawn from an image URL, re-rendered to blob:, then removed, releases exactly the blob', async () => {
    const api = fakeApi()
    await render(<Harness entries={annotated(1)} api={api} lru={fakeLru()} queue={new RenderQueue(2)} />)
    await settle()
    const imageUrl = urlOf('/models/m0.stl')
    expect(imageUrl.startsWith('/api/thumb/image')).toBe(true)

    // An outside writer (App's persist) replaces the picture with pixels the
    // client minted. The image URL it displaces is nobody's to revoke.
    await act(async () => {
      lastSetThumb!('/models/m0.stl', { status: 'ready', url: 'blob:persisted', gen: 6 })
    })
    expect(vi.mocked(URL.revokeObjectURL)).not.toHaveBeenCalled()

    await rerender(<Harness entries={[]} api={api} lru={fakeLru()} queue={new RenderQueue(2)} />)
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([['blob:persisted']])
  })

  it('an image that fails to arrive demotes the entry to the lookup once per generation, never to error', async () => {
    const getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
    const api = fakeApi(getThumb)
    const queue = new RenderQueue(2)
    queue.suspend() // the miss's render never lands, so the state stays where the demotion put it
    await render(<Harness entries={annotated(1)} api={api} lru={fakeLru()} queue={queue} />)
    await settle()
    expect(getThumb).not.toHaveBeenCalled()

    // happy-dom fetches no images, so the browser's `error` is synthesized
    // through the same callback the tile's <img> would call (task 5.1).
    await act(async () => {
      lastReportImageError!('/models/m0.stl')
    })
    await settle()
    expect(statuses()).toEqual(['loading']) // not 'error': a missing image is not a failed model
    expect(getThumb).toHaveBeenCalledTimes(1)
    // Under the generation the annotation taught the slot — the demoted
    // lookup names it, so it rides the immutable tier where it can rather
    // than the validator tier (task 5.1; falsify by dropping `slot.thumbGen`
    // from the annotation branch).
    expect(getThumb).toHaveBeenCalledWith('/models/m0.stl', 1, true, 5)

    // A restart at the same generation — the pose wave, a toggle — must not
    // rebuild the refused URL: the annotation is skipped and the lookup asked
    // again. The wave is a `poses` change, which re-runs the sweep.
    const pose: IndexPose = { up: [0, 1, 0], azimuth_zero: [1, 0, 0], source: 'siglip', confidence: 0.9, front: null }
    await rerender(
      <Harness entries={annotated(1)} api={api} lru={fakeLru()} queue={queue} poses={{ '/models/m0.stl': pose }} />,
    )
    await settle()
    expect(getThumb).toHaveBeenCalledTimes(2)
    expect(urlOf('/models/m0.stl')).toBe('')

    // A listing naming a *different* generation is a new fact, and is tried.
    await rerender(
      <Harness entries={annotated(1, {}, 7)} api={api} lru={fakeLru()} queue={queue} poses={{ '/models/m0.stl': pose }} />,
    )
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('gen=7')
  })

  it('the refusal remembers the generation the failed URL named, not the entry’s current word', async () => {
    // Second review, R5: a later listing can carry no annotation at all (a
    // server restart empties the fact index) while the survivor keeps its
    // image URL. When that URL then fails, the entry's word is `undefined`;
    // recording *that* would remember nothing, and the next listing naming
    // gen 5 again would rebuild the same 404 URL.
    const getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
    const api = fakeApi(getThumb)
    const queue = new RenderQueue(2)
    queue.suspend()
    await render(<Harness entries={annotated(1)} api={api} lru={fakeLru()} queue={queue} />)
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('gen=5')

    // The same entry, un-annotated: not a new fact, the tile keeps its URL.
    await rerender(<Harness entries={models(1)} api={api} lru={fakeLru()} queue={queue} />)
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('gen=5')
    expect(getThumb).not.toHaveBeenCalled()

    await act(async () => {
      lastReportImageError!('/models/m0.stl')
    })
    await settle()
    expect(getThumb).toHaveBeenCalledTimes(1)

    // Gen 5 again, from a server that has read the entry once more, landing
    // with a pose wave so the survivor restarts and reaches the annotation
    // branch: refused, still — the lookup is asked, the URL is not rebuilt.
    // Falsify by recording `slot.entry.thumb?.gen` at the error: the URL
    // comes back and no second lookup is made.
    const pose: IndexPose = { up: [0, 1, 0], azimuth_zero: [1, 0, 0], source: 'siglip', confidence: 0.9, front: null }
    await rerender(
      <Harness entries={annotated(1)} api={api} lru={fakeLru()} queue={queue} poses={{ '/models/m0.stl': pose }} />,
    )
    await settle()
    expect(urlOf('/models/m0.stl')).toBe('')
    expect(getThumb).toHaveBeenCalledTimes(2)
  })

  it('a refusal is per render: the other variant’s image is still drawn from the listing', async () => {
    // Third review, R3: the two variants' PNGs are evicted independently,
    // and the generation is the entry's. A 404 on one must not send the
    // other, whose pixels are fine, to the lookup on the next toggle.
    // Falsify by refusing variant-blind (`refusedAo` never set).
    const getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
    const api = fakeApi(getThumb)
    const queue = new RenderQueue(2)
    queue.suspend()
    const both: Partial<NonNullable<DirEntry['thumb']>> = {
      noao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION },
    }
    await render(<Harness entries={annotated(1, both)} api={api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    expect(urlOf('/models/m0.stl')).not.toContain('ao=off')

    await act(async () => {
      lastReportImageError!('/models/m0.stl')
    })
    await settle()
    expect(getThumb).toHaveBeenCalledTimes(1)

    // The toggle: the unoccluded render at the same generation is not the
    // one that failed, so the listing's word for it stands.
    await rerender(<Harness entries={annotated(1, both)} api={api} lru={fakeLru()} queue={queue} ao={false} />)
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('ao=off')
    expect(getThumb).toHaveBeenCalledTimes(1)

    // And back: the occluded render is still the refused one — the lookup is
    // asked again, and the tile keeps the picture it has (the unoccluded
    // image) until the replacement lands, as any restarted survivor does.
    await rerender(<Harness entries={annotated(1, both)} api={api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    expect(urlOf('/models/m0.stl')).toContain('ao=off')
    expect(getThumb).toHaveBeenCalledTimes(2)
  })
})

/**
 * The local-framing overlay at the **seeding** arrival point
 * (`public-deployment` 4.1, D6).
 *
 * The decorator over `ApiClient` covers the lookup's answer, and would cover
 * nothing at all on a deployment whose thumbnails are all baked: every tile
 * there is drawn straight from the listing's annotation with no lookup issued.
 * These cells are about that second arrival — one store, one rule, two places.
 *
 * They use the environment's own `localStorage`, not an injected store: the
 * hook takes no storage argument, and using the real one is what makes the
 * third cell able to hand the *same* store to the decorator.
 */
describe('a kept framing wins over the one the listing carried', () => {
  const CAMERA = { az: 0.4, el: 0.2, distR: 2, target: [0, 0, 0] as [number, number, number] }
  const KEPT = { az: 1.5, el: -0.3, distR: 4, target: [1, 0, 0] as [number, number, number] }
  const OFF: FeatureReport = { thumbWrites: false, appLaunch: true, chatTab: false, hostDetails: true, maintenance: true }
  const PATH = '/models/m0.stl'
  /**
   * The library these tiles belong to. The store keys by library and path
   * (`framingKey`), so every cell that keeps a framing writes it and renders
   * under the same id — and the last cell here writes under a different one.
   */
  const LIB = (): string => 'lib-a'

  function annotated(over: Partial<NonNullable<DirEntry['thumb']>> = {}): DirEntry[] {
    return models(1).map((e) => ({
      ...e,
      thumb: {
        gen: 5,
        framed: true,
        camera: CAMERA,
        axis: 'z' as const,
        ao: { state: 'hit' as const, lighting: THUMB_LIGHTING, rig: RIG_VERSION },
        noao: { state: 'miss' as const },
        ...over,
      },
    }))
  }
  const fakeApi = (getThumb = vi.fn().mockResolvedValue({ status: 'miss' })): ApiClient =>
    ({ getThumb, thumbImageUrl, putThumb: vi.fn().mockResolvedValue({}) }) as unknown as ApiClient

  beforeEach(() => {
    localStorage.clear()
  })

  it('overrides the listing entry’s own camera and axis, still with no lookup', async () => {
    writeLocalFraming(PATH, { camera: KEPT, axis: '-x' }, undefined, LIB)
    const api = fakeApi()
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={() => OFF}
        libraryId={LIB}
      />,
    )
    await settle()

    // Still the listing's answer about the *pixels* — the overlay is about
    // orientation only, and issues no request of its own.
    expect(api.getThumb).not.toHaveBeenCalled()
    expect(statuses()).toEqual(['ready'])
    expect(lastThumbs.get(PATH)!.url).toBe(thumbImageUrl(PATH, 1, true, 5))
    expect(lastThumbs.get(PATH)!.camera).toEqual(KEPT)
    expect(lastThumbs.get(PATH)!.axis).toBe('-x')
  })

  it('does not, while the report is unknown', async () => {
    // 4.2: not knowing must never relocate where a user's orientations live —
    // and that cuts both ways. A browser carrying framings from some other
    // deployment must not silently re-frame a server that never refused a write.
    writeLocalFraming(PATH, { camera: KEPT, axis: '-x' }, undefined, LIB)
    const api = fakeApi()
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        libraryId={LIB}
      />,
    )
    await settle()

    expect(api.getThumb).not.toHaveBeenCalled()
    expect(lastThumbs.get(PATH)!.camera).toEqual(CAMERA)
    expect(lastThumbs.get(PATH)!.axis).toBe('z')
  })

  it('does not, where the framing was kept for another library', async () => {
    // The seeding point's half of the third pass's key fix (2026-09-08): the
    // same relative path in a second library — a backup drive holding the same
    // kit — is a different model, and the framing kept for one must not frame
    // the other.
    writeLocalFraming(PATH, { camera: KEPT, axis: '-x' }, undefined, () => 'lib-b')
    const api = fakeApi()
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={() => OFF}
        libraryId={LIB}
      />,
    )
    await settle()

    expect(api.getThumb).not.toHaveBeenCalled()
    expect(lastThumbs.get(PATH)!.camera).toEqual(CAMERA)
    expect(lastThumbs.get(PATH)!.axis).toBe('z')
  })

  it('reaches an unframed entry through the lookup, where a held pose refuses the seed', async () => {
    // The consequence of overlaying the seed's *state* and not feeding the
    // overlay to `usable`: this entry carries no orientation, so a held pose
    // makes the annotation stale and the tile falls to the lookup — where the
    // decorator's own overlay lands the same kept camera. One extra lookup,
    // same framing. Do not "fix" this by teaching `usable` about the local
    // store: "the listing answered this tile" is a statement about the
    // server's render, not about something only this browser holds.
    writeLocalFraming(PATH, { camera: KEPT }, undefined, LIB)
    const pose: IndexPose = {
      up: [0, 1, 0],
      azimuth_zero: [1, 0, 0],
      source: 'siglip',
      confidence: 0.9,
      front: null,
    }
    const getThumb = vi.fn().mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:from-lookup',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
      gen: 5,
    })
    const api = withLocalFramings(fakeApi(getThumb), () => OFF, undefined, LIB)

    await render(
      <Harness
        entries={annotated({ camera: undefined, axis: undefined })}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        poses={{ [PATH]: pose }}
        features={() => OFF}
        libraryId={LIB}
      />,
    )
    await settle()

    expect(getThumb).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
    expect(lastThumbs.get(PATH)!.url).toBe('blob:from-lookup')
    // The kept camera arrived, and the pose did not reassert itself over it.
    expect(lastThumbs.get(PATH)!.camera).toEqual(KEPT)
  })

  /**
   * The report resolving *after* the tiles drew (review F4).
   *
   * Both arrival points are already stale by then — the sweep seeds once and
   * the survivors loop `continue`s over an unchanged entry, and a lookup that
   * has answered is not asked again — so the overlay reaches them through an
   * imperative App calls on the transition. It is an overlay and not a
   * restart: these cells assert the api spies are untouched, because
   * re-running the sweep would spend a lookup and, on a miss, a render to
   * arrive at pixels nothing has questioned.
   */
  const applyAfterReport = (): Promise<void> => act(async () => lastApplyLocalFramings!())

  it('reaches a tile the listing seeded before the report landed', async () => {
    writeLocalFraming(PATH, { camera: KEPT, axis: '-x' }, undefined, LIB)
    const api = fakeApi()
    // The report is unknown while the listing draws, and resolves to
    // writes-off afterwards — the exact order nothing about the two requests
    // guarantees either way.
    let report: FeatureReport | null = null
    const read = (): FeatureReport | null => report
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={read}
        libraryId={LIB}
      />,
    )
    await settle()
    expect(lastThumbs.get(PATH)!.camera).toEqual(CAMERA)

    report = OFF
    await applyAfterReport()

    expect(lastThumbs.get(PATH)!.camera).toEqual(KEPT)
    expect(lastThumbs.get(PATH)!.axis).toBe('-x')
    // The pixels are the server's and are unchanged: same URL, no lookup, no
    // write. Only the framing an orbit would open at has moved.
    expect(lastThumbs.get(PATH)!.url).toBe(thumbImageUrl(PATH, 1, true, 5))
    expect(api.getThumb).not.toHaveBeenCalled()
    expect(api.putThumb).not.toHaveBeenCalled()
  })

  it('reaches a tile the listing seeded before the library id landed', async () => {
    // The other half of that race, and the one the report cannot rescue on its
    // own: `/api/library` can land *last* of the three boot requests, and a
    // tile seeded while the id is unknown gets no overlay however loudly the
    // report says writes are off — `framingKey` answers `null` with no library
    // to file a framing under, so the store reads as empty. App's effect
    // therefore waits on the id as well as the report.
    writeLocalFraming(PATH, { camera: KEPT, axis: '-x' }, undefined, LIB)
    const api = fakeApi()
    let id: string | null = null
    const readId = (): string | null => id
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={() => OFF}
        libraryId={readId}
      />,
    )
    await settle()
    // The control, and the bug itself: the report was known and off the whole
    // time, and the seed still found nothing to lay over the listing's camera.
    expect(lastThumbs.get(PATH)!.camera).toEqual(CAMERA)

    id = 'lib-a'
    await applyAfterReport()

    expect(lastThumbs.get(PATH)!.camera).toEqual(KEPT)
    expect(lastThumbs.get(PATH)!.axis).toBe('-x')
    // An overlay here too: the id arriving questions no pixels.
    expect(lastThumbs.get(PATH)!.url).toBe(thumbImageUrl(PATH, 1, true, 5))
    expect(api.getThumb).not.toHaveBeenCalled()
    expect(api.putThumb).not.toHaveBeenCalled()
  })

  it('reaches a tile the lookup answered before the report landed', async () => {
    // The second arrival point, and the one a re-run of the sweep would charge
    // a fresh lookup for: this tile carries no annotation the sweep can seed
    // from, so its framing came back through `getThumb` — before the decorator
    // had a report to overlay with.
    writeLocalFraming(PATH, { camera: KEPT }, undefined, LIB)
    const getThumb = vi.fn().mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:from-lookup',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
      camera: CAMERA,
      axis: 'z',
      gen: 5,
    })
    let report: FeatureReport | null = null
    const read = (): FeatureReport | null => report
    const api = withLocalFramings(fakeApi(getThumb), read, undefined, LIB)
    await render(
      <Harness
        entries={models(1)}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={read}
        libraryId={LIB}
      />,
    )
    await settle()
    expect(getThumb).toHaveBeenCalledTimes(1)
    expect(lastThumbs.get(PATH)!.camera).toEqual(CAMERA)

    report = OFF
    await applyAfterReport()

    expect(lastThumbs.get(PATH)!.camera).toEqual(KEPT)
    // The axis is not kept locally, so the server's stands — the precedence is
    // per half, not per model.
    expect(lastThumbs.get(PATH)!.axis).toBe('z')
    expect(lastThumbs.get(PATH)!.url).toBe('blob:from-lookup')
    // Not asked a second time: the overlay reads the store, not the network.
    expect(getThumb).toHaveBeenCalledTimes(1)
  })

  it('leaves a tile with nothing kept for it exactly as it was', async () => {
    const api = fakeApi()
    let report: FeatureReport | null = null
    const read = (): FeatureReport | null => report
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={read}
        libraryId={LIB}
      />,
    )
    await settle()
    const before = lastThumbs.get(PATH)!

    report = OFF
    await applyAfterReport()

    // Object identity, not a deep equality: a rebuilt-but-equal tile would
    // re-render every tile on the grid for a report that changed nothing about
    // any of them.
    expect(lastThumbs.get(PATH)).toBe(before)
  })

  it('changes nothing where the deployment accepts writes', async () => {
    // The gate, at this arrival point too. A browser carrying framings from
    // some other deployment must not re-frame a server that never refused a
    // write — the same cut the seeding site makes, and the reason the overlay
    // asks the getter rather than the store alone.
    writeLocalFraming(PATH, { camera: KEPT, axis: '-x' }, undefined, LIB)
    const api = fakeApi()
    let report: FeatureReport | null = null
    const read = (): FeatureReport | null => report
    await render(
      <Harness
        entries={annotated()}
        api={api}
        lru={fakeLru()}
        queue={new RenderQueue(2)}
        features={read}
        libraryId={LIB}
      />,
    )
    await settle()
    const before = lastThumbs.get(PATH)!

    report = { ...OFF, thumbWrites: true }
    await applyAfterReport()

    expect(lastThumbs.get(PATH)).toBe(before)
    expect(lastThumbs.get(PATH)!.camera).toEqual(CAMERA)
    expect(lastThumbs.get(PATH)!.axis).toBe('z')
  })
})

/**
 * Far reads yield to pending lookups — the *hook's* wiring of it, not the
 * queue's own (second review, R1): the render queue App passes in is gated on
 * the module-level lookup queue, so a far render does not start while a
 * lookup for a nearer tile is pending, and starts on its own when it settles.
 */
describe('the hook gates far renders on nearer lookups', () => {
  it('a far render waits for a pending near lookup and resumes when it settles', async () => {
    // Nine models, all misses: eight lookups fill the lookup queue's slots and
    // park; m8's lookup queues. Then a far-ranked render is pushed straight
    // into the render queue App would hold. With m8 ranked near and pending,
    // the far render must not start; once every lookup has settled — the
    // misses' own renders are far too, and the queue has two slots — it does.
    const gate = gateLookups()
    const queue = new RenderQueue(2)
    await render(<Harness entries={models(9)} api={gate.api} lru={fakeLru()} queue={queue} ao />)
    await settle()
    expect(gate.asked).toHaveLength(8)
    const far = Object.fromEntries([...models(9).map((e) => [e.path, 'far' as const]), ['/models/other.stl', 'far' as const]])
    await bands({ ...far, '/models/m8.stl': 'near' })

    const ran: string[] = []
    queue.push(async () => {
      ran.push('far-render')
    }, '/models/other.stl')
    await settle()
    expect(ran).toEqual([]) // held: m8's lookup, ranked near, is pending

    for (const e of models(9)) await gate.release(e.path)
    await settle()
    expect(ran).toEqual(['far-render']) // resumed by the lookup queue's settle, no push
  })
})
