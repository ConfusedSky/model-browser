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
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { DerivedLayers, LAYER_VERSION, POSE_ANNOTATION_TTL_MS } from '../src/layers'
import type { Library } from '../src/library'
import { ListingCache, REVALIDATE_TTL_MS } from '../src/listingCache'
import { resetIndexStatus } from '../src/semantic'
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
    // The whole of "emission never blocks on the index": the listing that
    // carries the pose made no call of its own to carry it.
    expect(index.mock.calls.length).toBe(asked)
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
    expect(entryFor(listing, 'loose.stl').pose).toBeUndefined()
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
