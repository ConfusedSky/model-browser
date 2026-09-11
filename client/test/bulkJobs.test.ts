// The bulk job runner, asked directly (`bulk-thumbnail-jobs` 3.1/3.2): what a
// derivation keeps, what each per-entry op sends, and what the counters say
// when things go wrong. No DOM — the runner is plain state plus two per-entry
// operations, and `useBulkJobState` is one `useSyncExternalStore` line whose
// behaviour is React's, not this module's.
//
// The judgement under test is the *client's*: the server states facts per model
// and the recipe constants that decide what those facts mean live here, so
// every expectation below names `THUMB_LIGHTING`, `RIG_VERSION` or
// `POSE_VERSION` rather than a literal (client/test/CLAUDE.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import type {
  DirEntry,
  IndexPose,
  ModelsListing,
  ThumbInfo,
  ThumbRenderInfo,
} from '../../shared/types'
import { HttpError } from '../src/api/client'
import {
  BulkJobs,
  NOTHING_PROCESSED,
  SCOPE_UNREADABLE,
  type JobDeps,
  type JobScope,
} from '../src/jobs/bulkJobs'
import { RenderQueue } from '../src/three/queue'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose, POSE_VERSION, poseKeyOf } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'
import { setAoEnabled } from '../src/viewer/aoToggle'

// The generate op reaches the shared renderer only through `renderThumbnail`.
// Spread the real module so RIG_VERSION and THUMB_LIGHTING arrive real — a
// hand-listed factory would go stale on a new export, and a literal would keep
// passing across a bump while asserting a version the app no longer writes.
const renderThumbnail = vi.hoisted(() => vi.fn(() => Promise.resolve(new Blob(['png']))))
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  renderThumbnail,
}))

// `framingAfterDiscard` is `entry-actions`' rule and is covered there; what
// this suite pins is that the reset op *asks* it rather than carrying a second
// reading of the discard. Spread again, and the spy keeps the real body — the
// answer has to be the real one for the `axis: null` assertions to mean
// anything.
const framingAfterDiscard = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/entryActions', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/entryActions')>()
  framingAfterDiscard.mockImplementation(real.framingAfterDiscard)
  return { ...real, framingAfterDiscard }
})

const SCOPE: JobScope = { path: '/kit', label: 'kit' }
const MESH = {} as THREE.Object3D
/** A stored camera — what `framed` spells on the wire beside the flag. */
const CAMERA = { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] as [number, number, number] }

/** A pose the app can express: file-space `up` (0,-1,0) is the `-y` spindle, and
 *  `azimuth_zero` is perpendicular to it. */
const POSE: IndexPose = {
  up: [0, -1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'test',
  confidence: 1,
  front: { view: 0, azimuth_deg: 40, elevation_deg: 20 },
}
/** Malformed: `up` is not one of the six axes, so `cameraForPose` answers null
 *  and there is no usable pose to replace anything. */
const POSE_OFF_AXIS: IndexPose = { ...POSE, up: [0.7, -0.7, 0] }

/** A render block the current build would draw — the annotation's "nothing to
 *  do here". */
const currentRender = (extra: Partial<ThumbRenderInfo> = {}): ThumbRenderInfo => ({
  state: 'hit',
  lighting: THUMB_LIGHTING,
  rig: RIG_VERSION,
  ...extra,
})

function thumb(fields: Partial<ThumbInfo> = {}): ThumbInfo {
  return { gen: 1, framed: false, ao: currentRender(), noao: currentRender(), ...fields }
}

function model(name: string, fields: Partial<DirEntry> = {}): DirEntry {
  return {
    name: `${name}.stl`,
    path: `/kit/${name}.stl`,
    kind: 'model',
    format: 'stl',
    size: 1,
    mtime: 7,
    ...fields,
  }
}

function listing(entries: DirEntry[], complete = true): ModelsListing {
  return { path: SCOPE.path, entries, complete }
}

/** One runner with every seam observable. The return type is inferred rather
 *  than declared: the `push` spy's signature is `RenderQueue.push`'s, and an
 *  interface restating it is a second place for the pinned-band argument to
 *  drift out of. */
function harness(
  answer: ModelsListing,
  opts: { ao?: boolean; poses?: Record<string, IndexPose> } = {},
) {
  const queue = new RenderQueue(2)
  const push = vi.spyOn(queue, 'push')
  const models = vi.fn().mockResolvedValue(answer)
  const posesFor = vi.fn().mockResolvedValue({ poses: opts.poses ?? {} })
  // The core's own fresh lookup. A miss, so nothing the derivation kept is
  // then skipped as current — the `skipIfCurrent` branch has its own cells in
  // thumbnailCommands.test.ts.
  const getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
  const putThumb = vi.fn().mockResolvedValue({ gen: 2 })
  const setThumb = vi.fn()
  const refetch = vi.fn()
  const acquire = vi.fn().mockResolvedValue(MESH)
  const deps: JobDeps = {
    api: { models, semanticPosesFor: posesFor, getThumb, putThumb },
    lru: { acquire },
    queue,
    setThumb,
    refetch,
    ao: () => opts.ao ?? true,
  }
  return { jobs: new BulkJobs(deps), queue, push, models, posesFor, getThumb, putThumb, setThumb, refetch, acquire }
}

/** Let every settled promise in the runner's chain resolve. Generous: one
 *  generate entry is a lookup, a mesh, a render and a PUT deep. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0))
}

const paths = (entries: { entry: DirEntry }[]): string[] => entries.map((e) => e.entry.path)

beforeEach(() => {
  // `mockReset`, not `mockClear`: a cell that made the renderer reject would
  // otherwise leave it rejecting for every cell after it — which is exactly how
  // three of these first passed while asserting nothing.
  renderThumbnail.mockReset()
  renderThumbnail.mockImplementation(() => Promise.resolve(new Blob(['png'])))
  // Cleared, never reset: the spy's body is `entry-actions`' real rule.
  framingAfterDiscard.mockClear()
  // The object-URL pair is browser API the core uses; there is no DOM here.
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  // The *render's* recipe, which is `aoEnabled()`'s and not the derivation's
  // (`deps.ao` is the derivation's reader). Pinned so a cell inherits nothing.
  setAoEnabled(true)
})

describe('what a generate derivation keeps', () => {
  it('keeps every model the current build would draw differently, and drops the ones it would not', async () => {
    const h = harness(
      listing([
        model('no-annotation'),
        model('miss', { thumb: thumb({ ao: { state: 'miss' } }) }),
        model('stale', { thumb: thumb({ ao: { state: 'stale', lighting: THUMB_LIGHTING, rig: RIG_VERSION } }) }),
        model('wrong-rig', { thumb: thumb({ ao: currentRender({ rig: RIG_VERSION + 1 }) }) }),
        // 'axis' is the retired lighting label and reads as stale — never as
        // "the current mode" (client/test/CLAUDE.md).
        model('old-lighting', { thumb: thumb({ ao: currentRender({ lighting: 'axis' }) }) }),
        // Unowned — no stored camera and no stored axis — so the index's
        // opinion is an input to the pixels, and a render drawn before it
        // arrived is behind.
        model('unposed', { pose: POSE, thumb: thumb() }),
        // Current: same labels, posed at the version in force and recording
        // this very pose (a keyless posed render is stale, `pose-rerender` D2).
        model('current', {
          pose: POSE,
          thumb: thumb({
            ao: currentRender({
              posed: POSE_VERSION,
              poseKey: poseKeyOf(cameraForPose(POSE, DEFAULT_CAMERA)!),
            }),
          }),
        }),
        // Owned: a stored camera beats the index's opinion (semantic-search
        // D5), so a missing pose label is not staleness here.
        model('owned', {
          pose: POSE,
          thumb: thumb({ framed: true, camera: { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] } }),
        }),
      ]),
    )

    const derived = await h.jobs.derive('generate', SCOPE)

    expect(paths(derived.entries)).toEqual([
      '/kit/no-annotation.stl',
      '/kit/miss.stl',
      '/kit/stale.stl',
      '/kit/wrong-rig.stl',
      '/kit/old-lighting.stl',
      '/kit/unposed.stl',
    ])
  })

  it('reads the variant for the occlusion setting in force, not the other one', async () => {
    const entries = [model('m', { thumb: thumb({ ao: currentRender(), noao: { state: 'miss' } }) })]
    const on = harness(listing(entries), { ao: true })
    const off = harness(listing(entries), { ao: false })

    expect(paths((await on.jobs.derive('generate', SCOPE)).entries)).toEqual([])
    expect(paths((await off.jobs.derive('generate', SCOPE)).entries)).toEqual(['/kit/m.stl'])
  })

  it('snapshots each kept entry’s generation, and calls a model the server knows nothing about zero', async () => {
    const h = harness(listing([model('a', { thumb: thumb({ gen: 9, ao: { state: 'miss' } }) }), model('b')]))

    const derived = await h.jobs.derive('generate', SCOPE)

    expect(derived.entries.map((e) => e.gen)).toEqual([9, 0])
  })

  it('reports a scope the enumeration could not finish', async () => {
    const h = harness(listing([model('a')], false))
    expect((await h.jobs.derive('generate', SCOPE)).incomplete).toBe(true)
    const whole = harness(listing([model('a')]))
    expect((await whole.jobs.derive('generate', SCOPE)).incomplete).toBe(false)
  })
})

describe('what a reset derivation keeps', () => {
  it('keeps exactly the models whose framing a reset would change', async () => {
    const h = harness(
      listing([
        model('framed', { thumb: thumb({ framed: true, camera: CAMERA }) }),
        model('unframed', { thumb: thumb({ framed: false }) }),
        model('no-annotation'),
        // An axis alone, and no usable pose to replace it: the per-model rule
        // keeps that axis, so a reset changes nothing here — not counted, or
        // the button would offer a reset that resets nothing (found live).
        model('axis-only-poseless', { pose: POSE_OFF_AXIS, thumb: thumb({ framed: true, axis: 'z' }) }),
        // The same axis where a usable pose replaces it: given up, so counted.
        model('axis-only-posed', { pose: POSE, thumb: thumb({ framed: true, axis: 'z' }) }),
        // A camera is always given up.
        model('camera', {
          thumb: thumb({ framed: true, camera: { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] } }),
        }),
      ]),
    )

    expect(paths((await h.jobs.derive('reset', SCOPE)).entries)).toEqual([
      '/kit/framed.stl',
      '/kit/axis-only-posed.stl',
      '/kit/camera.stl',
    ])
  })
})

describe('the job’s own orientation wave', () => {
  it('asks about exactly the models the enumeration had no pose for', async () => {
    const h = harness(
      listing([model('known', { pose: POSE }), model('unknown-a'), model('unknown-b')]),
      { poses: { '/kit/unknown-a.stl': POSE } },
    )

    const derived = await h.jobs.derive('generate', SCOPE)

    expect(h.posesFor).toHaveBeenCalledTimes(1)
    expect(h.posesFor).toHaveBeenCalledWith(['/kit/unknown-a.stl', '/kit/unknown-b.stl'])
    // Each entry carries the pose it resolved to: the annotation's, the wave's,
    // or none.
    expect(derived.entries.map((e) => e.pose)).toEqual([POSE, POSE, undefined])
  })

  it('does not ask at all when the enumeration answered for every model', async () => {
    const h = harness(listing([model('a', { pose: POSE }), model('b', { pose: POSE })]))
    await h.jobs.derive('generate', SCOPE)
    expect(h.posesFor).not.toHaveBeenCalled()
  })

  it('derives as if the index had no opinion when the wave fails — silence, not a failure', async () => {
    // Unowned and unposed: with the wave's pose this entry is stale, without it
    // there is nothing about it to be behind.
    const h = harness(listing([model('m', { thumb: thumb() })]))
    h.posesFor.mockRejectedValue(new Error('index down'))

    const derived = await h.jobs.derive('generate', SCOPE)

    expect(paths(derived.entries)).toEqual([])
  })
})

describe('the generate run', () => {
  it('pushes each entry keyed by its path at the pinned far band', async () => {
    const h = harness(listing([model('a'), model('b')]))

    expect(h.jobs.launch('generate', SCOPE)).toBe('started')
    await settle()

    expect(h.push.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['/kit/a.stl', 'far'],
      ['/kit/b.stl', 'far'],
    ])
    expect(h.jobs.state).toMatchObject({ phase: 'done', total: 2, done: 2, failed: 0, skipped: 0 })
  })

  it('keeps at most one entry in the queue at a time, so a slot is always free', async () => {
    const h = harness(listing([model('a'), model('b'), model('c')]))
    // Both slots held: with the queue suspended nothing pushed can start, so
    // what `push` has been called with is the whole of what the job has queued
    // (client/test/CLAUDE.md's render-order rule).
    h.queue.suspend()

    h.jobs.launch('generate', SCOPE)
    await settle()
    expect(h.push).toHaveBeenCalledTimes(1)

    // Released one render at a time: the next push happens only once the
    // previous entry has settled.
    let release = (): void => {}
    renderThumbnail.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(new Blob(['png'])) }),
    )
    h.queue.resume()
    await settle()
    expect(h.push).toHaveBeenCalledTimes(1) // a's render is parked

    release()
    await settle()
    expect(h.push).toHaveBeenCalledTimes(2) // b pushed only now

    renderThumbnail.mockImplementation(() => Promise.resolve(new Blob(['png'])))
    release()
    await settle()
    expect(h.push).toHaveBeenCalledTimes(3)
  })

  it('forwards the snapshotted generation on every write', async () => {
    const h = harness(listing([model('a', { thumb: thumb({ gen: 11, ao: { state: 'miss' } }) })]))

    h.jobs.launch('generate', SCOPE)
    await settle()

    expect(h.putThumb.mock.calls[0]![0]).toMatchObject({ path: '/kit/a.stl', ifGen: 11 })
  })

  it('counts a refused write as skipped and a failed render as failed, and finishes either way', async () => {
    const h = harness(listing([model('a'), model('b'), model('c')]))
    h.putThumb
      .mockRejectedValueOnce(new HttpError(412, 'generation moved'))
      .mockResolvedValue({ gen: 3 })
    renderThumbnail.mockRejectedValueOnce(new Error('no mesh'))

    h.jobs.launch('generate', SCOPE)
    await settle()

    // a: the render succeeded and the write was refused. b: the render threw.
    // c: ordinary.
    expect(h.jobs.state).toMatchObject({ phase: 'done', total: 3, done: 1, skipped: 1, failed: 1 })
    // Two of three went wrong and the job still did not fail as a whole.
    expect(h.jobs.state!.failure).toBeUndefined()
  })

  it('fails as a whole only when nothing in it could proceed', async () => {
    const h = harness(listing([model('a'), model('b')]))
    renderThumbnail.mockRejectedValue(new Error('no mesh'))

    h.jobs.launch('generate', SCOPE)
    await settle()

    expect(h.jobs.state).toMatchObject({ phase: 'done', failed: 2, failure: NOTHING_PROCESSED })
  })

  it('goes straight to done over a scope with nothing to do', async () => {
    const h = harness(listing([model('current', { thumb: thumb() })]))

    h.jobs.launch('generate', SCOPE)
    await settle()

    expect(h.jobs.state).toMatchObject({ phase: 'done', total: 0, done: 0 })
    // An honest nothing, not a failure: a generate over a warm folder ends here.
    expect(h.jobs.state!.failure).toBeUndefined()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('says nothing about a scope it could not enumerate', async () => {
    const h = harness(listing([]))
    h.models.mockRejectedValue(new HttpError(503, 'unconfigured'))

    h.jobs.launch('generate', SCOPE)
    await settle()

    expect(h.jobs.state).toMatchObject({ phase: 'done', total: 0, failure: SCOPE_UNREADABLE })
  })

  it('carries the enumeration’s incompleteness onto the job', async () => {
    const h = harness(listing([model('a')], false))

    h.jobs.launch('generate', SCOPE)
    await settle()

    expect(h.jobs.state).toMatchObject({ incomplete: true, total: 1, done: 1 })
  })
})

describe('the reset run', () => {
  const framedListing = listing([
    model('posed', { pose: POSE, thumb: thumb({ framed: true, axis: '-x' }) }),
    // A camera beside the kept axis, so this one is in the derivation at all:
    // an axis alone with no usable pose is exactly what a reset leaves alone.
    model('poseless', {
      pose: POSE_OFF_AXIS,
      thumb: thumb({ framed: true, axis: 'z', camera: { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] } }),
    }),
  ])

  it('empties each entry with one write, dropping the axis exactly where a usable pose replaces it', async () => {
    const h = harness(framedListing)

    h.jobs.launch('reset', SCOPE)
    await settle()
    h.jobs.confirm()
    await settle()

    expect(h.putThumb.mock.calls.map((c) => c[0])).toEqual([
      { path: '/kit/posed.stl', mtime: 7, camera: null, axis: null, png: null, ifGen: 1 },
      { path: '/kit/poseless.stl', mtime: 7, camera: null, axis: undefined, png: null, ifGen: 1 },
    ])
    // The discard rule is asked, never restated: `entry-actions` owns it.
    expect(framingAfterDiscard.mock.calls.map((c) => c[0])).toEqual([POSE, POSE_OFF_AXIS])
    expect(h.jobs.state).toMatchObject({ phase: 'done', total: 2, done: 2 })
  })

  it('renders nothing and loads no mesh', async () => {
    const h = harness(framedListing)

    h.jobs.launch('reset', SCOPE)
    await settle()
    h.jobs.confirm()
    await settle()

    expect(h.push).not.toHaveBeenCalled()
    expect(h.acquire).not.toHaveBeenCalled()
    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it('restarts an on-screen tile after each accepted write, and after no refused one', async () => {
    const h = harness(framedListing)
    h.putThumb.mockResolvedValueOnce({ gen: 2 }).mockRejectedValueOnce(new HttpError(412, 'moved'))

    h.jobs.launch('reset', SCOPE)
    await settle()
    h.jobs.confirm()
    await settle()

    expect(h.refetch.mock.calls).toEqual([['/kit/posed.stl']])
    expect(h.jobs.state).toMatchObject({ phase: 'done', done: 1, skipped: 1, failed: 0 })
  })

  it('asks before it discards anything, and a cancelled confirmation sends nothing', async () => {
    const h = harness(framedListing)

    h.jobs.launch('reset', SCOPE)
    await settle()
    // The count exists — that is what the confirmation states (D5) — and not a
    // byte has been written.
    expect(h.jobs.state).toMatchObject({ phase: 'confirming', total: 2 })
    expect(h.putThumb).not.toHaveBeenCalled()

    h.jobs.cancel()
    await settle()

    expect(h.putThumb).not.toHaveBeenCalled()
    expect(h.jobs.state).toMatchObject({ phase: 'cancelled', done: 0 })
  })
})

describe('one job at a time, cancelled at any instant', () => {
  it('answers busy to a second launch, starts nothing, and brings the chip back', async () => {
    const h = harness(listing([model('a'), model('b')]))
    h.queue.suspend()

    expect(h.jobs.launch('generate', SCOPE)).toBe('started')
    await settle()
    h.jobs.dismiss()
    expect(h.jobs.state).toMatchObject({ phase: 'running', dismissed: true })

    expect(h.jobs.launch('reset', { path: '/other', label: 'other' })).toBe('busy')
    await settle()

    // Nothing of the second launch happened: the scope was not even enumerated,
    // and the state still describes the job that is running.
    expect(h.models).toHaveBeenCalledTimes(1)
    expect(h.jobs.state).toMatchObject({
      operation: 'generate',
      scope: SCOPE,
      phase: 'running',
      dismissed: false,
    })
  })

  it('dismissing hides the chip without stopping the work', async () => {
    const h = harness(listing([model('a')]))

    h.jobs.launch('generate', SCOPE)
    h.jobs.dismiss()
    await settle()

    expect(h.jobs.state).toMatchObject({ phase: 'done', done: 1, dismissed: true })
  })

  it('stops pushing at once and still counts the entry already in flight', async () => {
    const h = harness(listing([model('a'), model('b'), model('c')]))
    h.queue.suspend()

    h.jobs.launch('generate', SCOPE)
    await settle()
    expect(h.push).toHaveBeenCalledTimes(1)

    h.jobs.cancel()
    // The pushed entry is not recalled — it runs and is counted.
    h.queue.resume()
    await settle()

    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.putThumb).toHaveBeenCalledTimes(1)
    expect(h.jobs.state).toMatchObject({ phase: 'cancelled', total: 3, done: 1 })
  })

  it('derives the remainder when it is launched again', async () => {
    const h = harness(listing([model('a'), model('b'), model('c')]))
    h.queue.suspend()

    h.jobs.launch('generate', SCOPE)
    await settle()
    h.jobs.cancel()
    h.queue.resume()
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'cancelled', done: 1 })

    // The state of the world after the first run: `a` is current now, so the
    // second derivation is exactly the remainder — no persisted record says so
    // (D1), the entry's own annotation does.
    h.models.mockResolvedValue(
      listing([model('a', { thumb: thumb() }), model('b'), model('c')]),
    )
    h.push.mockClear()

    expect(h.jobs.launch('generate', SCOPE)).toBe('started')
    await settle()

    expect(h.push.mock.calls.map((c) => c[1])).toEqual(['/kit/b.stl', '/kit/c.stl'])
    expect(h.jobs.state).toMatchObject({ phase: 'done', total: 2, done: 2 })
  })

  it('lets a stale run report nothing onto the job that replaced it', async () => {
    // A cancel cannot recall the entry already in flight, and the user may
    // launch the next job the instant they pressed Cancel. The abandoned render
    // then settles inside a process whose `this.current` is somebody else's
    // job: unguarded, its counters land on that job and its final phase flips a
    // freshly launched one to `cancelled` while the derivation is still in
    // flight. The run's token is the identity that stops it. Falsify by
    // restoring the bare `this.patch` inside `run`.
    const h = harness(listing([]))
    h.models.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/a'
          ? listing([model('a1'), model('a2'), model('a3')])
          : listing([model('b1', { pose: POSE, thumb: thumb({ framed: true, camera: CAMERA }) })]),
      ),
    )
    let release = (): void => {}
    renderThumbnail.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(new Blob(['png'])) }),
    )

    h.jobs.launch('generate', { path: '/a', label: 'a' })
    await settle()
    expect(renderThumbnail).toHaveBeenCalledTimes(1) // a1 is mid-render

    h.jobs.cancel()
    expect(h.jobs.launch('reset', { path: '/b', label: 'b' })).toBe('started')
    expect(h.jobs.state).toMatchObject({ scope: { path: '/b' }, phase: 'deriving' })

    // The abandoned render lands: it counts a1, breaks on the cancel, and tries
    // to publish both the count and its final phase.
    release()
    await settle()

    expect(h.jobs.state).toMatchObject({
      operation: 'reset',
      scope: { path: '/b', label: 'b' },
      // /b's own progress, not the run that died: it derived one framed entry
      // and is waiting to be confirmed.
      phase: 'confirming',
      total: 1,
      done: 0,
      failed: 0,
      skipped: 0,
    })
  })

  it('discards a derivation that lands after the cancel', async () => {
    const h = harness(listing([model('a')]))
    let land = (): void => {}
    h.models.mockReturnValue(
      new Promise((resolve) => { land = () => resolve(listing([model('a')])) }),
    )

    h.jobs.launch('generate', SCOPE)
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'deriving' })

    h.jobs.cancel()
    land()
    await settle()

    expect(h.push).not.toHaveBeenCalled()
    expect(h.jobs.state).toMatchObject({ phase: 'cancelled', total: 0 })
  })
})

describe('the state the chip subscribes to', () => {
  it('notifies on every change and hands back one stable object between them', async () => {
    const h = harness(listing([model('a')]))
    const seen: unknown[] = []
    const stop = h.jobs.subscribe(() => seen.push(h.jobs.state))

    expect(h.jobs.state).toBeNull()
    h.jobs.launch('generate', SCOPE)
    await settle()
    stop()

    expect(seen.length).toBeGreaterThan(1)
    // Every notification carried a new object, and the getter is stable between
    // them — what `useSyncExternalStore` requires of a snapshot.
    expect(new Set(seen).size).toBe(seen.length)
    expect(h.jobs.state).toBe(h.jobs.state)
    expect(seen[seen.length - 1]).toBe(h.jobs.state)
  })
})

describe('counting a scope', () => {
  it('answers both counts from one enumeration and one wave', async () => {
    const h = harness(
      listing(
        [
          model('missing'),
          model('framed', { thumb: thumb({ framed: true, camera: CAMERA }) }),
          model('framed-and-missing', { thumb: thumb({ framed: true, camera: CAMERA, ao: { state: 'miss' } }) }),
        ],
        false,
      ),
    )
    expect(await h.jobs.count(SCOPE)).toEqual({ generate: 2, reset: 2, incomplete: true })
    // One walk — the two numbers are two filters over one answer — and no wave
    // at all: nothing here is axis-only, which is the one shape a count needs
    // the index for.
    expect(h.models).toHaveBeenCalledTimes(1)
    expect(h.posesFor).not.toHaveBeenCalled()
    // And the same filters the work list uses: a count is a derivation's size.
    expect((await h.jobs.derive('generate', SCOPE)).entries).toHaveLength(2)
    expect((await h.jobs.derive('reset', SCOPE)).entries).toHaveLength(2)
  })
})

describe('what a count asks the index about', () => {
  it('waves only over the axis-only models whose rule needs a pose, and a derivation over all the unknown', async () => {
    const h = harness(
      listing([
        model('unposed-plain'),
        model('unposed-axis-only', { thumb: thumb({ framed: true, axis: 'z' }) }),
        model('unposed-camera', { thumb: thumb({ framed: true, camera: { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] } }) }),
        model('posed-axis-only', { pose: POSE, thumb: thumb({ framed: true, axis: 'z' }) }),
      ]),
    )
    await h.jobs.count(SCOPE)
    // One request, naming exactly the model a count cannot judge without the index.
    expect(h.posesFor.mock.calls.map((c) => c[0])).toEqual([['/kit/unposed-axis-only.stl']])
    h.posesFor.mockClear()
    // A reset consults the index wherever an axis is stored — with or without a
    // camera, since the pose decides whether the axis goes with it.
    await h.jobs.derive('reset', SCOPE)
    expect(h.posesFor.mock.calls.map((c) => c[0])).toEqual([['/kit/unposed-axis-only.stl']])
    h.posesFor.mockClear()
    await h.jobs.derive('generate', SCOPE)
    expect(h.posesFor.mock.calls.map((c) => c[0])).toEqual([
      ['/kit/unposed-plain.stl', '/kit/unposed-axis-only.stl', '/kit/unposed-camera.stl'],
    ])
  })

  it('makes no request at all when nothing axis-only is unposed', async () => {
    const h = harness(listing([model('unposed-plain'), model('unposed-camera', { thumb: thumb({ framed: true, camera: { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] } }) })]))
    await h.jobs.count(SCOPE)
    expect(h.posesFor).not.toHaveBeenCalled()
    // Nor does a reset over the same models: no axis is stored anywhere here.
    await h.jobs.derive('reset', SCOPE)
    expect(h.posesFor).not.toHaveBeenCalled()
  })

  it('a reset asks about a stored axis beside a camera, which a count does not need', async () => {
    const h = harness(listing([model('camera-and-axis', { thumb: thumb({ framed: true, axis: 'z', camera: { az: 1, el: 0.2, distR: 3, target: [0, 0, 0] } }) })]))
    await h.jobs.count(SCOPE)
    expect(h.posesFor).not.toHaveBeenCalled()
    await h.jobs.derive('reset', SCOPE)
    expect(h.posesFor.mock.calls.map((c) => c[0])).toEqual([['/kit/camera-and-axis.stl']])
  })
})

describe('what a job reports it wrote', () => {
  it('counts a landed write, not an entry found current or refused', async () => {
    const h = harness(
      listing([
        model('missing-a'),
        model('missing-b'),
        model('current-on-lookup', { thumb: thumb({ ao: { state: 'miss' } }) }),
      ]),
    )
    // Two lookups miss (render, write); the third answers a current hit, so
    // the core says 'current' — processed, but nothing written. Asymmetric on
    // purpose: one of each could not tell `wrote` from `done - wrote`.
    h.getThumb
      .mockResolvedValueOnce({ status: 'miss' })
      .mockResolvedValueOnce({ status: 'miss' })
      .mockResolvedValueOnce({ status: 'hit', pngUrl: 'blob:x', lighting: THUMB_LIGHTING, rig: RIG_VERSION })
    h.jobs.launch('generate', SCOPE)
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'done', settled: true, done: 3, wrote: 2, runId: 1 })
    // A second launch is a new run.
    h.jobs.launch('generate', SCOPE)
    await settle()
    expect(h.jobs.state).toMatchObject({ runId: 2 })
  })

  it('settles only when the in-flight entry has landed, cancelled or not', async () => {
    let land = (): void => {}
    const h = harness(listing([model('a', { thumb: thumb({ framed: true, camera: CAMERA }) }), model('b', { thumb: thumb({ framed: true, camera: CAMERA }) })]))
    h.putThumb.mockImplementationOnce(() => new Promise((r) => { land = () => r({ gen: 2 }) }))
    h.jobs.launch('reset', SCOPE)
    await settle()
    h.jobs.confirm()
    await settle()
    h.jobs.cancel()
    expect(h.jobs.state).toMatchObject({ phase: 'cancelled', settled: false, wrote: 0 })
    land()
    await settle()
    // The write a cancel could not recall is counted, and only then is the job over.
    expect(h.jobs.state).toMatchObject({ phase: 'cancelled', settled: true, done: 1, wrote: 1 })
    expect(h.putThumb).toHaveBeenCalledTimes(1)
  })

  it("does not count a reset's write the client kept rather than sent", async () => {
    // On a deployment refusing thumbnail writes the local-framing decorator
    // resolves `putThumb` with `{ dropped: true }` and reaches no store. The
    // entry is processed — `done` — but nothing was written, and the chip
    // reporting otherwise would claim writes nobody made. The same rule the
    // generate path already gets through `renderEntryThumbnail`'s `skipped`.
    const h = harness(
      listing([
        model('a', { thumb: thumb({ framed: true, camera: CAMERA }) }),
        model('b', { thumb: thumb({ framed: true, camera: CAMERA }) }),
      ]),
    )
    // Asymmetric on purpose: one of each, so `wrote: 1` cannot be read as
    // either counter by accident.
    h.putThumb.mockResolvedValueOnce({ gen: 2 }).mockResolvedValueOnce({ dropped: true })
    h.jobs.launch('reset', SCOPE)
    await settle()
    h.jobs.confirm()
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'done', settled: true, done: 2, wrote: 1, failed: 0, skipped: 0 })
  })
})

describe('what the chip can say about a wait', () => {
  it('reports an entry pushed but not started, and clears it the moment it runs', async () => {
    const h = harness(listing([model('a'), model('b')]))
    h.queue.suspend()
    h.jobs.launch('generate', SCOPE)
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'running', waiting: true, done: 0 })
    h.queue.resume()
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'done', waiting: false, done: 2 })
  })

  it('never reports a reset as waiting: its writes go nowhere near the queue', async () => {
    const h = harness(listing([model('a', { thumb: thumb({ framed: true, camera: CAMERA }) })]))
    h.queue.suspend()
    h.jobs.launch('reset', SCOPE)
    await settle()
    h.jobs.confirm()
    await settle()
    expect(h.jobs.state).toMatchObject({ phase: 'done', waiting: false, wrote: 1 })
  })
})
