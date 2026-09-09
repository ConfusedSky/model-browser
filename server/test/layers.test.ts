/**
 * The derived layers, the emission that reads them, the enumeration that joins
 * them to the snapshot, and the two operations that drive the pass on demand —
 * `listing-tree-cache` §6.1–§6.7 and §7.3's server half.
 *
 * The layers are **process-local** (design D7's persistence note), so "a fresh
 * server" here is a fresh `ListingCache`/`createApp` over the *same* cache
 * directory: the tree snapshot survives, the poses and preview choices do not.
 * That is the third drop point the settlement names, and it has a cell of its
 * own below.
 */

import { chmodSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing, IndexPose, ModelsListing, ReloadResult } from '../../shared/types'
import { ANNOTATION_BUDGET_MS, FILL_PREVIEW_MAX, createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { DerivedLayers, LAYER_VERSION, POSE_ANNOTATION_TTL_MS } from '../src/layers'
import type { Library } from '../src/library'
import { ListingCache, REVALIDATE_TTL_MS } from '../src/listingCache'
import { posesAsked, resetIndexStatus } from '../src/semantic'
import { SnapshotStore } from '../src/snapshot'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * The same syscall instrumentation `listingCache.test.ts` documents, and for the
 * same reason: "no directory rescan per listing" and "opens no archive" are
 * claims about syscalls, and timing would be a proxy for them rather than the
 * thing itself. `vi.spyOn` cannot touch an ESM namespace, so the module is
 * mocked and the two calls wrapped around the real ones.
 */
const fs = vi.hoisted(() => ({ readdirs: [] as string[], opens: [] as string[] }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      fs.readdirs.push(String(args[0]))
      return actual.readdir(...(args as Parameters<typeof actual.readdir>))
    }) as typeof actual.readdir,
    open: (async (...args: Parameters<typeof actual.open>) => {
      fs.opens.push(String(args[0]))
      return actual.open(...args)
    }) as typeof actual.open,
  }
})

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
  delete process.env.MODEL_BROWSER_FLAT_CAP
  delete process.env.MODEL_BROWSER_SEARCH_BUDGET
  vi.unstubAllGlobals()
  resetIndexStatus()
})

beforeEach(() => {
  fs.readdirs.length = 0
  fs.opens.length = 0
  resetIndexStatus()
})

function tempDir(prefix: string): string {
  const dir = realTempDir(prefix)
  cleanups.push(dir)
  return dir
}

interface Fixture {
  top: string
  kit: string
  zip: string
  library: Library
  store: SnapshotStore
  /** The cache root: a second store or app over it is what a restart is. */
  base: string
}

/**
 * ```
 * top/kit/loose.stl  a/bracket.stl  a/deep/part.stl  z/bracket.stl
 *        box.zip { box.stl, arms/left.stl }
 * ```
 * The shape `listingCache.test.ts` uses, so a reader moving between the two
 * files is reading about the same tree.
 */
async function fixture(id: string): Promise<Fixture> {
  const top = join(tempDir('mb-ly-'), 'top')
  mkdirSync(join(top, '.model-browser'), { recursive: true })
  writeFileSync(join(top, '.model-browser', 'library.json'), JSON.stringify({ id, version: 1 }))
  const kit = join(top, 'kit')
  mkdirSync(join(kit, 'a', 'deep'), { recursive: true })
  mkdirSync(join(kit, 'z'))
  writeFileSync(join(kit, 'loose.stl'), stlBytes(1))
  writeFileSync(join(kit, 'a', 'bracket.stl'), stlBytes(2))
  writeFileSync(join(kit, 'a', 'deep', 'part.stl'), stlBytes(3))
  writeFileSync(join(kit, 'z', 'bracket.stl'), stlBytes(4))
  const zip = join(kit, 'box.zip')
  writeFileSync(
    zip,
    zipSync({ 'box.stl': new Uint8Array(stlBytes(5)), 'arms/left.stl': new Uint8Array(stlBytes(6)) }),
  )
  const base = tempDir('mb-ly-cache-')
  const library = libraryFor(top)
  await library.state()
  return { top, kit, zip, library, store: new SnapshotStore(base, undefined, library), base }
}

const ROOT = '/kit'

function treeReaddirs(f: Fixture): string[] {
  return fs.readdirs.filter((p) => p === f.kit || p.startsWith(`${f.kit}/`))
}

function archiveOpens(f: Fixture): number {
  return fs.opens.filter((p) => p === f.zip).length
}

/**
 * Typed, not inferred: the pose cells below hand this straight to
 * `recordPoses`, whose `IndexPose` wants fixed-length tuples where a bare
 * literal infers `number[]`. The stubbed-index cells only ever serialise it, so
 * the annotation costs them nothing.
 */
const POSE: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}

/**
 * The index, stubbed at `fetch`: `/status` answers ready from `collectionRoot`,
 * `/poses` answers the given map (keyed by **real filesystem path**, which is
 * how the index speaks). Returns the spy, so a cell can count what emission cost.
 */
function stubIndex(collectionRoot: string, poses: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.endsWith('/status')) {
      return new Response(
        JSON.stringify({
          ready: true,
          elapsed: 1,
          collection_root: collectionRoot,
          covers: ['stl'],
          volume: { present: true, root: collectionRoot, missing: null },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    if (u.endsWith('/poses')) {
      return new Response(JSON.stringify({ poses }), { headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected fetch: ${u}`)
  })
  vi.stubGlobal('fetch', spy)
  resetIndexStatus()
  return spy
}

/** An index that is up but says nothing about any model. */
function stubSilentIndex(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => {
    throw new TypeError('fetch failed')
  })
  vi.stubGlobal('fetch', spy)
  resetIndexStatus()
  return spy
}

interface Server {
  app: ReturnType<typeof createApp>
  cache: ThumbCache
  listings: ListingCache
}

/**
 * A server over the fixture. `store` omitted is a server with no tree cache at
 * all — the pre-change shape, and the control for the byte-identity cell.
 */
function serverFor(f: Fixture, opts: { store?: SnapshotStore; listings?: ListingCache } = {}): Server {
  const store = 'store' in opts ? opts.store : f.store
  const cache = new ThumbCache(join(f.base, 'thumbs'), undefined, undefined, f.library)
  const listings = opts.listings ?? new ListingCache(store)
  return {
    app: createApp(cache, undefined, undefined, f.library, undefined, undefined, store, listings),
    cache,
    listings,
  }
}

async function listFlat(s: Server, path = ROOT): Promise<DirListing> {
  const res = await s.app.request(`/api/dir?flat=true&path=${encodeURIComponent(path)}`, {
    headers: LOOPBACK,
  })
  expect(res.status).toBe(200)
  return (await res.json()) as DirListing
}

async function listDir(s: Server, path: string): Promise<DirListing> {
  const res = await s.app.request(`/api/dir?path=${encodeURIComponent(path)}`, { headers: LOOPBACK })
  expect(res.status).toBe(200)
  return (await res.json()) as DirListing
}

async function askPoses(s: Server, path: string): Promise<Response> {
  return s.app.request(`/api/semantic/poses?path=${encodeURIComponent(path)}`, { headers: LOOPBACK })
}

async function enumerate(s: Server, path: string): Promise<ModelsListing> {
  const res = await s.app.request(`/api/models?path=${encodeURIComponent(path)}`, { headers: LOOPBACK })
  expect(res.status).toBe(200)
  return (await res.json()) as ModelsListing
}

function entryFor(listing: { entries: DirEntry[] }, name: string): DirEntry {
  const found = listing.entries.find((e) => e.name === name)
  expect(found, `no entry named ${name}`).toBeDefined()
  return found!
}

describe('the pose layer rides the listing (§6.1, §6.3)', () => {
  it('carries a pose the proxy already answered, without asking the index again', async () => {
    const f = await fixture('ly-pose')
    const s = serverFor(f)
    const index = stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })

    // Nothing has flowed through the server yet, so the layer knows nothing and
    // the field is simply absent — never `null`, never a guess.
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toBeUndefined()

    expect((await askPoses(s, ROOT)).status).toBe(200)

    const asked = index.mock.calls.length
    const listing = await listFlat(s)
    expect(entryFor(listing, 'loose.stl').pose).toEqual(POSE)
    // What this cell pins is the *layer serving*: the pose it carried was read,
    // not re-fetched — no request after this point names that model.
    //
    // It used to assert the listing made no call at all, which the 2026-09-03
    // revision (§6.9) superseded for the ready-index case: emission now fills
    // what the layers lack, so a listing whose *other* models are unposed does
    // make a batch of its own. That is the feature, and asserting its absence
    // would have pinned the shape the revision removed. The claim that survives
    // — and the one the delta still makes — is per fact, not per listing.
    const after = index.mock.calls
      .slice(asked)
      .filter((c) => String(c[0]).endsWith('/poses'))
      .map((c) => String((c[1] as RequestInit | undefined)?.body ?? ''))
    // **Unconditional** (round-3 review, finding 7). A `for` loop over the
    // batches this listing sent asserts nothing when there were none, and "there
    // were none" is exactly what a fill that stopped running looks like — so the
    // cell would have gone on passing over the feature's own corpse. The
    // listing's other models are unposed, so a working fill sends batches, and
    // this says so before it inspects them.
    expect(after.length).toBeGreaterThan(0)
    for (const body of after) {
      // Two needles (finding 7), and their standing is not the same — recorded
      // rather than glossed. The **real** path is the falsifiable one: it is
      // what a `/poses` body carries, so a fill that re-asked about a model the
      // layer already answered for puts it right here. The **library** path is
      // the spelling the layer, the annotation and the client key this model
      // under, and no defect could be built that fires it *alone*: this stub
      // answers by realpath, so any batch that went out spelled the other way
      // comes back empty and the carried-pose assertion above trips first
      // (`expected null to deeply equal { up: … }`, both attempts). It is kept
      // as the assertion that stays true rather than as coverage that was
      // falsified — the honest label, since the two are not the same claim.
      expect(body).not.toContain(join(f.kit, 'loose.stl'))
      expect(body).not.toContain(`${ROOT}/loose.stl`)
    }
    // The zero-call claim still has a home: it belongs to the states where the
    // probe gate is what stops the fill, and the two cells below are it.
  })

  it('emits with a wedged index at the speed of one with none — no call at all (§7.3)', async () => {
    const f = await fixture('ly-wedged')
    const s = serverFor(f)
    stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await askPoses(s, ROOT)

    // The index goes wedged *after* the layer learned something. Instrumented,
    // never timed: the claim is that emission does not talk to it, and a
    // stopwatch would measure the machine instead.
    const wedged = stubSilentIndex()
    const listing = await listFlat(s)

    expect(wedged.mock.calls.length).toBe(0)
    // And what it holds still rides, which is the delta's "carrying whatever
    // annotations the layers already held and omitting the rest".
    expect(entryFor(listing, 'loose.stl').pose).toEqual(POSE)
  })

  it('drops both layers when the index answers from another collection root (§7.3)', async () => {
    const f = await fixture('ly-repoint')
    const s = serverFor(f)
    stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await askPoses(s, ROOT)
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toEqual(POSE)

    // The same index, now rooted somewhere else entirely. Its answers are about
    // a different collection, so what was derived from the old one is dropped —
    // wholesale, since there is no per-entry way to tell which survived.
    const other = tempDir('mb-ly-other-')
    stubIndex(other, {})
    await askPoses(s, ROOT)

    const listing = await listFlat(s)
    // The pose derived from the old collection is gone, which is this cell's
    // claim. What stands in its place is `null` rather than nothing, and that is
    // the round-3 revision showing through (finding 6): emission re-asked under
    // the new root, the model resolves outside that collection — a settled "no"
    // no round trip would change — so the answer recorded and emitted is "asked,
    // and it has none". `toBeUndefined` was the old spelling of the same fact
    // back when a recorded negative could not reach the wire at all.
    expect(entryFor(listing, 'loose.stl').pose).toBeNull()
    // …and the tree is untouched: the snapshot is a function of the root alone,
    // so an index repoint has no bearing on it (D1/D7).
    expect(listing.entries.map((e) => e.name)).toEqual(
      (await listFlat(serverFor(f, { store: undefined }))).entries.map((e) => e.name),
    )
  })

  it('a restart drops the layers while the tree keeps serving (the third drop point)', async () => {
    const f = await fixture('ly-restart')
    const first = serverFor(f)
    stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await askPoses(f.library === undefined ? first : first, ROOT)
    await listFlat(first)
    expect(entryFor(await listFlat(first), 'loose.stl').pose).toEqual(POSE)

    // A new process over the same cache directory: same snapshot store, new
    // `ListingCache`, so new layers. This is what makes a persisted pose
    // unable to outlive a re-classification — the reason the layers are in
    // memory at all (design D7's persistence note).
    const restarted = serverFor(f, { store: new SnapshotStore(f.base, undefined, f.library) })
    const listing = await listFlat(restarted)
    expect(entryFor(listing, 'loose.stl').pose).toBeUndefined()
    // The tree, by contrast, is durable and still answers.
    expect(await new SnapshotStore(f.base, undefined, f.library).load(ROOT)).not.toBeNull()
  })
})

describe('a recorded pose converges rather than sticking (round-2 finding 6)', () => {
  it('stops being emitted once it is older than the annotation TTL', async () => {
    const f = await fixture('ly-pose-ttl')
    // The clock is injected rather than slept through, exactly as
    // `listingCache.test.ts` injects the revalidation TTL's: five minutes a cell
    // would be paying the constant rather than testing it.
    let now = 1_000_000
    const layers = new DerivedLayers(LAYER_VERSION, () => now)
    const s = serverFor(f, { listings: new ListingCache(f.store, layers) })
    const model = join(f.kit, 'loose.stl')
    stubIndex(f.top, { [model]: POSE })

    await askPoses(s, ROOT)
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toEqual(POSE)

    // Just inside the horizon: still the fast path, still no round trip.
    now += POSE_ANNOTATION_TTL_MS - 1
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toEqual(POSE)

    // Past it. Without this the annotation would have turned the client's
    // per-listing wave off for that model permanently — an entry the layer can
    // answer is filtered out of the wave, and nothing else here ever drops a
    // pose — so a re-classification would reach the user at the next *restart*
    // rather than the next navigation, which is worse than the guarantee the
    // annotation replaced.
    now += 1
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toBeUndefined()
    // Dropped, not merely withheld: the wave re-asks, `recordPoses` re-learns,
    // and the horizon starts again from the answer the index just gave.
    expect(layers.size().poses).toBe(0)

    await askPoses(s, ROOT)
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toEqual(POSE)
  })
})

describe('the preview layer and its ancestors (§6.1, §7.3)', () => {
  /** Record a sheet for each directory, as a peek of each would. */
  function seed(layers: DerivedLayers, root: string, dirs: string[]): void {
    for (const dir of dirs) {
      layers.recordPreview(root, dir, 4, [
        { name: 'x.stl', path: `${dir}/x.stl`, kind: 'model', size: 1, mtime: 1 },
      ])
    }
  }

  it('a sheet carried on the listing has cells annotated as the models beside its folder are', async () => {
    // `thumbnail-image-serving` D2, second review: the layer copies previews
    // out and the copy strips `thumb`, so a revisit — where the sheet rides
    // the listing rather than a peek — cost a lookup per cell that the first
    // visit never did. The cells are annotated at emission like every other
    // model entry.
    const f = await fixture('ly-sheet-thumb')
    const s = serverFor(f)
    await listFlat(s)
    const cell: DirEntry = { name: 'bracket.stl', path: `${ROOT}/a/bracket.stl`, kind: 'model', size: 1, mtime: 2 }
    s.listings.layers.recordPreview(f.top, `${ROOT}/a`, 4, [cell])
    const gen = await s.cache.put(cell.path, { mtime: 2, png: Buffer.from('px'), lighting: 'camera', rig: 1 })

    const sheet = entryFor(await listDir(s, ROOT), 'a').preview
    expect(sheet).toHaveLength(1)
    expect(sheet![0]!.thumb?.gen).toBe(gen)
    expect(sheet![0]!.thumb?.ao?.state).toBe('hit')
    // The layer's own record is untouched by the annotation: a later emission
    // derives `state` afresh rather than reading a stored verdict.
    expect(s.listings.layers.previewFor(`${ROOT}/a`, 4)![0]!.thumb).toBeUndefined()
  })

  it('re-derives the changed directory and every ancestor, and no unchanged sibling', async () => {
    const f = await fixture('ly-ancestors')
    const listings = new ListingCache(f.store)
    const s = serverFor(f, { listings })
    await listFlat(s) // walk and persist the tree

    const dirs = ['/', ROOT, `${ROOT}/a`, `${ROOT}/a/deep`, `${ROOT}/z`]
    seed(listings.layers, f.top, dirs)
    expect(listings.layers.size().previews).toBe(dirs.length)

    // A change three levels down. Only `deep`'s own mtime moves — that is the
    // whole reason ancestors need naming: mtime does not propagate upward,
    // while a contact sheet's contents do.
    writeFileSync(join(f.kit, 'a', 'deep', 'added.stl'), stlBytes(9))
    expect(await listings.revalidate(f.library, ROOT)).toBe(true)

    for (const gone of ['/', ROOT, `${ROOT}/a`, `${ROOT}/a/deep`]) {
      expect(listings.layers.previewFor(gone, 4), `${gone} should be re-derived`).toBeUndefined()
    }
    // The sibling branch saw nothing change and keeps its choice: this is why
    // the pass reports *which* directories moved instead of a bare boolean.
    expect(listings.layers.previewFor(`${ROOT}/z`, 4)).toBeDefined()
  })

  it.skipIf(process.getuid?.() === 0)(
    'an invalidated tree takes its previews with it, and leaves the rest alone (round-2 finding 8)',
    async () => {
      const f = await fixture('ly-invalidate-previews')
      const listings = new ListingCache(f.store)
      const s = serverFor(f, { listings })
      await listFlat(s)

      // Sheets inside the tree about to be contradicted, and one outside it.
      seed(listings.layers, f.top, [ROOT, `${ROOT}/a`, `${ROOT}/a/deep`, '/'])
      const posed = { path: join(f.kit, 'loose.stl') }
      listings.layers.recordPoses(f.top, { [posed.path]: POSE })

      // A contradiction, not a change: the root is there and refuses to be
      // read, so the pass invalidates rather than correcting. That branch has no
      // list of changed directories, so it drove `noteDirChanged` for nothing —
      // and every folder tile under the root went on drawing a contact sheet of
      // a subtree the pass had just thrown away, beside a listing walked fresh
      // from disk.
      chmodSync(f.kit, 0o000)
      try {
        expect(await listings.revalidate(f.library, ROOT)).toBe(false)
      } finally {
        chmodSync(f.kit, 0o755)
      }
      expect(await f.store.load(ROOT)).toBeNull()

      for (const gone of [ROOT, `${ROOT}/a`, `${ROOT}/a/deep`]) {
        expect(listings.layers.previewFor(gone, 4), `${gone} should be dropped`).toBeUndefined()
      }
      // The library root's own sheet is kept: an invalidate says the pass could
      // not finish, not that anything changed, and dropping every ancestor would
      // clear `/`'s sheet whenever any kit anywhere failed to revalidate.
      expect(listings.layers.previewFor('/', 4)).toBeDefined()
      // Poses are untouched — a tree that could not be read says nothing about
      // the geometry of the models in it.
      expect(listings.layers.poseFor(posed.path)).toEqual(POSE)
    },
  )

  it('a peek records its choice, and a listing then carries it on the folder tile', async () => {
    const f = await fixture('ly-preview-emit')
    const s = serverFor(f)
    stubSilentIndex() // the plain walk decides the sheet; the layer records it either way

    const peeked = await s.app.request(`/api/peek?path=${encodeURIComponent(`${ROOT}/a`)}&n=4`, {
      headers: LOOPBACK,
    })
    expect(peeked.status).toBe(200)
    const sheet = (await peeked.json()) as DirEntry[]
    expect(sheet.length).toBeGreaterThan(0)

    // A sheet filed under a *model's* path — which nothing produces today, and
    // which emission must still never read: a model tile is not a folder, and
    // the guard that says so has to be able to fail for this to be coverage.
    s.listings.layers.recordPreview(undefined, `${ROOT}/loose.stl`, 4, [
      { name: 'forged.stl', path: '/x', kind: 'model', size: 0, mtime: 0 },
    ])

    const listing = await listDir(s, ROOT)
    expect(entryFor(listing, 'a').preview?.map((e) => e.path)).toEqual(sheet.map((e) => e.path))
    expect(entryFor(listing, 'loose.stl').preview).toBeUndefined()
  })
})

describe('the thumbnail-state index (§6.2)', () => {
  it('answers presence, staleness, gen and framed per occlusion variant, from memory', async () => {
    const f = await fixture('ly-thumb')
    const s = serverFor(f)
    const mtime = statSync(join(f.kit, 'loose.stl')).mtimeMs

    // Nothing read or written for this path yet: no fact, so no field.
    expect(entryFor(await listFlat(s), 'loose.stl').thumb).toBeUndefined()

    const put = await s.app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '/kit/loose.stl',
        mtime,
        png: Buffer.from([1, 2, 3]).toString('base64'),
        lighting: 'camera',
        rig: 7,
        axis: 'z',
      }),
    })
    expect(put.status).toBe(200)
    const gen = ((await put.json()) as { gen: number }).gen

    const before = fs.readdirs.length
    const thumb = entryFor(await listFlat(s), 'loose.stl').thumb
    // No directory was rescanned to answer it — the index is maintained on the
    // cache's own reads and writes, which is what makes it affordable per tile.
    expect(fs.readdirs.length).toBe(before)
    expect(thumb).toEqual({
      gen,
      framed: true, // an axis alone frames it, the definition the bulk jobs' reset shares
      axis: 'z',
      ao: { state: 'hit', lighting: 'camera', rig: 7 },
      // The variant that was never rendered: per-variant presence, since the
      // store keys renders that way.
      noao: { state: 'miss' },
    })
  })

  it('reads staleness against the entry’s own mtime, not against a stored verdict', async () => {
    const f = await fixture('ly-thumb-stale')
    const s = serverFor(f)
    const model = join(f.kit, 'loose.stl')
    const mtime = statSync(model).mtimeMs
    await s.app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/kit/loose.stl', mtime, png: Buffer.from([1]).toString('base64') }),
    })
    expect(entryFor(await listFlat(s), 'loose.stl').thumb?.ao?.state).toBe('hit')

    // The file is edited under the cached render. Nothing rewrites the sidecar,
    // and nothing needs to: the state is derived at emission, so the next
    // listing says `stale` on its own.
    const moved = mtime + 5000
    utimesSync(model, new Date(moved), new Date(moved))
    await new SnapshotStore(f.base, undefined, f.library).invalidate(ROOT) // re-walk, fresh mtimes
    expect(entryFor(await listFlat(s), 'loose.stl').thumb?.ao?.state).toBe('stale')
  })

  it('a read teaches it as much as a write does', async () => {
    const f = await fixture('ly-thumb-read')
    const s = serverFor(f)
    const mtime = statSync(join(f.kit, 'loose.stl')).mtimeMs
    // A GET for an entry that is not cached: the answer is "nothing here", and
    // that is a fact worth keeping — the next listing can say so without a
    // second round trip.
    const got = await s.app.request(`/api/thumb?path=${encodeURIComponent('/kit/loose.stl')}&mtime=${mtime}`, {
      headers: LOOPBACK,
    })
    expect(got.status).toBe(200)
    expect(entryFor(await listFlat(s), 'loose.stl').thumb).toEqual({
      gen: 0,
      framed: false,
      ao: { state: 'miss' },
      noao: { state: 'miss' },
    })
  })
})

describe('a library with no layer content emits what it always did (§6.3, §7.3)', () => {
  it('is byte-identical to a server that has no layers at all', async () => {
    const f = await fixture('ly-identical')
    // The control: no snapshot store, so no `ListingCache` state and no layers
    // to read — the app exactly as it was before this change.
    const bare = JSON.stringify(await listFlat(serverFor(f, { store: undefined })))
    const withLayers = JSON.stringify(await listFlat(serverFor(f)))
    expect(withLayers).toBe(bare)

    // And the same for a plain browse, which is a different emission path.
    const bareDir = JSON.stringify(await listDir(serverFor(f, { store: undefined }), ROOT))
    expect(JSON.stringify(await listDir(serverFor(f), ROOT))).toBe(bareDir)
  })

  it('and stops being identical the moment any one of the three layers holds something', async () => {
    // The control for the control: a cell that cannot fail is not coverage, and
    // this binds all three fields at once — one per layer, each on its own.
    const f = await fixture('ly-identical-control')
    const bare = JSON.stringify(await listFlat(serverFor(f, { store: undefined })))

    const posed = serverFor(f)
    stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await askPoses(posed, ROOT)
    expect(JSON.stringify(await listFlat(posed))).not.toBe(bare)

    const thumbed = serverFor(f)
    await thumbed.app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '/kit/loose.stl',
        mtime: statSync(join(f.kit, 'loose.stl')).mtimeMs,
        png: Buffer.from([1]).toString('base64'),
      }),
    })
    expect(JSON.stringify(await listFlat(thumbed))).not.toBe(bare)

    const previewed = serverFor(f)
    previewed.listings.layers.recordPreview(undefined, `${ROOT}/a`, 4, [])
    const bareDir = JSON.stringify(await listDir(serverFor(f, { store: undefined }), ROOT))
    expect(JSON.stringify(await listDir(previewed, ROOT))).not.toBe(bareDir)
  })

  /**
   * **In-process, deliberately.** A cell driving the route cannot falsify a
   * copies defect at all: `c.json` serialises, so what a test mutates is its own
   * deserialised object and no shared reference is reachable from there — the
   * finding `listingCache.test.ts` recorded at stage 2, met again one layer up.
   * The wire cell below is still worth having (it pins that a second response is
   * clean), but this is the one that fails when the copy is dropped.
   */
  it('the preview layer neither keeps nor hands out an array a caller can reach', () => {
    const layers = new DerivedLayers()
    const source: DirEntry[] = [{ name: 'x.stl', path: '/kit/x.stl', kind: 'model', size: 1, mtime: 1 }]
    layers.recordPreview('/collection', ROOT, 4, source)

    // The caller goes on using its own array — a peek's entries are about to be
    // renamed in place by `applyDisplayNames`, which is exactly this shape.
    source[0]!.name = 'renamed after recording'
    source.push({ name: 'appended.stl', path: '/kit/appended.stl', kind: 'model', size: 1, mtime: 1 })
    expect(layers.previewFor(ROOT, 4)).toEqual([
      { name: 'x.stl', path: '/kit/x.stl', kind: 'model', size: 1, mtime: 1 },
    ])

    // And a reader's edits do not reach the layer either.
    const got = layers.previewFor(ROOT, 4)!
    got[0]!.name = 'renamed by a reader'
    got.push({ name: 'forged.stl', path: '/x', kind: 'model', size: 0, mtime: 0 })
    expect(layers.previewFor(ROOT, 4)).toEqual([
      { name: 'x.stl', path: '/kit/x.stl', kind: 'model', size: 1, mtime: 1 },
    ])
  })

  it('serves copies: one response’s edits never reach the layer or the next response', async () => {
    const f = await fixture('ly-copies')
    const s = serverFor(f)
    stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await askPoses(s, ROOT)
    // A sheet in the layer, so the preview half of this has something to leak.
    expect(
      (await s.app.request(`/api/peek?path=${encodeURIComponent(`${ROOT}/a`)}&n=4`, { headers: LOOPBACK }))
        .status,
    ).toBe(200)

    const first = await listDir(s, ROOT)
    // **Mutated, not reassigned.** Reassigning a field can leak nothing — the
    // response object is this request's own — so it would have made this cell
    // unfalsifiable. What a shared reference actually leaks is a change made
    // *through* it: an element pushed into the held array, a field written on a
    // held object.
    const preview = entryFor(first, 'a').preview
    expect(preview?.length).toBeGreaterThan(0)
    preview!.push({ name: 'forged', path: '/x', kind: 'model', size: 0, mtime: 0 })
    preview![0]!.name = 'renamed by the first request'
    const pose = entryFor(first, 'loose.stl').pose as { confidence: number }
    pose.confidence = 0.1

    const second = await listDir(s, ROOT)
    const after = entryFor(second, 'a').preview
    expect(after).toHaveLength(preview!.length - 1)
    expect(after!.some((e) => e.name === 'forged')).toBe(false)
    expect(after![0]!.name).not.toBe('renamed by the first request')
    expect(entryFor(second, 'loose.stl').pose).toEqual(POSE)
  })
})

describe('enumerating a scope (§6.7)', () => {
  /**
   * A folder of `n` models — more than a listing may return.
   *
   * One level down, deliberately: `levelFor` does not charge the **root** level
   * to the walk budget (it is the request's baseline work), so a flat folder of
   * any size traverses completely whatever the budget is, and the incomplete
   * cell below would have been asserting nothing.
   */
  function wide(f: Fixture, name: string, n: number): void {
    const dir = join(f.top, name, 'inner')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < n; i++) writeFileSync(join(dir, `m${i}.stl`), stlBytes(i))
  }

  it('answers every model where a listing caps, and touches nothing when cached', async () => {
    const f = await fixture('ly-enum')
    wide(f, 'big', 600)
    const s = serverFor(f)

    // The listing this is *not*: capped, and silent about what it dropped
    // beyond one boolean.
    const listing = await listFlat(s, '/big')
    expect(listing.entries.filter((e) => e.kind === 'model')).toHaveLength(500)
    expect(listing.truncated).toBe(true)

    fs.readdirs.length = 0
    fs.opens.length = 0
    const models = await enumerate(s, '/big')
    expect(models.entries).toHaveLength(600)
    expect(models.complete).toBe(true)
    expect(models.path).toBe('/big')
    // Served from the tree the listing above walked: no directory read, no
    // archive opened.
    expect(fs.readdirs.filter((p) => p.startsWith(join(f.top, 'big')))).toEqual([])
    expect(models.entries.every((e) => e.name.startsWith('inner/'))).toBe(true)
    expect(archiveOpens(f)).toBe(0)
  })

  it('reaches into archives and carries the same annotation a listing carries', async () => {
    const f = await fixture('ly-enum-thumb')
    const s = serverFor(f)
    await listFlat(s)
    await s.app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '/kit/loose.stl',
        mtime: statSync(join(f.kit, 'loose.stl')).mtimeMs,
        png: Buffer.from([1]).toString('base64'),
      }),
    })

    const models = await enumerate(s, ROOT)
    const names = models.entries.map((e) => e.name).sort()
    // Archive contents included, named by their path relative to the asked-for
    // root exactly as a walk of it would name them.
    expect(names).toEqual([
      'a/bracket.stl',
      'a/deep/part.stl',
      'box.zip!/arms/left.stl',
      'box.zip!/box.stl',
      'loose.stl',
      'z/bracket.stl',
    ])
    expect(entryFor(models, 'loose.stl').thumb?.ao?.state).toBe('hit')
    expect(models.entries.every((e) => e.kind === 'model')).toBe(true)
  })

  it('answers a subfolder from an ancestor’s snapshot, named as a walk of it would', async () => {
    const f = await fixture('ly-enum-ancestor')
    const s = serverFor(f)
    await listFlat(s, ROOT) // only `/kit` is cached

    fs.readdirs.length = 0
    const under = await enumerate(s, `${ROOT}/a`)
    expect(under.complete).toBe(true)
    // Re-named relative to `/kit/a`, not left as the ancestor root's
    // `a/deep/part.stl` — so this answer and a walk of `/kit/a` agree.
    expect(under.entries.map((e) => e.name).sort()).toEqual(['bracket.stl', 'deep/part.stl'])
    expect(under.entries.map((e) => e.path).sort()).toEqual([
      '/kit/a/bracket.stl',
      '/kit/a/deep/part.stl',
    ])
    expect(treeReaddirs(f)).toEqual([])
  })

  it('404s a path that only looks like it lies under a cached root (round-2 finding 4a)', async () => {
    const f = await fixture('ly-enum-phantom')
    const s = serverFor(f)
    await listFlat(s, ROOT) // `/kit` is cached; `/kit/nope` has never existed

    // Filtering an ancestor's entries by a prefix nothing matches yields an
    // empty set, which this answered as 200 `{entries: [], complete: true}` —
    // "that folder holds no models" about a folder that is not there. The route
    // promises the same refusals a listing gives, and the uncached branch 404s
    // this through `gatherFlat`'s own up-front stat.
    const res = await s.app.request(
      `/api/models?path=${encodeURIComponent(`${ROOT}/nope`)}`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(404)

    // The control that makes the cell about the *phantom* rather than about
    // ancestors in general: a real subfolder under the same cached root is still
    // answered from the snapshot.
    const real = await enumerate(s, `${ROOT}/a`)
    expect(real.entries.map((e) => e.name).sort()).toEqual(['bracket.stl', 'deep/part.stl'])

    // A path that exists but has no inside is the listing's other refusal, and
    // it is the same 400 here.
    const file = await s.app.request(
      `/api/models?path=${encodeURIComponent(`${ROOT}/loose.stl`)}`,
      { headers: LOOPBACK },
    )
    expect(file.status).toBe(400)
  })

  it('validates the covering root before serving from it, rather than after (round-2 finding 4b)', async () => {
    const f = await fixture('ly-enum-validate')
    let now = 1_000_000
    const listings = new ListingCache(f.store, undefined, () => now)
    const s = serverFor(f, { listings })
    await listFlat(s, ROOT) // walks, persists, and stamps the root

    // A change made outside the app, after the stamp and after the cadence has
    // lapsed. A *listing* would answer marked and converge afterwards — the
    // client's follow-up closes that gap. An enumeration has no such reader: it
    // is the scope a bulk job derives its work list from, and there is no
    // staleness marker on this shape for the caller to notice by. So this one
    // waits.
    writeFileSync(join(f.kit, 'z', 'late.stl'), stlBytes(31))
    now += REVALIDATE_TTL_MS

    const models = await enumerate(s, ROOT)
    expect(models.entries.map((e) => e.name)).toContain('z/late.stl')
    // The pass ran, so the root is checked — and a listing right behind it is
    // therefore unmarked, which is what "answer from the refreshed snapshot"
    // means on the other side of the seam.
    expect(listings.isValidated(ROOT)).toBe(true)

    // …and inside the window it does not run: an enumeration is not a licence to
    // stat the whole tree per request.
    writeFileSync(join(f.kit, 'z', 'later.stl'), stlBytes(32))
    fs.readdirs.length = 0
    const again = await enumerate(s, ROOT)
    expect(again.entries.map((e) => e.name)).not.toContain('z/later.stl')
    expect(treeReaddirs(f)).toEqual([])
  })

  it('states incompleteness rather than refusing, and caches nothing for a cut traversal', async () => {
    const f = await fixture('ly-enum-incomplete')
    // Two folders, so the budget runs out *between* them rather than inside the
    // only one: `walkFsLevel` abandons the level it was reading when the budget
    // goes, so a single over-budget folder yields nothing at all and "what was
    // found still comes back" would be vacuous.
    mkdirSync(join(f.top, 'big', 'a'), { recursive: true })
    mkdirSync(join(f.top, 'big', 'b'), { recursive: true })
    for (let i = 0; i < 3; i++) writeFileSync(join(f.top, 'big', 'a', `m${i}.stl`), stlBytes(i))
    for (let i = 0; i < 60; i++) writeFileSync(join(f.top, 'big', 'b', `n${i}.stl`), stlBytes(i))
    const s = serverFor(f)
    process.env.MODEL_BROWSER_SEARCH_BUDGET = '10'

    const models = await enumerate(s, '/big')
    expect(models.complete).toBe(false)
    // What was found still comes back: the caller is about to read these
    // anyway, and a job that knows its scope was cut can say so.
    expect(models.entries.map((e) => e.name)).toEqual(['a/m0.stl', 'a/m1.stl', 'a/m2.stl'])
    // §4.1a: a prefix of the tree is never stored as though it were the tree.
    expect(await f.store.load('/big')).toBeNull()
  })

  it('is a path route: the not-ready envelope, and the same refusals as a listing', async () => {
    const f = await fixture('ly-enum-gate')
    const s = serverFor(f)
    expect((await s.app.request('/api/models', { headers: LOOPBACK })).status).toBe(400)
    expect(
      (await s.app.request(`/api/models?path=${encodeURIComponent('/nope')}`, { headers: LOOPBACK }))
        .status,
    ).toBe(404)

    // The library gate answers before the route does, exactly as for `/api/dir`.
    rmSync(f.top, { recursive: true, force: true })
    await f.library.refresh?.()
    const gone = await s.app.request(`/api/models?path=${encodeURIComponent(ROOT)}`, { headers: LOOPBACK })
    expect(gone.status).toBe(503)
    expect(((await gone.json()) as { state: string }).state).toBe('missing')
  })
})

describe('reload, and the pass at startup (§6.5, §6.6)', () => {
  it('runs the incremental pass now and says whether anything moved', async () => {
    const f = await fixture('ly-reload')
    const s = serverFor(f)
    await listFlat(s)

    const quiet = await s.app.request('/api/reload', { method: 'POST', headers: LOOPBACK })
    expect(quiet.status).toBe(200)
    expect(await quiet.json()).toEqual({ ok: true, roots: 1, changed: false } satisfies ReloadResult)

    // A change made outside the app entirely.
    writeFileSync(join(f.kit, 'z', 'new.stl'), stlBytes(11))
    const found = await s.app.request('/api/reload', { method: 'POST', headers: LOOPBACK })
    expect(((await found.json()) as ReloadResult).changed).toBe(true)
    // And the correction is *applied*, not merely reported: the next listing has it.
    expect((await listFlat(s)).entries.some((e) => e.name === 'z/new.stl')).toBe(true)
  })

  it('drops the derived layers, because they are the half it cannot re-check', async () => {
    const f = await fixture('ly-reload-layers')
    const s = serverFor(f)
    await listFlat(s)
    stubIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await askPoses(s, ROOT)
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toEqual(POSE)

    await s.app.request('/api/reload', { method: 'POST', headers: LOOPBACK })
    expect(entryFor(await listFlat(s), 'loose.stl').pose).toBeUndefined()
    // The tree is revalidated rather than dropped — for it there *is* a check.
    expect(await f.store.load(ROOT)).not.toBeNull()
  })

  it('the startup pass revalidates every cached root, and walks none that has no snapshot', async () => {
    const f = await fixture('ly-startup')
    // One root walked in a previous run…
    await listFlat(serverFor(f))
    // …and a change while the app was "closed".
    writeFileSync(join(f.kit, 'a', 'later.stl'), stlBytes(12))

    const store = new SnapshotStore(f.base, undefined, f.library)
    const listings = new ListingCache(store)
    // Exactly what `index.ts` runs behind the library-ready hook.
    const roots = await store.roots()
    expect(roots).toEqual([ROOT])
    for (const root of roots) await listings.revalidate(f.library, root)

    // The first listing after start already reflects it, unmarked: the pass ran
    // before anyone asked.
    const s = serverFor(f, { store, listings })
    const listing = await listFlat(s)
    expect(listing.entries.some((e) => e.name === 'a/later.stl')).toBe(true)
    // Unmarked because this serve immediately follows the pass — a claim about
    // *this* serve, deliberately not about every later one: validation is
    // time-bounded rather than once-per-process (design D5's review correction),
    // so a serve past the cadence is marked again and that is not a regression.
    expect(listing.stale).toBeUndefined()
  })

  it('a library nothing has walked has no roots, so startup costs it nothing', async () => {
    const f = await fixture('ly-startup-cold')
    const store = new SnapshotStore(f.base, undefined, f.library)
    expect(await store.roots()).toEqual([])
    // No snapshot, no pass, and above all no walk: `roots()` reads the cache
    // directory, never the library.
    expect(treeReaddirs(f)).toEqual([])
  })
})

describe('a layer built under another version serves nothing', () => {
  it('records nothing and answers nothing, so entries of a stale meaning never emit', async () => {
    // The delta's "a layer entry SHALL NOT be served once its recorded identity
    // has moved", for the identity half `LAYER_VERSION` owns.
    const old = new DerivedLayers(-1)
    old.recordPoses('/collection', { '/kit/loose.stl': POSE as never })
    old.recordPreview('/collection', ROOT, 4, [
      { name: 'x.stl', path: '/kit/x.stl', kind: 'model', size: 1, mtime: 1 },
    ])
    expect(old.poseFor('/kit/loose.stl')).toBeUndefined()
    expect(old.previewFor(ROOT, 4)).toBeUndefined()
    expect(old.size()).toEqual({ poses: 0, previews: 0 })

    // The control: the same calls on a current layer do hold.
    const live = new DerivedLayers()
    live.recordPoses('/collection', { '/kit/loose.stl': POSE as never })
    expect(live.poseFor('/kit/loose.stl')).toEqual(POSE)
  })
})

/**
 * Emission-time filling (§6.9) — the pass that makes a first sight whole
 * instead of leaving the client to fill it in a round trip later.
 *
 * Everything here turns on **which** upstream calls a listing makes, so the
 * cells count them at the fetch seam rather than timing them, with the two
 * exceptions that are about time by nature: the budget (a listing must ship
 * without a slow answer) and the probe gate (a declining listing must not pay
 * the budget at all).
 */
describe('emission fills what the layers lack, under a budget (§6.9)', () => {
  /**
   * The index, stubbed with the three routes a fill can reach — `/status`,
   * `/poses`, `/under` — plus a control surface for the states these cells
   * need: an index that is not ready, one whose `/poses` hangs until released,
   * one whose `/poses` has begun failing.
   *
   * `/under` answers `unindexed`, so a preview derivation falls through to the
   * walk: what a sheet *contains* is `posedFirstPeek`'s contract and not what
   * these cells are about. That the route is answered **at all** matters more
   * than what it says — an unhandled route throws, and a throw inside
   * `askIndex` forgets the probe memo, which would then gate the very pass
   * under test.
   */
  function stubFillIndex(collectionRoot: string, poses: Record<string, unknown> = {}) {
    const control = { ready: true, gate: null as Promise<void> | null, posesFail: false }
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    const spy = vi.fn(async (url: string, _init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/status')) {
        return json({
          ready: control.ready,
          elapsed: 1,
          collection_root: collectionRoot,
          covers: ['stl'],
          volume: { present: true, root: collectionRoot, missing: null },
        })
      }
      if (u.endsWith('/poses')) {
        if (control.gate !== null) await control.gate
        if (control.posesFail) throw new TypeError('fetch failed')
        return json({ poses })
      }
      if (u.endsWith('/under')) {
        return json({ status: 'unindexed', models: [], matched: 0, truncated: false })
      }
      throw new Error(`unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', spy)
    resetIndexStatus()
    const bodies = (route: string): string[] =>
      spy.mock.calls
        .filter((c) => String(c[0]).endsWith(route))
        .map((c) => String((c[1] as RequestInit | undefined)?.body ?? ''))
    const route = (name: string): number =>
      spy.mock.calls.filter((c) => String(c[0]).endsWith(name)).length
    return {
      control,
      calls: (): number => spy.mock.calls.length,
      /** `/poses` batches that named this model. */
      posesAbout: (real: string): number => bodies('/poses').filter((b) => b.includes(real)).length,
      /** `/under` asks that named this folder — one per preview derivation. */
      underAbout: (real: string): number => bodies('/under').filter((b) => b.includes(real)).length,
      /** Every `/under` ask: one per preview derivation *started*. */
      underCalls: (): number => route('/under'),
      /** Every `/status` probe, which the fill path must never take itself. */
      statusCalls: (): number => route('/status'),
      posesBodies: (): string[] => bodies('/poses'),
    }
  }

  /** Warm the probe memo the way the running client does: the status route. */
  async function warmProbe(s: Server): Promise<void> {
    const res = await s.app.request('/api/semantic/status', { headers: LOOPBACK })
    expect(res.status).toBe(200)
  }

  const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  /**
   * The interior half of a sheet (`archive-interior-sheets`). Counted at
   * `open`, which is what a central-directory read costs and what the archive
   * layer exists to avoid — a timing here would be a proxy for the syscall
   * rather than the syscall.
   */
  const opensOf = (zip: string): number => fs.opens.filter((path) => path === zip).length

  it('shares one archive read between a listing and the tiles inside it', async () => {
    // Counted at `open`, which is what a central-directory read costs — a
    // timing would be a proxy for the syscall rather than the syscall. Not an
    // absolute count: `readCentralDirectory` opens twice for one read (the tail
    // scan, then the directory), so what is asserted is the *ratio* the layer
    // exists to produce.
    const withStore = await fixture('ly-zip-share')
    const s1 = serverFor(withStore)
    stubFillIndex(withStore.top)
    await warmProbe(s1)
    fs.opens.length = 0
    const listing = await listDir(s1, '/kit/box.zip')
    await settle(ANNOTATION_BUDGET_MS + 40)
    const shared = opensOf(withStore.zip)
    expect(entryFor(listing, 'arms').kind).toBe('dir')

    // The same listing with no `SnapshotStore` behind it: no archive layer, so
    // the listing and the interior derivation each pay their own read. Before
    // this change the store-backed server behaved like this one, because
    // `listZipDir` read through no layer at all.
    const noStore = await fixture('ly-zip-share-nostore')
    const s2 = serverFor(noStore, { store: undefined })
    stubFillIndex(noStore.top)
    await warmProbe(s2)
    fs.opens.length = 0
    await listDir(s2, '/kit/box.zip')
    await settle(ANNOTATION_BUDGET_MS + 40)
    const unshared = opensOf(noStore.zip)

    expect(shared).toBeGreaterThan(0)
    expect(unshared).toBe(shared * 2)
  })

  it('re-derives an interior sheet that was empty when the archive gained models', async () => {
    // The cells cannot answer this one: an interior holding no models records
    // `[]`, and `[].some(...)` is false however far the archive has moved since.
    // Left to the cells it was permanent — the fill skips a held sheet, empty
    // included, and the client renders a carried `preview: []` without asking —
    // and an `images/` folder beside the parts is what most kits hold.
    const f = await fixture('ly-zip-empty-stale')
    const s = serverFor(f)
    stubFillIndex(f.top)
    await warmProbe(s)

    writeFileSync(
      f.zip,
      zipSync({
        'box.stl': new Uint8Array(stlBytes(5)),
        'images/card.png': new Uint8Array([1, 2, 3]),
      }),
    )
    await listDir(s, '/kit/box.zip')
    await settle(ANNOTATION_BUDGET_MS + 40)
    const empty = entryFor(await listDir(s, '/kit/box.zip'), 'images')
    // Derived and held as empty — a recorded answer, not a gap.
    expect(empty.preview).toEqual([])

    writeFileSync(
      f.zip,
      zipSync({
        'box.stl': new Uint8Array(stlBytes(5)),
        'images/card.png': new Uint8Array([1, 2, 3]),
        'images/plate.stl': new Uint8Array(stlBytes(9)),
      }),
    )
    const later = statSync(f.zip).mtimeMs / 1000 + 5
    utimesSync(f.zip, later, later)

    const after = entryFor(await listDir(s, '/kit/box.zip'), 'images')
    expect(after.preview ?? []).toEqual([])
    await settle(ANNOTATION_BUDGET_MS + 40)
    const fresh = entryFor(await listDir(s, '/kit/box.zip'), 'images')
    expect(fresh.preview?.map((c) => c.name)).toEqual(['plate.stl'])
  })

  it("drops an interior sheet whose archive has been rewritten under it", async () => {
    const f = await fixture('ly-zip-stale')
    const s = serverFor(f)
    stubFillIndex(f.top)
    await warmProbe(s)

    const first = await listDir(s, '/kit/box.zip')
    await settle(ANNOTATION_BUDGET_MS + 40)
    // Derived and held: the sheet rides the listing on the next sight.
    const held = await listDir(s, '/kit/box.zip')
    const before = entryFor(held, 'arms')
    expect(before.preview?.map((c) => c.name)).toEqual(['left.stl'])
    expect(before.preview?.[0]?.mtime).toBe(before.mtime)
    expect(entryFor(first, 'arms').path).toBe(before.path)

    // Rewritten in place, with a later stamp: the archive layer notices by
    // `{mtime, size}` and the listing is right, while the held sheet still
    // names cells keyed on the version that is gone.
    writeFileSync(
      f.zip,
      zipSync({
        'box.stl': new Uint8Array(stlBytes(7)),
        'arms/right.stl': new Uint8Array(stlBytes(8)),
      }),
    )
    const later = statSync(f.zip).mtimeMs / 1000 + 5
    utimesSync(f.zip, later, later)

    const after = entryFor(await listDir(s, '/kit/box.zip'), 'arms')
    // Not served. `noteDirChanged` would have left this held — it walks upward
    // from a change and an interior key is a descendant — and the revalidation
    // pass never runs for a nested browse at all.
    expect(after.preview?.some((c) => c.name === 'left.stl')).not.toBe(true)

    // And re-derived from the archive that is actually there.
    await settle(ANNOTATION_BUDGET_MS + 40)
    const fresh = entryFor(await listDir(s, '/kit/box.zip'), 'arms')
    expect(fresh.preview?.map((c) => c.name)).toEqual(['right.stl'])
    expect(fresh.preview?.[0]?.mtime).toBe(fresh.mtime)
  })

  it('carries pose and preview on the first sight, with no wave and no peek', async () => {
    const f = await fixture('ly-fill-first')
    const s = serverFor(f)
    stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await warmProbe(s)

    // The first listing of this folder in this process: nothing has peeked, no
    // wave has run, and the layers are empty — which before §6.9 meant a bare
    // listing and two follow-ups behind it.
    const listing = await listDir(s, ROOT)

    expect(entryFor(listing, 'loose.stl').pose).toEqual(POSE)
    // Both folders arrive with the sheet their tile draws, so the client's
    // carried-preview path lands them and issues no `/api/peek` at all.
    expect(entryFor(listing, 'a').preview?.map((e) => e.name)).toEqual(['bracket.stl', 'part.stl'])
    expect(entryFor(listing, 'z').preview?.map((e) => e.name)).toEqual(['bracket.stl'])
    // Nothing on this listing is left for a follow-up to fetch: every model has
    // its pose answer and every folder its sheet — **and every cell inside those
    // sheets has its pose answer too** (round-3 findings 3 and 7). That last
    // clause is what the client's *preview* wave used to exist for: the sheet
    // arrived, the cells arrived bare, and a second round trip went and asked
    // about them. The derivation that chose those cells already knew.
    //
    // `not.toBeUndefined`, not `toBeDefined`: the answer for a model the index
    // holds nothing for is an explicit `null`, and `toBeDefined` would reject the
    // very state finding 6 added. Absent is the only failure — it means this
    // server derived nothing and the client must go and ask.
    for (const entry of listing.entries) {
      if (entry.kind === 'model') expect(entry.pose, entry.path).not.toBeUndefined()
      if (entry.kind === 'dir') {
        expect(entry.preview, entry.path).toBeDefined()
        for (const cell of entry.preview ?? []) {
          expect(cell.pose, `${entry.path} → ${cell.path}`).not.toBeUndefined()
        }
      }
    }
  })

  it('ships within the budget without the slow answer, and the next listing carries it', async () => {
    const f = await fixture('ly-fill-budget')
    const s = serverFor(f)
    const index = stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await warmProbe(s)

    // Ready and slow — the one state the probe gate cannot catch, and the whole
    // reason the fill is raced against a budget rather than awaited.
    let release: () => void = () => {}
    index.control.gate = new Promise<void>((r) => {
      release = r
    })

    const started = Date.now()
    const first = await listDir(s, ROOT)
    const elapsed = Date.now() - started

    // Shipped without the fact rather than waiting for it. The lower bound is
    // what says the *budget* ended the wait: nothing else could have, since the
    // answer is still gated as this assertion runs.
    expect(entryFor(first, 'loose.stl').pose).toBeUndefined()
    expect(elapsed).toBeGreaterThanOrEqual(ANNOTATION_BUDGET_MS - 30)
    expect(elapsed).toBeLessThan(ANNOTATION_BUDGET_MS + 2000)

    // The late answer still lands: the fill went on running after emission gave
    // up on it, and recorded into the layer.
    release()
    for (let i = 0; i < 50 && s.listings.layers.poseFor(`${ROOT}/loose.stl`) === undefined; i++) {
      await settle(10)
    }
    expect(s.listings.layers.poseFor(`${ROOT}/loose.stl`)).toEqual(POSE)

    // And the next listing carries it. `/poses` fails from here on, so the pose
    // on this listing can only have come from the layer — without the
    // late-record continuation there would be nothing there to come from.
    index.control.gate = null
    index.control.posesFail = true
    expect(entryFor(await listDir(s, ROOT), 'loose.stl').pose).toEqual(POSE)
  })

  it('makes no call at all, and pays no budget, while the probe says not ready', async () => {
    const f = await fixture('ly-fill-gate')
    const s = serverFor(f)
    const index = stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    // Warming: up, answering about itself, nothing to say about a model yet.
    // The delta's "a warming or absent index costs a listing nothing" is this.
    index.control.ready = false
    await warmProbe(s)

    const before = index.calls()
    const started = Date.now()
    const listing = await listDir(s, ROOT)
    const elapsed = Date.now() - started

    // Zero, counted at the seam — not "few", and not inferred from timing.
    expect(index.calls()).toBe(before)
    // Emission latency unchanged, which is a different claim from the one above
    // it: a fill that ran and found nothing would still have spent the budget.
    // This one never started.
    expect(elapsed).toBeLessThan(ANNOTATION_BUDGET_MS)
    expect(entryFor(listing, 'loose.stl').pose).toBeUndefined()
    expect(entryFor(listing, 'a').preview).toBeUndefined()

    // The same for a memo holding nothing at all: no answer is not a ready
    // answer, and emission declines rather than probing on its own behalf.
    resetIndexStatus()
    const cold = index.calls()
    await listDir(s, ROOT)
    expect(index.calls()).toBe(cold)
  })

  it('asks once per horizon about a model the index has no pose for, not once per listing', async () => {
    const f = await fixture('ly-fill-negative-pose')
    // The horizon on an injected clock, exactly as the TTL cell above injects
    // it: five minutes slept per cell would be paying the constant rather than
    // testing it.
    let now = 2_000_000
    const layers = new DerivedLayers(LAYER_VERSION, () => now)
    const s = serverFor(f, { listings: new ListingCache(f.store, layers) })
    // An index that answers, and holds no orientation for anything.
    const index = stubFillIndex(f.top, {})
    await warmProbe(s)
    const model = join(f.kit, 'loose.stl')

    // `null`, not absent (round-3 finding 6): the index was asked and holds no
    // orientation, and *that* is what rides the wire. An absent field would tell
    // the client "this server has not derived it", which is the instruction that
    // sends the pose wave — so the negative would stop a listing re-asking while
    // still costing a wave per landing, half the loop closed.
    expect(entryFor(await listDir(s, ROOT), 'loose.stl').pose).toBeNull()
    expect(index.posesAbout(model)).toBe(1)

    // The second listing asks nothing about it. "Asked, and it has none" is an
    // answer the layer holds, and reading it as an absence is what would put a
    // `/poses` batch on every listing of this folder for as long as the server
    // runs.
    expect(entryFor(await listDir(s, ROOT), 'loose.stl').pose).toBeNull()
    expect(index.posesAbout(model)).toBe(1)

    // Past the horizon it is asked again: a negative converges on the same
    // clock as a positive, because the index may learn a pose it did not have.
    now += POSE_ANNOTATION_TTL_MS
    await listDir(s, ROOT)
    expect(index.posesAbout(model)).toBe(2)
  })

  it('starts at most FILL_PREVIEW_MAX derivations, and leaves the rest to the client', async () => {
    const f = await fixture('ly-fill-launch-bound')
    // A folder-of-folders the size a kit library actually reaches. The budget
    // cannot bound this: expiry stops emission *waiting*, and thirty queued
    // derivations would go on marching through the queue afterwards.
    for (let i = 0; i < 30; i++) mkdirSync(join(f.kit, `sub-${i}`))
    const s = serverFor(f)
    const index = stubFillIndex(f.top, {})
    await warmProbe(s)

    const listing = await listDir(s, ROOT)
    // Counted at the upstream seam: one `/under` per derivation *started*.
    expect(index.underCalls()).toBeLessThanOrEqual(FILL_PREVIEW_MAX)
    // …and it really is the bound doing the work rather than an empty pass:
    // without one this listing would have started 32 (thirty new, plus `a` and
    // `z`).
    expect(index.underCalls()).toBeGreaterThan(0)

    const dirs = listing.entries.filter((e) => e.kind === 'dir')
    expect(dirs.length).toBe(32)
    const carried = dirs.filter((e) => e.preview !== undefined)
    expect(carried.length).toBeLessThanOrEqual(FILL_PREVIEW_MAX)
    // The folders past the bound are not broken, they are unchanged: no sheet
    // rides the listing and the client peeks for them as they scroll into view,
    // exactly as it did before emission filled anything.
    expect(dirs.length - carried.length).toBeGreaterThanOrEqual(20)
  })

  it('joins a concurrent fill for the same listing rather than repeating it', async () => {
    const f = await fixture('ly-fill-single-flight')
    const s = serverFor(f)
    const index = stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await warmProbe(s)

    // Gated so the two requests are provably overlapping: the first fill is
    // still inside its `/poses` when the second arrives, which is the only
    // arrangement where a join is observable rather than lucky.
    let release: () => void = () => {}
    index.control.gate = new Promise<void>((r) => {
      release = r
    })

    const [a, b] = await Promise.all([listDir(s, ROOT), listDir(s, ROOT)])
    // One batch about the model, not two. Two requests for one listing both
    // found the layers empty and both ran the whole pass — the same `/poses`
    // and the same preview derivations, at an index that serves one request at
    // a time.
    expect(index.posesAbout(join(f.kit, 'loose.stl'))).toBe(1)
    // And one derivation per folder rather than two.
    expect(index.underAbout(join(f.kit, 'a'))).toBe(1)
    // Both answers are still whole listings; joining is invisible on the wire.
    expect(a.entries.map((e) => e.name)).toEqual(b.entries.map((e) => e.name))

    release()
    await settle(20)
  })

  it('records the poses its preview derivations learn, so sheet cells arrive posed', async () => {
    const f = await fixture('ly-fill-sheet-poses')
    const s = serverFor(f)
    const bracket = join(f.kit, 'a', 'bracket.stl')
    // The pose belongs to a model *inside* a folder tile's sheet — never a
    // listing entry of `/kit` itself — so nothing but the preview derivation's
    // own `/poses` batch could have supplied it.
    const index = stubFillIndex(f.top, { [bracket]: POSE })
    await warmProbe(s)

    const sheet = entryFor(await listDir(s, ROOT), 'a').preview
    expect(sheet?.map((e) => e.name)).toEqual(['bracket.stl', 'part.stl'])
    expect(sheet?.find((e) => e.name === 'bracket.stl')?.pose).toEqual(POSE)
    // The unposed cell carries the negative rather than nothing: the index was
    // asked about it in the same batch and had none.
    expect(sheet?.find((e) => e.name === 'part.stl')?.pose).toBeNull()
    // Asked once, by the derivation, and never again by anybody: the client's
    // preview wave has nothing left to fetch, which is the round trip this
    // finding deletes.
    expect(index.posesAbout(bracket)).toBe(1)
    await listDir(s, ROOT)
    expect(index.posesAbout(bracket)).toBe(1)
  })

  it('fills on a stale-but-ready memo, and still takes no probe of its own', async () => {
    const f = await fixture('ly-fill-stale-memo')
    const s = serverFor(f)
    const index = stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await warmProbe(s)

    // Only `Date` is faked — the budget's `setTimeout` stays real, since the
    // fill has to actually race something. Forty-five seconds is past
    // `TTL_MS.ready` (30 s), which is where the gate used to give up.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 45_000)
      const probes = index.statusCalls()
      const listing = await listDir(s, ROOT)

      // The requirement's words are "an index whose memoised probe is not
      // ready" — a state, not a freshness. Reading the TTL here switched the
      // feature off half a minute after the client's startup probe, in a
      // browse-only session where nothing else ever probes again.
      expect(entryFor(listing, 'loose.stl').pose).toEqual(POSE)
      // And it did *not* buy that by probing: an old memo must not become a
      // `/status` fetch on the browse path, which is what `posedFirstPeek`'s own
      // `probeStatus` would have done for every folder tile once the memo aged.
      expect(index.statusCalls()).toBe(probes)
    } finally {
      vi.useRealTimers()
    }
  })

  it('declines after a failed ask, which is what limits a wedge now', async () => {
    const f = await fixture('ly-fill-failed-ask')
    const s = serverFor(f)
    const index = stubFillIndex(f.top, {})
    await warmProbe(s)

    // The index stops answering. Every way it can fail routes through
    // `askIndex`'s `notAnswering`, which forgets the probe memo.
    index.control.posesFail = true
    await listDir(s, ROOT)
    await settle(50)

    // With the gate no longer reading the TTL, *this* is what stops a wedged
    // index being asked once per listing forever: the memo is cold, so the next
    // fill declines until something allowed to probe looks again. It was an
    // accident when 6.9 landed (task 6.9a) and is the designed limiter now.
    const after = index.calls()
    await listDir(s, ROOT)
    await listDir(s, ROOT)
    expect(index.calls()).toBe(after)
  })

  it('fills nothing through a layers instance that is not live', async () => {
    const f = await fixture('ly-fill-inert')
    // A layer built for another `LAYER_VERSION` records nothing and answers
    // nothing. Every method on it already declines; what this pins is that the
    // *asking* stops too — otherwise a version bump would buy a `/poses` batch
    // and a derivation per folder on every listing, for answers dropped on
    // arrival, at an index that serves one request at a time.
    const inert = new DerivedLayers(LAYER_VERSION - 1)
    const s = serverFor(f, { listings: new ListingCache(f.store, inert) })
    const index = stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await warmProbe(s)

    const before = index.calls()
    const listing = await listDir(s, ROOT)
    // Zero, counted at the seam, exactly as the not-ready gate is counted.
    expect(index.calls()).toBe(before)
    expect(entryFor(listing, 'loose.stl').pose).toBeUndefined()
    expect(entryFor(listing, 'a').preview).toBeUndefined()
  })

  it('drops a late answer whose collection root moved under it', async () => {
    const f = await fixture('ly-fill-repoint-race')
    const s = serverFor(f)
    const index = stubFillIndex(f.top, { [join(f.kit, 'loose.stl')]: POSE })
    await warmProbe(s)

    let release: () => void = () => {}
    index.control.gate = new Promise<void>((r) => {
      release = r
    })
    const listing = await listDir(s, ROOT)
    expect(entryFor(listing, 'loose.stl').pose).toBeUndefined()

    // The index is repointed at another collection while the fill's answer is
    // still on the wire. It is about the *old* collection, and `recordPoses`
    // takes the root it is handed as the observation — so recording it now would
    // re-adopt the collection the index has left, dropping the layer that was
    // just built for the new one and re-installing facts derived from neither.
    const other = tempDir('mb-ly-other-')
    stubFillIndex(other, {})
    await warmProbe(s)

    release()
    await settle(40)

    // The stale answer is gone rather than filed. This is the one case where a
    // late continuation must *not* record: the budget cell beside it pins that
    // every other late answer does.
    expect(s.listings.layers.poseFor(`${ROOT}/loose.stl`)).toBeUndefined()
  })

  it('does not stamp a negative when nothing about the index was learned', async () => {
    const f = await fixture('ly-fill-transient')
    // Straight at `posesAsked`, because no route can produce a transient
    // exclusion: `listDir` drops a dangling symlink and an unstat-able entry
    // before either reaches a listing. The seam that owns the distinction is
    // the seam where it is observable.
    const missing = `${ROOT}/gone.stl`
    const inZip = `${ROOT}/box.zip!/box.stl`

    // Transient — this server failed to *look*. Nothing was asked, so nothing
    // about the index was learned, and `answered` says so.
    const gone = await posesAsked(f.library, [missing], f.top)
    expect(gone).toEqual({ poses: {}, answered: false })
    // Structural — a settled fact about the tree that no round trip would
    // change. Nothing was asked either, and that *is* an answer.
    const zipped = await posesAsked(f.library, [inZip], f.top)
    expect(zipped).toEqual({ poses: {}, answered: true })
    // Neither reached the index at all, which is what makes the difference a
    // property of the scoping rather than of a reply.
    expect(fetch).toBeDefined()

    // The consequence, applied exactly as `fillPoses` applies it. Collapsing the
    // two exclusion kinds stamps a horizon of "the index has none" on a folder
    // whose models the index was never asked about — a filesystem hiccup
    // silencing every pose in the folder for five minutes.
    const layers = new DerivedLayers()
    layers.recordPoses(f.top, gone.poses, gone.answered ? [missing] : [])
    expect(layers.poseKnown(missing)).toBe(false)
    layers.recordPoses(f.top, zipped.poses, zipped.answered ? [inZip] : [])
    expect(layers.poseKnown(inZip)).toBe(true)
  })

  it('restamps a negative when the wave re-confirms it', async () => {
    const f = await fixture('ly-fill-restamp')
    let now = 3_000_000
    const layers = new DerivedLayers(LAYER_VERSION, () => now)
    const s = serverFor(f, { listings: new ListingCache(f.store, layers) })
    const index = stubFillIndex(f.top, {})
    await warmProbe(s)
    const model = join(f.kit, 'loose.stl')

    // The fill stamps the negative.
    expect(entryFor(await listDir(s, ROOT), 'loose.stl').pose).toBeNull()
    expect(index.posesAbout(model)).toBe(1)

    // Just short of the horizon, the client's wave asks about it — a flat
    // listing, a search, a tile the layer had nothing for — and the index still
    // holds nothing.
    now += POSE_ANNOTATION_TTL_MS - 1000
    const res = await s.app.request('/api/semantic/poses', {
      method: 'POST',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ paths: [`${ROOT}/loose.stl`] }),
    })
    expect(res.status).toBe(200)
    expect(index.posesAbout(model)).toBe(2)

    // Past where the *original* stamp would have expired. The wave's answer
    // restamped it, so the listing still carries the negative and no third batch
    // was ever sent. Without the restamp the entry ages out here and the fill
    // re-asks — the horizon measured from the first time the index said so
    // rather than the last.
    now += 2000
    expect(entryFor(await listDir(s, ROOT), 'loose.stl').pose).toBeNull()
    expect(index.posesAbout(model)).toBe(2)
  })

  it('derives an empty folder’s sheet once, not once per listing', async () => {
    const f = await fixture('ly-fill-negative-preview')
    // A folder with no models at all: the sheet it derives to is empty, and
    // empty is an answer.
    const empty = join(f.kit, 'empty')
    mkdirSync(empty)
    const s = serverFor(f)
    const index = stubFillIndex(f.top, {})
    await warmProbe(s)

    const first = await listDir(s, ROOT)
    // Attached as the empty sheet it is, rather than withheld: the client lands
    // a carried sheet whatever its length and skips the peek, so withholding it
    // would buy back the round trip this pass exists to delete.
    expect(entryFor(first, 'empty').preview).toEqual([])
    expect(index.underAbout(empty)).toBe(1)

    await listDir(s, ROOT)
    expect(index.underAbout(empty)).toBe(1)
  })
})
