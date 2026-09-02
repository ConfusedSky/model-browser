import { chmodSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import { ALL_FEATURES, createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import type { Library } from '../src/library'
import { walkFlat } from '../src/listing'
import { ListingCache } from '../src/listingCache'
import { SnapshotStore } from '../src/snapshot'
import { listZipEntries } from '../src/zip'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * The instrumentation §7.1 asks for by name: "instrument the walk, do not infer
 * from timing". A cached tree serving a second query is a claim about syscalls
 * — no directory read, no archive opened — so both are counted at the syscall.
 *
 * `vi.spyOn` on an ESM namespace throws ("Module namespace is not
 * configurable"), so the whole module is mocked and the two calls wrapped;
 * `snapshot.test.ts` documents the same shape.
 *
 * `failReaddir` stands in for a walk that rejects partway. `search-cancellation`
 * has not landed, so there is no `WalkCancelled` to throw from inside the walk
 * yet; an unreadable root is the failure that does escape `walkFlat` today, and
 * it reaches the same question — does a rejected traversal leave anything
 * behind?
 */
const fs = vi.hoisted(() => ({
  readdirs: [] as string[],
  opens: [] as string[],
  failReaddir: null as string | null,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      const path = String(args[0])
      fs.readdirs.push(path)
      if (fs.failReaddir !== null && path === fs.failReaddir) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
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
  delete process.env.MODEL_BROWSER_FLAT_BUDGET
  delete process.env.MODEL_BROWSER_FOLDER_CAP
})

beforeEach(() => {
  fs.readdirs.length = 0
  fs.opens.length = 0
  fs.failReaddir = null
})

function tempDir(prefix: string): string {
  const dir = realTempDir(prefix)
  cleanups.push(dir)
  return dir
}

interface Fixture {
  /** The library top. */
  top: string
  /** The walked root, on disk. */
  kit: string
  /** The one archive in the tree. */
  zip: string
  library: Library
  store: SnapshotStore
  /** The cache root, so a second store over the same directory is a "restart". */
  base: string
}

/**
 * One library with one walked root under it.
 *
 * ```
 * top/.model-browser/library.json
 * top/kit/loose.stl  a/bracket.stl  a/deep/part.stl  z/bracket.stl
 *        box.zip { box.stl, arms/left.stl }
 * ```
 *
 * Built per test rather than once: half the cells below mutate the tree, and a
 * shared fixture would make the add/remove/rename cells order-dependent.
 */
async function fixture(id: string): Promise<Fixture> {
  const top = join(tempDir('mb-lc-'), 'top')
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
    zipSync({
      'box.stl': new Uint8Array(stlBytes(5)),
      'arms/left.stl': new Uint8Array(stlBytes(6)),
    }),
  )
  const base = tempDir('mb-lc-cache-')
  const library = libraryFor(top)
  // `walkFlat` resolves through the library rather than through a route, so the
  // library has to have settled first — `flat.test.ts` documents the same.
  await library.state()
  return { top, kit, zip, library, store: new SnapshotStore(base, undefined, library), base }
}

const ROOT = '/kit'

/** `readdir`s of the walked tree only — the library's own probe is not the walk. */
function treeReaddirs(f: Fixture): string[] {
  return fs.readdirs.filter((p) => p === f.kit || p.startsWith(`${f.kit}/`))
}

function archiveOpens(f: Fixture): number {
  return fs.opens.filter((p) => p === f.zip).length
}

/** Everything a listing puts on the wire, for an entry-for-entry comparison. */
function shape(listing: DirListing): unknown {
  return { path: listing.path, truncated: listing.truncated, entries: listing.entries }
}

describe('serving a flat listing from the snapshot', () => {
  it('answers a cached tree entry-for-entry as the walk would, ordering included', async () => {
    const f = await fixture('lc-identity')
    // The control: the same walk with no store behind it at all.
    const walked = await walkFlat(f.library, ROOT)
    expect(walked.fromSnapshot).toBe(false)

    // Cold: walks, and persists because the traversal saw the whole tree.
    const cold = await walkFlat(f.library, ROOT, undefined, {}, f.store)
    expect(cold.fromSnapshot).toBe(false)

    fs.readdirs.length = 0
    fs.opens.length = 0
    const cached = await walkFlat(f.library, ROOT, undefined, {}, f.store)

    expect(cached.fromSnapshot).toBe(true)
    expect(shape(cached.listing)).toEqual(shape(walked.listing))
    // And it is a *cached* answer, not a quietly repeated walk.
    expect(treeReaddirs(f)).toEqual([])
    expect(archiveOpens(f)).toBe(0)
  })

  it('reports truncation the same way from the cache as from the walk', async () => {
    const f = await fixture('lc-truncation')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)

    // A cap the answer trips, applied to both sides equally: the tree was
    // walked in full either way, and the response is short either way.
    process.env.MODEL_BROWSER_FLAT_CAP = '2'
    const walked = await walkFlat(f.library, ROOT)
    const cached = await walkFlat(f.library, ROOT, undefined, {}, f.store)

    expect(cached.fromSnapshot).toBe(true)
    expect(walked.listing.truncated).toBe(true)
    expect(shape(cached.listing)).toEqual(shape(walked.listing))
    // The wire bit is the OR; inside, the cached answer knows the walk was not
    // the thing that was cut.
    expect([cached.budgetExhausted, cached.capped]).toEqual([false, true])
  })

  it('serves every query and both folder-matching settings off one tree, untraversed', async () => {
    const f = await fixture('lc-one-tree')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)

    const asks: { q?: string; folderMatching?: boolean }[] = [
      {},
      { q: 'bracket' },
      { q: 'deep' },
      { q: 'a' },
      { q: 'left' },
      { q: 'box' },
      // The option the delta names explicitly: a toggle re-filters, it does not
      // re-walk. Both settings, so neither is the one that happens to be cached.
      { q: 'deep', folderMatching: true },
      { q: 'deep', folderMatching: false },
      { q: 'a', folderMatching: false },
    ]
    // What each ask means with no cache in the way — the answers the cached
    // ones have to match. Taken first, so the walks below cannot be confused
    // with the cache's own traversals.
    const expected = []
    for (const ask of asks) {
      expected.push(
        shape((await walkFlat(f.library, ROOT, ask.q, { folderMatching: ask.folderMatching })).listing),
      )
    }

    fs.readdirs.length = 0
    fs.opens.length = 0
    const got = []
    for (const ask of asks) {
      const r = await walkFlat(f.library, ROOT, ask.q, { folderMatching: ask.folderMatching }, f.store)
      expect(r.fromSnapshot).toBe(true)
      got.push(shape(r.listing))
    }

    expect(got).toEqual(expected)
    // Nine answers, one tree, no traversal: the whole of D1 on one line.
    expect(treeReaddirs(f)).toEqual([])
    expect(archiveOpens(f)).toBe(0)
  })

  it('serves copies, so per-request annotation never reaches the stored tree', async () => {
    const f = await fixture('lc-copies')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const first = await walkFlat(f.library, ROOT, undefined, {}, f.store)
    // The `applyDisplayNames` shape: emitted entries are annotated in place and
    // the annotation is never cleared.
    for (const e of first.listing.entries) e.displayName = 'renamed by the first request'

    const second = await walkFlat(f.library, ROOT, undefined, {}, f.store)
    expect(second.listing.entries.every((e) => e.displayName === undefined)).toBe(true)
    // And on disk, which is what survives a repoint.
    const stored = await f.store.load(ROOT)
    expect(stored?.entries.every((e) => !('displayName' in e))).toBe(true)
  })
})

describe('what may be persisted (§4.1a)', () => {
  it('persists nothing for a walk the step budget stopped, and the next request traverses', async () => {
    const f = await fixture('lc-budget')
    process.env.MODEL_BROWSER_FLAT_BUDGET = '3'
    const stopped = await walkFlat(f.library, ROOT, undefined, {}, f.store)
    expect(stopped.budgetExhausted).toBe(true)
    // A prefix of the tree stored as though whole would be permanently wrong.
    expect(await f.store.load(ROOT)).toBeNull()

    delete process.env.MODEL_BROWSER_FLAT_BUDGET
    fs.readdirs.length = 0
    const next = await walkFlat(f.library, ROOT, undefined, {}, f.store)
    expect(next.fromSnapshot).toBe(false)
    expect(treeReaddirs(f).length).toBeGreaterThan(0)
    // …and *that* walk, having finished, is cacheable.
    expect(await f.store.load(ROOT)).not.toBeNull()
  })

  it('persists a walk the response cap shortened — the tree was seen in full', async () => {
    const f = await fixture('lc-capped')
    // The distinction the wire cannot draw: `truncated` is the OR of budget
    // exhaustion and the response caps, so a rule written against it would
    // refuse to cache a folder walked end to end whose entries the cap merely
    // dropped from the answer — forever.
    process.env.MODEL_BROWSER_FLAT_CAP = '1'
    const capped = await walkFlat(f.library, ROOT, undefined, {}, f.store)
    expect([capped.budgetExhausted, capped.capped]).toEqual([false, true])
    expect(capped.listing.truncated).toBe(true)

    const stored = await f.store.load(ROOT)
    expect(stored).not.toBeNull()
    // The whole tree, not the one entry the cap left on the wire.
    expect(stored!.entries.filter((e) => e.kind === 'model').length).toBeGreaterThan(1)
  })

  it('persists nothing when the walk rejects, and flushes nothing either', async () => {
    const f = await fixture('lc-reject')
    // The archive layer is populated in memory first, so "nothing was flushed"
    // is a claim with something behind it.
    await listZipEntries(f.zip, f.store.archiveCache())

    fs.failReaddir = f.kit
    await expect(walkFlat(f.library, ROOT, undefined, {}, f.store)).rejects.toThrow(
      'cannot read directory',
    )
    fs.failReaddir = null

    // Nothing was saved — and `save` is the only thing that flushes, so a later
    // process finds no archive layer either and opens the archive again.
    const later = new SnapshotStore(f.base, undefined, libraryFor(f.top))
    expect(await later.load(ROOT)).toBeNull()
    fs.opens.length = 0
    await listZipEntries(f.zip, later.archiveCache())
    expect(archiveOpens(f)).toBeGreaterThan(0)
  })
})

describe('incremental revalidation (§4.2)', () => {
  /** Populate, then hand back a cache that has not yet checked the disk. */
  async function primed(f: Fixture): Promise<ListingCache> {
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    return new ListingCache(f.store)
  }

  async function names(f: Fixture, cache: ListingCache): Promise<string[]> {
    return (await cache.list(f.library, ROOT)).entries.map((e) => e.name)
  }

  it('picks up a model added to a folder', async () => {
    const f = await fixture('lc-add')
    const cache = await primed(f)
    writeFileSync(join(f.kit, 'a', 'added.stl'), stlBytes(9))

    await cache.revalidate(f.library, ROOT)
    expect(await names(f, cache)).toContain('a/added.stl')
  })

  it('picks up a model removed from a folder', async () => {
    const f = await fixture('lc-remove')
    const cache = await primed(f)
    expect(await names(f, cache)).toContain('z/bracket.stl')
    unlinkSync(join(f.kit, 'z', 'bracket.stl'))

    await cache.revalidate(f.library, ROOT)
    expect(await names(f, cache)).not.toContain('z/bracket.stl')
  })

  it('picks up a rename, which is both at once', async () => {
    const f = await fixture('lc-rename')
    const cache = await primed(f)
    renameSync(join(f.kit, 'loose.stl'), join(f.kit, 'renamed.stl'))

    await cache.revalidate(f.library, ROOT)
    const after = await names(f, cache)
    expect(after).toContain('renamed.stl')
    expect(after).not.toContain('loose.stl')
  })

  it('picks up a whole new folder, not just a changed one', async () => {
    const f = await fixture('lc-newdir')
    const cache = await primed(f)
    // A directory the snapshot has never seen: its parent's mtime moves, the
    // parent is re-read, and the new subtree is walked fresh from there.
    mkdirSync(join(f.kit, 'a', 'fresh'))
    writeFileSync(join(f.kit, 'a', 'fresh', 'new.stl'), stlBytes(11))

    await cache.revalidate(f.library, ROOT)
    expect(await names(f, cache)).toContain('a/fresh/new.stl')
    // The folder itself entered the tree too — a container below the root level
    // only reaches a listing through a query, which is exactly the collection
    // that would have been missed had revalidation only re-read `a` and stopped.
    const matched = await cache.list(f.library, ROOT, 'fresh')
    expect(matched.entries.map((e) => e.name)).toContain('a/fresh')
  })

  it('re-reads only the folder that moved, and opens no archive', async () => {
    const f = await fixture('lc-incremental')
    const cache = await primed(f)
    writeFileSync(join(f.kit, 'a', 'added.stl'), stlBytes(9))

    fs.readdirs.length = 0
    fs.opens.length = 0
    await cache.revalidate(f.library, ROOT)

    // `/kit` itself is stat'd and reused (its own mtime did not move); only the
    // folder whose mtime did is read. Never a background full re-walk (D5).
    expect(treeReaddirs(f)).toEqual([join(f.kit, 'a')])
    // The archive was crossed and not opened — D3 doing its half of the work.
    expect(archiveOpens(f)).toBe(0)
  })

  it('leaves an unchanged tree unchanged, reading nothing at all', async () => {
    const f = await fixture('lc-nochange')
    const cache = await primed(f)
    const before = await f.store.load(ROOT)

    fs.readdirs.length = 0
    fs.opens.length = 0
    await cache.revalidate(f.library, ROOT)

    expect(treeReaddirs(f)).toEqual([])
    expect(archiveOpens(f)).toBe(0)
    expect((await f.store.load(ROOT))?.entries).toEqual(before?.entries)
  })
})

describe('the filesystem is authoritative (§4.3)', () => {
  it('invalidates when the root is present but can no longer be read', async () => {
    const f = await fixture('lc-unreadable')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const cache = new ListingCache(f.store)

    chmodSync(f.kit, 0o000)
    try {
      await cache.revalidate(f.library, ROOT)
      // Not "serve what we have": a root that is *there* and refuses to be read
      // has contradicted the cache, and the cache loses (D6).
      expect(await f.store.load(ROOT)).toBeNull()
    } finally {
      chmodSync(f.kit, 0o755)
    }
  })

  it('invalidates when a recorded folder becomes unreadable and changes', async () => {
    const f = await fixture('lc-unreadable-sub')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const cache = new ListingCache(f.store)

    fs.failReaddir = join(f.kit, 'a')
    writeFileSync(join(f.kit, 'a', 'added.stl'), stlBytes(9))
    try {
      await cache.revalidate(f.library, ROOT)
      expect(await f.store.load(ROOT)).toBeNull()
    } finally {
      fs.failReaddir = null
    }
  })

  it('leaves the snapshot alone when the volume is simply not there', async () => {
    const f = await fixture('lc-missing')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const cache = new ListingCache(f.store)

    // An unmounted volume is the library's `missing` state, not a contradiction
    // — the snapshot is neither served nor discarded. Moved, not copied: the
    // library's identity has to come back with it.
    const parked = `${f.top}-parked`
    renameSync(f.top, parked)
    try {
      expect((await f.library.state()).state).toBe('missing')
      await cache.revalidate(f.library, ROOT)
    } finally {
      renameSync(parked, f.top)
    }

    expect((await f.library.state()).state).toBe('ready')
    expect(await f.store.load(ROOT)).not.toBeNull()
    // …and the root is still unvalidated, so the pass runs when it can.
    expect(cache.isValidated(ROOT)).toBe(false)
  })

  it('leaves the snapshot alone when the volume leaves while the pass is running', async () => {
    const f = await fixture('lc-missing-midpass')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const cache = new ListingCache(f.store)

    // The gap this cell exists for: the pass runs *after* a response, so the
    // volume can go away between the check that started it and the failure it
    // then hits. The check at the top of the pass cannot see that; the one in
    // the failure path can, and without it a plugged-out drive would look like
    // a contradicted cache and throw away a snapshot that is still correct.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gated = delegate(f.library, {
      resolve: async (p) => {
        await gate
        return f.library.resolve(p)
      },
    })

    const pass = cache.revalidate(gated, ROOT)
    await new Promise((r) => setTimeout(r, 10))
    const parked = `${f.top}-parked`
    renameSync(f.top, parked)
    release()
    await pass
    renameSync(parked, f.top)

    expect(await f.store.load(ROOT)).not.toBeNull()
    expect(cache.isValidated(ROOT)).toBe(false)
  })

  it('answers the library state before any listing, so revalidation never runs', async () => {
    const f = await fixture('lc-missing-route')
    const app = createApp(
      new ThumbCache(tempDir('mb-lc-thumbs-')),
      undefined,
      undefined,
      f.library,
      undefined,
      ALL_FEATURES,
      f.store,
    )
    await walkFlat(f.library, ROOT, undefined, {}, f.store)

    const parked = `${f.top}-parked`
    renameSync(f.top, parked)
    let body: { state?: string }
    try {
      // `createApp`'s own gate — the `UNGATED` middleware above `/api/dir` —
      // already answers this, and nothing in the listing path is reached.
      const res = await app.request(`/api/dir?path=${ROOT}&flat=true`, { headers: LOOPBACK })
      expect(res.status).toBe(503)
      body = (await res.json()) as { state?: string }
    } finally {
      renameSync(parked, f.top)
    }
    expect(body.state).toBe('missing')
    expect(await f.store.load(ROOT)).not.toBeNull()
  })
})

describe('the staleness marker (§5.1)', () => {
  it('is absent on a fresh walk, present on the first cache-serve, gone once checked', async () => {
    const f = await fixture('lc-marker')
    const cache = new ListingCache(f.store)

    const walked = await cache.list(f.library, ROOT)
    expect(walked.stale).toBeUndefined()

    // A second process is what a cache-serve needs: the walk above validated
    // this root for *its* process, which is the whole point of the marker.
    const cold = new ListingCache(f.store)
    const served = await cold.list(f.library, ROOT)
    expect(served.stale).toBe(true)

    await cold.revalidate(f.library, ROOT)
    expect((await cold.list(f.library, ROOT)).stale).toBeUndefined()
  })

  it('is absent for a request that waited on the pass another request started', async () => {
    const f = await fixture('lc-inflight')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const cache = new ListingCache(f.store)

    // The pass is held open at the one call it makes before touching the disk.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gated = delegate(f.library, {
      state: async () => {
        await gate
        return f.library.state()
      },
    })

    const first = await cache.list(gated, ROOT)
    expect(first.stale).toBe(true)

    let settled = false
    const second = cache.list(gated, ROOT).then((r) => {
      settled = true
      return r
    })
    await new Promise((r) => setTimeout(r, 20))
    // It is genuinely waiting, not racing: nothing has been answered yet.
    expect(settled).toBe(false)

    release()
    expect((await second).stale).toBeUndefined()
    // One pass, not two.
    expect(cache.isValidated(ROOT)).toBe(true)
  })

  it('reaches the wire additively, and converges without the user asking again', async () => {
    const f = await fixture('lc-wire')
    await walkFlat(f.library, ROOT, undefined, {}, f.store)
    const app = createApp(
      new ThumbCache(tempDir('mb-lc-thumbs-')),
      undefined,
      undefined,
      f.library,
      undefined,
      ALL_FEATURES,
      f.store,
    )

    const ask = async (): Promise<DirListing> => {
      const res = await app.request(`/api/dir?path=${ROOT}&flat=true`, { headers: LOOPBACK })
      expect(res.status).toBe(200)
      return (await res.json()) as DirListing
    }

    const first = await ask()
    expect(first.stale).toBe(true)
    expect(first.entries.length).toBeGreaterThan(0)

    // The client's one follow-up request terminates: the pass the first request
    // started completes, and the marker does not come back.
    let converged: DirListing | undefined
    for (let i = 0; i < 100 && converged === undefined; i++) {
      await new Promise((r) => setTimeout(r, 10))
      const next = await ask()
      if (next.stale === undefined) converged = next
    }
    expect(converged).toBeDefined()
    expect(converged!.entries.map((e) => e.name)).toEqual(first.entries.map((e) => e.name))
  })

  it('marks nothing at all when the app was given no store', async () => {
    const f = await fixture('lc-nostore')
    const app = createApp(
      new ThumbCache(tempDir('mb-lc-thumbs-')),
      undefined,
      undefined,
      f.library,
    )
    for (let i = 0; i < 2; i++) {
      const res = await app.request(`/api/dir?path=${ROOT}&flat=true`, { headers: LOOPBACK })
      expect(((await res.json()) as DirListing).stale).toBeUndefined()
    }
  })
})

/**
 * A `Library` with some methods replaced. Written out rather than spread,
 * because a spread of an interface with methods is only safe while the
 * implementation happens to be closures over a literal — which is not something
 * this test should have to keep being right about.
 */
function delegate(library: Library, over: Partial<Library>): Library {
  return {
    state: over.state ?? (() => library.state()),
    refresh: over.refresh ?? (() => library.refresh()),
    realTop: over.realTop ?? (() => library.realTop()),
    id: over.id ?? (() => library.id()),
    resolve: over.resolve ?? ((p) => library.resolve(p)),
    libPathOf: over.libPathOf ?? ((p) => library.libPathOf(p)),
  }
}
