import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThumbCache } from '../src/cache'
import {
  ARCHIVES_FILE,
  SNAPSHOT_DIR,
  SNAPSHOT_VERSION,
  type SnapshotEntry,
  SnapshotStore,
  type TreeSnapshot,
} from '../src/snapshot'
import { listZipEntries } from '../src/zip'
import { libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * Two instruments in one mock, because `vi.spyOn` on an ESM namespace throws
 * ("Module namespace is not configurable") — the shape `overrides.test.ts`,
 * `library.test.ts` and `peek.test.ts` all document.
 *
 * `opens` is the **instrumentation the archive-cache requirement asks for**:
 * "an unchanged archive SHALL NOT be opened during a walk" is a claim about
 * syscalls, so it is counted at the syscall, never inferred from how long a
 * second walk took. Every `open` in the process is recorded by path; the cells
 * below count only the archive's own.
 *
 * `failRename` arms the torn-write cell. Renaming is where an atomic write
 * commits, so failing it is the one simulation that asks the question the
 * requirement asks: does a failure between "the new bytes exist" and "they are
 * the snapshot" leave a torn file?
 */
const fs = vi.hoisted(() => ({ failRename: false, opens: [] as string[] }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: (async (...args: Parameters<typeof actual.open>) => {
      fs.opens.push(String(args[0]))
      return actual.open(...args)
    }) as typeof actual.open,
    rename: (async (...args: Parameters<typeof actual.rename>) => {
      if (fs.failRename) throw new Error('simulated rename failure')
      return actual.rename(...args)
    }) as typeof actual.rename,
  }
})

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

beforeEach(() => {
  fs.failRename = false
  fs.opens.length = 0
})

function tempDir(prefix: string): string {
  const dir = realTempDir(prefix)
  cleanups.push(dir)
  return dir
}

/** A cache root — the `<cache>` half of `<cache>/<library-id>/snapshots/`. */
function cacheRoot(): string {
  return tempDir('mb-snap-cache-')
}

/**
 * A marked library tree. The top is a subdirectory of the temp dir so a test
 * can copy it elsewhere, marker and all, to play a remount — `cache.test.ts`'s
 * `makeLibraryTree` is the precedent and this is the same trick.
 */
function makeLibraryTree(id: string): string {
  const top = join(tempDir('mb-snap-lib-'), 'top')
  mkdirSync(join(top, 'kits', 'a'), { recursive: true })
  mkdirSync(join(top, '.model-browser'), { recursive: true })
  writeFileSync(join(top, '.model-browser', 'library.json'), JSON.stringify({ id, version: 1 }))
  writeFileSync(join(top, 'kits', 'a', 'x.stl'), stlBytes(1))
  return top
}

const ENTRY: SnapshotEntry = {
  name: 'x.stl',
  path: '/kits/a/x.stl',
  kind: 'model',
  format: 'stl',
  size: 134,
  mtime: 1000,
}

function snapshotOf(root: string, entries: SnapshotEntry[] = [ENTRY]): TreeSnapshot {
  return { root, walkedAt: 12345, entries, dirs: [{ path: root, mtime: 500 }] }
}

/** Where a root's file lands, by the module's own naming rule. */
function treeFileOf(base: string, id: string, root: string): string {
  return join(base, id, SNAPSHOT_DIR, `tree-${createHash('sha256').update(root).digest('hex')}.json`)
}

function opensOf(path: string): number {
  return fs.opens.filter((p) => p === path).length
}

describe('the snapshot store', () => {
  it('round-trips a snapshot for a root', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-round')))
    await store.save(snapshotOf('/kits'))
    expect(await store.load('/kits')).toEqual(snapshotOf('/kits'))
  })

  it('answers null for a root it has never walked', async () => {
    const store = new SnapshotStore(cacheRoot(), undefined, libraryFor(makeLibraryTree('lib-miss')))
    expect(await store.load('/kits')).toBeNull()
  })

  it('keeps each walked root in its own file', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-roots')))
    await store.save(snapshotOf('/kits'))
    await store.save(snapshotOf('/other', []))
    // Per-root granularity, and the one visible consequence of it: two files.
    expect((await store.load('/kits'))?.entries).toEqual([ENTRY])
    expect((await store.load('/other'))?.entries).toEqual([])
    const dir = join(base, 'lib-roots', SNAPSHOT_DIR)
    expect(readdirSync(dir).filter((f) => f.startsWith('tree-')).length).toBe(2)
  })

  it('drops the snapshot a revalidation contradicted, and leaves its siblings', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-inval')))
    await store.save(snapshotOf('/kits'))
    await store.save(snapshotOf('/other', []))
    await store.invalidate('/kits')
    expect(await store.load('/kits')).toBeNull()
    expect(await store.load('/other')).not.toBeNull()
  })
})

describe('the on-disk format version', () => {
  it('invalidates a snapshot written under another version rather than mis-parsing it', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-version')))
    await store.save(snapshotOf('/kits'))
    const file = treeFileOf(base, 'lib-version', '/kits')

    // Exactly the hazard the guard is for: a file whose *fields still parse*
    // but whose meaning this build does not know. Written whole, not torn — the
    // atomic write means a torn file should never reach a reader at all, so the
    // version is what covers what atomicity cannot.
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.version).toBe(SNAPSHOT_VERSION)
    writeFileSync(file, JSON.stringify({ ...onDisk, version: SNAPSHOT_VERSION + 1 }))

    expect(await store.load('/kits')).toBeNull()
  })

  it('leaves an unusable file for the sweep rather than deleting it on read', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-pureread')))
    await store.save(snapshotOf('/kits'))
    const file = treeFileOf(base, 'lib-pureread', '/kits')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: 99 }))

    // A read is pure: it refuses to serve the file, it does not destroy it.
    expect(await store.load('/kits')).toBeNull()
    expect(readdirSync(join(base, 'lib-pureread', SNAPSHOT_DIR))).toContain(
      `tree-${createHash('sha256').update('/kits').digest('hex')}.json`,
    )
    // The sweep is what reaps it.
    await store.maintain()
    expect(readdirSync(join(base, 'lib-pureread', SNAPSHOT_DIR))).toEqual([])
  })

  it('invalidates an unparseable snapshot', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-garbage')))
    await store.save(snapshotOf('/kits'))
    writeFileSync(treeFileOf(base, 'lib-garbage', '/kits'), '{ this is not json')
    expect(await store.load('/kits')).toBeNull()
  })
})

describe('keying by library identity', () => {
  it('is a hit when the same library is reached at another mount point', async () => {
    const base = cacheRoot()
    const top = makeLibraryTree('lib-remount')
    await new SnapshotStore(base, undefined, libraryFor(top)).save(snapshotOf('/kits'))

    // The volume comes back somewhere else, marker and all: a different mount
    // point, the same library, the same library path for the same tree. Driven
    // through the identity rather than by actually remounting anything.
    const elsewhere = join(tempDir('mb-snap-mount-'), 'top')
    cpSync(top, elsewhere, { recursive: true })
    const remounted = new SnapshotStore(base, undefined, libraryFor(elsewhere))

    expect((await remounted.load('/kits'))?.entries).toEqual([ENTRY])
  })

  it('never lets two libraries with the same layout share a snapshot', async () => {
    const base = cacheRoot()
    // Identical layouts, identical library paths, different identities.
    const first = makeLibraryTree('lib-one')
    const second = makeLibraryTree('lib-two')
    await new SnapshotStore(base, undefined, libraryFor(first)).save(snapshotOf('/kits'))

    expect(await new SnapshotStore(base, undefined, libraryFor(second)).load('/kits')).toBeNull()
  })

  it('refuses a snapshot filed under another library, on its own contents', async () => {
    const base = cacheRoot()
    await new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-owner'))).save(
      snapshotOf('/kits'),
    )
    // The file, moved into a second library's directory — a restored backup, a
    // copied cache. The directory says it is this library's; the file says
    // otherwise, and the file wins.
    const stolen = treeFileOf(base, 'lib-thief', '/kits')
    mkdirSync(join(base, 'lib-thief', SNAPSHOT_DIR), { recursive: true })
    cpSync(treeFileOf(base, 'lib-owner', '/kits'), stolen)

    const thief = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-thief')))
    expect(await thief.load('/kits')).toBeNull()
  })
})

describe('the archive-directory cache', () => {
  /** A library holding `count` archives, each with one model inside. */
  function libraryWithArchives(id: string, count: number): { top: string; zips: string[] } {
    const top = makeLibraryTree(id)
    const zips: string[] = []
    for (let i = 0; i < count; i++) {
      const path = join(top, `kit-${i}.zip`)
      writeFileSync(path, zipSync({ [`part-${i}.stl`]: new Uint8Array(stlBytes(i + 1)) }))
      zips.push(path)
    }
    return { top, zips }
  }

  it('opens no archive on a second walk', async () => {
    const { top, zips } = libraryWithArchives('lib-zero-opens', 3)
    const store = new SnapshotStore(cacheRoot(), undefined, libraryFor(top))
    const cache = store.archiveCache()

    // Walk one: cold. Every archive is opened and its central directory read.
    const first = []
    for (const zip of zips) first.push(await listZipEntries(zip, cache))
    expect(zips.every((zip) => opensOf(zip) > 0)).toBe(true)

    // Walk two: the archives are unchanged, so none of them is opened at all.
    fs.opens.length = 0
    const second = []
    for (const zip of zips) second.push(await listZipEntries(zip, cache))

    expect(zips.map(opensOf)).toEqual([0, 0, 0])
    expect(second).toEqual(first)
  })

  it('opens no archive on a second walk in a later process', async () => {
    const base = cacheRoot()
    const { top, zips } = libraryWithArchives('lib-zero-opens-cold', 3)
    const warm = new SnapshotStore(base, undefined, libraryFor(top))
    const cacheA = warm.archiveCache()
    for (const zip of zips) await listZipEntries(zip, cacheA)
    await warm.flush()

    // A different store over the same cache directory — what a restart is.
    fs.opens.length = 0
    const cold = new SnapshotStore(base, undefined, libraryFor(top))
    const cacheB = cold.archiveCache()
    for (const zip of zips) await listZipEntries(zip, cacheB)

    expect(zips.map(opensOf)).toEqual([0, 0, 0])
  })

  it('re-reads and replaces the directory of a rewritten archive', async () => {
    const { top, zips } = libraryWithArchives('lib-rewritten', 2)
    const [rewritten, untouched] = zips as [string, string]
    const store = new SnapshotStore(cacheRoot(), undefined, libraryFor(top))
    const cache = store.archiveCache()

    for (const zip of zips) await listZipEntries(zip, cache)
    expect((await listZipEntries(rewritten, cache)).map((e) => e.name)).toEqual(['part-0.stl'])

    // Rewritten: different contents, and a size and mtime that move with them.
    writeFileSync(
      rewritten,
      zipSync({
        'renamed.stl': new Uint8Array(stlBytes(9)),
        'extra.stl': new Uint8Array(stlBytes(10)),
      }),
    )

    fs.opens.length = 0
    expect((await listZipEntries(rewritten, cache)).map((e) => e.name).sort()).toEqual([
      'extra.stl',
      'renamed.stl',
    ])
    // It was re-read, and its neighbour was not disturbed.
    expect(opensOf(rewritten)).toBeGreaterThan(0)
    fs.opens.length = 0
    expect((await listZipEntries(untouched, cache)).map((e) => e.name)).toEqual(['part-1.stl'])
    expect(opensOf(untouched)).toBe(0)

    // And the replacement is what persists — not the directory it replaced.
    await store.flush()
    const record = JSON.parse(
      readFileSync(join(store.dir, 'lib-rewritten', SNAPSHOT_DIR, ARCHIVES_FILE), 'utf8'),
    )
    expect(record.archives['/kit-0.zip'].entries.map((e: { name: string }) => e.name).sort()).toEqual([
      'extra.stl',
      'renamed.stl',
    ])
  })

  it('keys archives by library path, so a remount hits', async () => {
    const base = cacheRoot()
    const { top, zips } = libraryWithArchives('lib-zip-remount', 1)
    const warm = new SnapshotStore(base, undefined, libraryFor(top))
    await listZipEntries(zips[0]!, warm.archiveCache())
    await warm.flush()

    // The tree arrives at a different path. **Moved, not copied**: an archive's
    // cache key is its `{mtime, size}`, and `cpSync` gives the copy a fresh
    // mtime — even `preserveTimestamps` loses sub-millisecond precision — so a
    // copied fixture is a *rewritten* archive and correctly misses. A rename
    // keeps the inode, which is what a volume reappearing elsewhere actually is.
    const elsewhere = join(tempDir('mb-snap-zipmount-'), 'top')
    renameSync(top, elsewhere)
    const moved = join(elsewhere, 'kit-0.zip')

    fs.opens.length = 0
    const remounted = new SnapshotStore(base, undefined, libraryFor(elsewhere))
    expect((await listZipEntries(moved, remounted.archiveCache())).map((e) => e.name)).toEqual([
      'part-0.stl',
    ])
    expect(opensOf(moved)).toBe(0)
  })

  it('persists nothing for a walk that never flushed', async () => {
    const base = cacheRoot()
    const { top, zips } = libraryWithArchives('lib-noflush', 1)
    const abandoned = new SnapshotStore(base, undefined, libraryFor(top))
    await listZipEntries(zips[0]!, abandoned.archiveCache())

    // A cancelled or truncated walk persists nothing by construction.
    fs.opens.length = 0
    const later = new SnapshotStore(base, undefined, libraryFor(top))
    await listZipEntries(zips[0]!, later.archiveCache())
    expect(opensOf(zips[0]!)).toBeGreaterThan(0)
  })
})

describe('atomic writes', () => {
  it('leaves the old snapshot whole behind a failed write, never a torn one', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-torn')))
    await store.save(snapshotOf('/kits'))

    const replacement = snapshotOf('/kits', [{ ...ENTRY, name: 'half-written.stl' }])
    fs.failRename = true
    await expect(store.save(replacement)).rejects.toThrow('simulated rename failure')
    fs.failRename = false

    // Old or new, never half of one — and here, old.
    expect(await store.load('/kits')).toEqual(snapshotOf('/kits'))
    // And no temp file was left where the sweep or a later reader could find it.
    expect(readdirSync(join(base, 'lib-torn', SNAPSHOT_DIR)).filter((f) => f.endsWith('.tmp'))).toEqual(
      [],
    )
  })

  it('leaves the old archive layer whole behind a failed write', async () => {
    const base = cacheRoot()
    const top = makeLibraryTree('lib-torn-zip')
    const zip = join(top, 'kit.zip')
    writeFileSync(zip, zipSync({ 'a.stl': new Uint8Array(stlBytes(1)) }))
    const store = new SnapshotStore(base, undefined, libraryFor(top))
    await listZipEntries(zip, store.archiveCache())
    await store.flush()

    writeFileSync(zip, zipSync({ 'b.stl': new Uint8Array(stlBytes(2)) }))
    await listZipEntries(zip, store.archiveCache())
    fs.failRename = true
    await expect(store.flush()).rejects.toThrow('simulated rename failure')
    fs.failRename = false

    const onDisk = JSON.parse(readFileSync(join(base, 'lib-torn-zip', SNAPSHOT_DIR, ARCHIVES_FILE), 'utf8'))
    expect(onDisk.archives['/kit.zip'].entries.map((e: { name: string }) => e.name)).toEqual(['a.stl'])
  })
})

describe('the store directory', () => {
  it('is created lazily — a cache from before this change has no snapshots/', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, undefined, libraryFor(makeLibraryTree('lib-lazy')))
    // Nothing has been walked, so nothing exists to hold.
    expect(readdirSync(base)).toEqual([])
    expect(await store.load('/kits')).toBeNull()
    expect(readdirSync(base)).toEqual([])

    await store.save(snapshotOf('/kits'))
    expect(readdirSync(join(base, 'lib-lazy'))).toEqual([SNAPSHOT_DIR])
  })

  it('tolerates its own absence in every operation', async () => {
    const store = new SnapshotStore(cacheRoot(), undefined, libraryFor(makeLibraryTree('lib-absent')))
    await expect(store.load('/kits')).resolves.toBeNull()
    await expect(store.invalidate('/kits')).resolves.toBeUndefined()
    await expect(store.maintain()).resolves.toBeUndefined()
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it('survives a cache root that does not exist at all', async () => {
    const store = new SnapshotStore(
      join(tmpdir(), 'mb-snap-does-not-exist'),
      undefined,
      libraryFor(makeLibraryTree('lib-nodir')),
    )
    await expect(store.maintain()).resolves.toBeUndefined()
    await expect(store.load('/kits')).resolves.toBeNull()
  })
})

describe('the size bound', () => {
  it('falls back to the default rather than unbounding on a malformed knob', () => {
    const before = process.env.MODEL_BROWSER_SNAPSHOT_CAP
    try {
      const DEFAULT = 64 * 1024 ** 2
      process.env.MODEL_BROWSER_SNAPSHOT_CAP = '64MB' // Number(...) is NaN
      expect(new SnapshotStore('/tmp/unused').sizeCap).toBe(DEFAULT)
      process.env.MODEL_BROWSER_SNAPSHOT_CAP = '-1'
      expect(new SnapshotStore('/tmp/unused').sizeCap).toBe(DEFAULT)
      process.env.MODEL_BROWSER_SNAPSHOT_CAP = '0'
      expect(new SnapshotStore('/tmp/unused').sizeCap).toBe(DEFAULT)
      process.env.MODEL_BROWSER_SNAPSHOT_CAP = ''
      expect(new SnapshotStore('/tmp/unused').sizeCap).toBe(DEFAULT)
      // A well-formed knob is honoured, so the fallback is not just "always".
      process.env.MODEL_BROWSER_SNAPSHOT_CAP = '4096'
      expect(new SnapshotStore('/tmp/unused').sizeCap).toBe(4096)
    } finally {
      if (before === undefined) delete process.env.MODEL_BROWSER_SNAPSHOT_CAP
      else process.env.MODEL_BROWSER_SNAPSHOT_CAP = before
    }
  })

  it('evicts oldest-read-first until it is under the cap', async () => {
    const base = cacheRoot()
    const big: SnapshotEntry[] = Array.from({ length: 200 }, (_, i) => ({
      ...ENTRY,
      name: `m-${i}.stl`,
      path: `/kits/a/m-${i}.stl`,
    }))
    const library = libraryFor(makeLibraryTree('lib-cap'))
    const writer = new SnapshotStore(base, 64 * 1024 ** 2, library)
    await writer.save(snapshotOf('/one', big))
    await writer.save(snapshotOf('/two', big))
    await writer.save(snapshotOf('/three', big))

    // The LRU clock is each file's mtime, so it is *set*, not raced: three
    // saves inside one millisecond would otherwise tie and make the ordering
    // this cell asserts depend on the sort's stability.
    const stamp = (root: string, seconds: number): void =>
      utimesSync(treeFileOf(base, 'lib-cap', root), seconds, seconds)
    stamp('/three', 1_000) // read longest ago
    stamp('/two', 2_000)
    stamp('/one', 3_000) // most recently read

    // A cap that holds two of the three: eviction takes the oldest and stops.
    const each = statSync(treeFileOf(base, 'lib-cap', '/one')).size
    await new SnapshotStore(base, each * 2 + 1024, library).maintain()

    expect(await new SnapshotStore(base, 0, library).load('/three')).toBeNull()
    // The two most recently read survive — and the store is readable, not just
    // present, so eviction removed whole files rather than truncating any.
    const survivor = new SnapshotStore(base, 0, library)
    expect((await survivor.load('/one'))?.entries.length).toBe(200)
    expect((await survivor.load('/two'))?.entries.length).toBe(200)
  })

  it('leaves a store under its cap entirely alone', async () => {
    const base = cacheRoot()
    const store = new SnapshotStore(base, 64 * 1024 ** 2, libraryFor(makeLibraryTree('lib-under')))
    await store.save(snapshotOf('/kits'))
    await store.maintain()
    expect(await store.load('/kits')).toEqual(snapshotOf('/kits'))
  })
})

describe('living beside the thumbnail cache', () => {
  /**
   * The placement decision this whole subdirectory exists for (design D2).
   *
   * `ThumbCache.maintain()` treats every `*.json` in the per-library directory
   * as a thumbnail sidecar: it parses it as one, then asks whether the source
   * it names still exists. A snapshot filed flat beside the thumbnails is read
   * as a sidecar with no `path`, which throws inside the sweep and takes the
   * whole sweep — thumbnails included — down with it, silently.
   *
   * A subdirectory is invisible to that loop's own `.endsWith('.json')` test.
   * This cell pins both halves: the sweep still does its job, and the snapshot
   * is still there afterwards.
   */
  it('is invisible to the thumbnail sweep, which still sweeps', async () => {
    const base = cacheRoot()
    const top = makeLibraryTree('lib-neighbours')
    const snapshots = new SnapshotStore(base, undefined, libraryFor(top))
    await snapshots.save(snapshotOf('/kits'))

    const thumbs = new ThumbCache(base, 2 * 1024 ** 3, 32, libraryFor(top))
    await thumbs.put('/kits/a/x.stl', { mtime: 1, png: Buffer.from('png') })
    // A thumbnail whose model is gone — what the sweep is supposed to remove.
    await thumbs.put('/kits/a/deleted.stl', { mtime: 1, png: Buffer.from('png') })

    await thumbs.maintain()

    // The sweep ran to completion: the dead entry went, the live one stayed.
    expect((await thumbs.get('/kits/a/deleted.stl', 1)).status).toBe('miss')
    expect((await thumbs.get('/kits/a/x.stl', 1)).status).toBe('hit')
    // And it never saw the snapshot.
    expect(await snapshots.load('/kits')).toEqual(snapshotOf('/kits'))
    expect(readdirSync(join(base, 'lib-neighbours'))).toContain(SNAPSHOT_DIR)
  })

  it('shares the per-library directory, so one rm -rf still takes both', async () => {
    const base = cacheRoot()
    const top = makeLibraryTree('lib-together')
    const snapshots = new SnapshotStore(base, undefined, libraryFor(top))
    await snapshots.save(snapshotOf('/kits'))
    const thumbs = new ThumbCache(base, 2 * 1024 ** 3, 32, libraryFor(top))
    await thumbs.put('/kits/a/x.stl', { mtime: 1, png: Buffer.from('png') })

    rmSync(join(base, 'lib-together'), { recursive: true, force: true })

    expect(await snapshots.load('/kits')).toBeNull()
    expect((await thumbs.get('/kits/a/x.stl', 1)).status).toBe('miss')
  })
})
