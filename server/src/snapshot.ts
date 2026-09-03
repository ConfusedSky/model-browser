/**
 * The listing cache's durable store: walked-tree snapshots and archive
 * directories (`listing-tree-cache` §2–§3).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * **Where it lives, and why not simply beside the thumbnails (design D2).**
 * The store is `<cache>/<library-id>/snapshots/`: inside the thumbnail cache's
 * per-library directory, so it follows the library to another mount point
 * exactly as the thumbnails do and the documented `rm -rf <id-dir>` reset still
 * takes everything — but in a subdirectory of its own, because
 * `ThumbCache.maintain()` treats *every* `*.json` in that directory as a
 * thumbnail sidecar. A snapshot filed flat beside them makes the sweep's
 * `sourceExists(meta.path)` throw on an undefined path, which aborts the whole
 * sweep silently, and would be deleted outright as a dead thumbnail the day a
 * snapshot grew a `path` field. A plain directory name fails that loop's own
 * `.endsWith('.json')` test, so `maintain()` is byte-unchanged and blind to
 * this store.
 *
 * It therefore carries its own bound in the same policy shape rather than a
 * share of the thumbnail pool: one validated env knob, oldest-first eviction. A
 * ~2 MB snapshot in a 2 GB PNG budget would otherwise let thumbnail churn evict
 * thirty seconds of cold-walk protection to reclaim 0.1% of the cap.
 *
 * **Granularity (settled at implementation).** One file per *walked root*,
 * `tree-<sha256(root library path)>.json`, plus one `archives.json` for the
 * library. Per-root keeps §4.1a's "only a complete traversal is persisted" rule
 * honest independently for each root, and makes revalidation cost scale with
 * the roots actually walked. The accepted cost, recorded here so stage 2
 * inherits the fact rather than rediscovering it: a walk of `/` and a walk of
 * `/kit` store that subtree twice. The archive layer is per *library* because an
 * archive's identity has nothing to do with which root was walked — keying it
 * per root would re-read the same zip tails once per root, which is precisely
 * the cost D3 exists to delete.
 */

import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, utimes } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type Library, LibraryError } from './library'
import { VPathError } from './vpath'
import type { ArchiveId, ZipDirCache, ZipEntry } from './zip'

/**
 * The on-disk format version. Bump on any change to what a stored file means;
 * a file carrying anything else is treated as absent rather than guessed at
 * (`overrides.ts`'s `VERSION` is the precedent and the same reasoning).
 *
 * This is the *second* line of defense, not the only one: writes are atomic, so
 * a torn file should never reach a reader in the first place. The guard is what
 * covers the case atomicity cannot — a file written whole by an older or newer
 * build, whose fields parse but no longer mean what this build thinks.
 */
export const SNAPSHOT_VERSION = 1

/** The subdirectory, inside the per-library cache directory, that holds it all. */
export const SNAPSHOT_DIR = 'snapshots'

/** The archive-directory layer's file name, one per library. */
export const ARCHIVES_FILE = 'archives.json'

/** Default bound for the whole store: 64 MB of metadata, per design D2. */
const DEFAULT_CAP = 64 * 1024 ** 2

/**
 * One entry as the walk saw it.
 *
 * Deliberately **not** `DirEntry`. The two carry the same walk facts, but
 * `DirEntry` also carries `displayName`, which `applyDisplayNames` sets on
 * emitted entries *in place* and never clears. Persisting that shape would let
 * one request's override names be written into the snapshot and served back to
 * every later request, across a store removal or a library repoint — the exact
 * failure the delta's "serve copies, never the cached objects" rule exists to
 * prevent. A separate type makes the annotation fields unrepresentable here
 * rather than merely discouraged; stage 2 maps these to fresh `DirEntry`s.
 */
export interface SnapshotEntry {
  name: string
  /** Library path — never a filesystem path, so a remount changes nothing. */
  path: string
  kind: 'dir' | 'zip' | 'model'
  /** Model format, present when kind === 'model'. */
  format?: 'stl' | '3mf' | 'obj'
  size: number
  /** mtime (ms). For zip entries this is the containing archive's mtime. */
  mtime: number
}

/**
 * Per-directory freshness state (D4): the signal revalidation re-checks.
 *
 * A record rather than a bare number so the readdir-fingerprint fallback D4
 * keeps as a contingency for other filesystems — entry count plus total size —
 * can be added as fields without a format bump changing what `mtime` means.
 */
export interface SnapshotDir {
  /** Library path of the directory. */
  path: string
  /** Its `mtimeMs` when the walk read it. */
  mtime: number
}

/** A complete walk of one root, as stage 2 will serve and revalidate it. */
export interface TreeSnapshot {
  /** The walked root's library path — the second half of the key. */
  root: string
  /** When the walk that produced this completed (ms since epoch). */
  walkedAt: number
  entries: SnapshotEntry[]
  dirs: SnapshotDir[]
}

/** A tree snapshot as it sits on disk. */
interface TreeFile extends TreeSnapshot {
  version: number
  /**
   * The library this belongs to. Redundant with the directory it is filed in,
   * and kept anyway: it is what makes a snapshot self-describing, so a file
   * copied or restored into the wrong library's directory is rejected on its
   * own contents rather than served as that library's tree.
   */
  library: string
}

/** One archive's cached central directory, against the identity it was read at. */
interface ArchiveRecord extends ArchiveId {
  entries: ZipEntry[]
}

/** The archive layer as it sits on disk. */
interface ArchivesFile {
  version: number
  library: string
  /** Keyed by the archive's library path (never its filesystem path). */
  archives: Record<string, ArchiveRecord>
}

/**
 * The size cap from the environment, on `envLimit`'s rule (`listing.ts`): a
 * missing, malformed or non-positive value falls back to the default and never
 * silently unbounds the store. `Number('64MB')` is NaN, and a NaN cap makes
 * `total <= cap` false forever — a malformed knob that evicts everything on
 * every sweep, which is what this shape exists to refuse.
 */
function envCap(): number {
  const raw = process.env.MODEL_BROWSER_SNAPSHOT_CAP
  if (raw === undefined || raw.trim() === '') return DEFAULT_CAP
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CAP
}

/**
 * Replace a file atomically and durably: write a temp file beside it, fsync it,
 * then rename over the target. `overrides.ts`'s `writeOverrides` is the
 * precedent and this is the same procedure — a reader sees the old file or the
 * new one, never half of one, so the version guard above is never the only
 * thing standing between a crash and a mis-parse.
 *
 * The temp file is dot-prefixed and removed if anything fails, so a failed
 * write leaves the directory as it found it. The directory fsync afterwards is
 * what makes the *rename* durable rather than just the bytes; it is
 * best-effort, because not every filesystem this library can live on (exFAT,
 * notably) supports it.
 */
async function writeAtomic(dir: string, name: string, text: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, name)
  // pid + ms alone can collide (two writes in one tick of one process); the
  // random suffix cannot, and a stray loser is dot-prefixed and swept below.
  const temp = join(dir, `.${name}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`)
  try {
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, target)
  } catch (err) {
    await unlink(temp).catch(() => undefined)
    throw err
  }
  const dirHandle = await open(dir, 'r').catch(() => null)
  if (dirHandle !== null) {
    await dirHandle.sync().catch(() => undefined)
    await dirHandle.close().catch(() => undefined)
  }
}

/**
 * The walked-tree and archive-directory store for one library.
 *
 * Constructed like `ThumbCache` — the cache root and the library are
 * constructor arguments, so a test never depends on `MODEL_BROWSER_CACHE` or on
 * the developer's real cache. Omitting the library is test-only: entries then
 * live in `<dir>/snapshots/` with no library identity to check.
 */
export class SnapshotStore {
  /** The archive layer, loaded once per process and flushed on demand. */
  private archives: Map<string, ArchiveRecord> | undefined
  private archivesDirty = false
  private loadingArchives: Promise<Map<string, ArchiveRecord>> | undefined

  constructor(
    readonly dir: string = process.env.MODEL_BROWSER_CACHE ?? join(homedir(), '.cache', 'model-browser'),
    readonly sizeCap: number = envCap(),
    private readonly library?: Library,
  ) {}

  /**
   * Where this library's snapshots live. Awaiting the state is what makes the
   * id readable — `id()` throws until the library has been evaluated once — and
   * it keeps the read lazy, so the store can be constructed before the volume
   * has been looked at at all. `ThumbCache.entryDir` is the same shape.
   */
  private async storeDir(): Promise<string> {
    if (this.library === undefined) return join(this.dir, SNAPSHOT_DIR)
    await this.library.state()
    return join(this.dir, this.library.id(), SNAPSHOT_DIR)
  }

  /** The library's identity, or `''` for a library-less (test) store. */
  private async libraryId(): Promise<string> {
    if (this.library === undefined) return ''
    await this.library.state()
    return this.library.id()
  }

  /**
   * A root's file name. Hashed for the same reason `ThumbCache` hashes: library
   * paths contain `/`, `!` and spaces, none of which survive being a file name.
   */
  private treeFile(root: string): string {
    return `tree-${createHash('sha256').update(root).digest('hex')}.json`
  }

  /**
   * The snapshot for `root`, or null — absent, unreadable, torn, of another
   * format version, or belonging to another library.
   *
   * Reading is **pure**: a file rejected here is left where it is rather than
   * deleted, so a read can never destroy a snapshot a newer build could still
   * use. `maintain` is what reaps them.
   */
  async load(root: string): Promise<TreeSnapshot | null> {
    const dir = await this.storeDir()
    const file = join(dir, this.treeFile(root))
    const parsed = await readJson<TreeFile>(file)
    if (parsed === null) return null
    if (parsed.version !== SNAPSHOT_VERSION) return null
    if (parsed.library !== (await this.libraryId())) return null
    // The hash makes a collision vanishingly unlikely, not impossible, and a
    // stored root that is not the one asked for would serve another directory's
    // tree. Cheap to check, catastrophic to skip.
    if (parsed.root !== root) return null
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.dirs)) return null
    // The LRU clock for the size cap is the file's own mtime, bumped on read
    // via `utimes` — `ThumbCache`'s trick, and for its reason: it cannot be
    // caught mid-write by the sweep the way rewriting the file could.
    const now = new Date()
    await utimes(file, now, now).catch(() => undefined)
    return { root: parsed.root, walkedAt: parsed.walkedAt, entries: parsed.entries, dirs: parsed.dirs }
  }

  /**
   * Every root this library has a usable snapshot for.
   *
   * What startup revalidation (§6.5) and the reload endpoint (§6.6) iterate:
   * both mean "the trees this library has cached", and only the files know
   * which those are — the store is keyed by a hash, so a root cannot be read
   * back out of a file name.
   *
   * Deliberately does **not** bump the LRU clock the way `load` does. This is a
   * census, not a serve: a root nobody has listed for a month should not be
   * defended from the size cap by the fact that a reload counted it.
   *
   * An absent store directory is an empty list, on `maintain`'s reasoning: a
   * cache from before this change has no `snapshots/`, and neither does a
   * library nothing has walked.
   */
  async roots(): Promise<string[]> {
    const dir = await this.storeDir()
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const id = await this.libraryId()
    const out: string[] = []
    for (const name of names) {
      if (!name.startsWith('tree-') || !name.endsWith('.json')) continue
      const parsed = await readJson<TreeFile>(join(dir, name))
      if (parsed === null || parsed.version !== SNAPSHOT_VERSION || parsed.library !== id) continue
      if (typeof parsed.root === 'string') out.push(parsed.root)
    }
    return out
  }

  /**
   * Persist a snapshot for its root, replacing any previous one.
   *
   * The caller owns the rule this store cannot check: **only a traversal that
   * ran to completion may be saved** (D1/§4.1a). A partial tree stored as a
   * whole one is indistinguishable from the real thing and permanently wrong,
   * and completeness is a fact about `walkFlat`'s `budgetExhausted`, which is
   * not visible from here.
   *
   * Flushes the archive layer too: a completed walk is exactly the moment both
   * halves of what it learned should become durable together.
   */
  async save(snapshot: TreeSnapshot): Promise<void> {
    const dir = await this.storeDir()
    const file: TreeFile = {
      version: SNAPSHOT_VERSION,
      library: await this.libraryId(),
      root: snapshot.root,
      walkedAt: snapshot.walkedAt,
      entries: snapshot.entries,
      dirs: snapshot.dirs,
    }
    await writeAtomic(dir, this.treeFile(snapshot.root), JSON.stringify(file))
    await this.flush()
  }

  /**
   * Drop the snapshot for one root — what revalidation calls when the
   * filesystem has contradicted it (D6). Absent is success.
   */
  async invalidate(root: string): Promise<void> {
    const dir = await this.storeDir()
    await rm(join(dir, this.treeFile(root)), { force: true })
  }

  /**
   * Drop every tree snapshot for this library, archive layer included. The
   * blunt instrument behind an explicit reload (D9) and behind "the format
   * changed under us".
   */
  async invalidateAll(): Promise<void> {
    const dir = await this.storeDir()
    this.archives = new Map()
    this.archivesDirty = false
    await rm(dir, { recursive: true, force: true })
  }

  // ---- archive directories (D3) ----

  /**
   * The `ZipDirCache` to hand `listZipEntries`. Keyed on the archive's
   * `{mtime, size}`, so an unchanged archive is answered without being opened.
   *
   * Held in memory across a walk and written once, by `flush` or by `save`:
   * persisting on every `set` would mean rewriting the whole layer 409 times
   * during the walk that populates it.
   */
  archiveCache(): ZipDirCache {
    return {
      get: async (zipPath, id) => {
        const key = await this.archiveKey(zipPath)
        const held = (await this.loadArchives()).get(key)
        if (held === undefined) return undefined
        // The whole of D3's soundness: a rewritten archive necessarily rewrites
        // its tail, so a moved mtime or size means the cached directory
        // describes bytes that are gone.
        if (held.mtime !== id.mtime || held.size !== id.size) return undefined
        return held.entries
      },
      set: async (zipPath, id, entries) => {
        const key = await this.archiveKey(zipPath)
        ;(await this.loadArchives()).set(key, { mtime: id.mtime, size: id.size, entries })
        this.archivesDirty = true
      },
    }
  }

  /**
   * The archive's key: its **library path**, so the layer survives a remount
   * exactly as the tree snapshots do. `zip.ts` deals in filesystem paths and
   * must not be taught otherwise, so the translation happens here.
   *
   * A path the library refuses — outside the top, or unresolvable — falls back
   * to the filesystem path. That is the honest answer for a library-less store,
   * and for anything genuinely outside the library it degrades to a
   * mount-point-specific key rather than a wrong one.
   */
  private async archiveKey(zipPath: string): Promise<string> {
    if (this.library === undefined) return zipPath
    try {
      await this.library.state()
      return this.library.libPathOf(zipPath)
    } catch (err) {
      if (err instanceof LibraryError || err instanceof VPathError) return zipPath
      throw err
    }
  }

  /**
   * Load the archive layer once. Single-flighted: a walk fires many `get`s
   * before the first has resolved, and without this each would read and parse
   * the file.
   */
  private async loadArchives(): Promise<Map<string, ArchiveRecord>> {
    if (this.archives !== undefined) return this.archives
    return (this.loadingArchives ??= this.readArchives().finally(() => {
      this.loadingArchives = undefined
    }))
  }

  private async readArchives(): Promise<Map<string, ArchiveRecord>> {
    const dir = await this.storeDir()
    const parsed = await readJson<ArchivesFile>(join(dir, ARCHIVES_FILE))
    const map = new Map<string, ArchiveRecord>()
    if (
      parsed !== null &&
      parsed.version === SNAPSHOT_VERSION &&
      parsed.library === (await this.libraryId()) &&
      typeof parsed.archives === 'object' &&
      parsed.archives !== null
    ) {
      for (const [key, record] of Object.entries(parsed.archives)) {
        if (record !== null && typeof record === 'object' && Array.isArray(record.entries)) {
          map.set(key, record)
        }
      }
    }
    this.archives = map
    return map
  }

  /**
   * Write the archive layer if anything changed. A process that never calls
   * this (nor `save`) keeps what it learned in memory only, which is correct
   * for a walk that was cancelled or truncated and must persist nothing.
   */
  async flush(): Promise<void> {
    if (!this.archivesDirty || this.archives === undefined) return
    const dir = await this.storeDir()
    const file: ArchivesFile = {
      version: SNAPSHOT_VERSION,
      library: await this.libraryId(),
      archives: Object.fromEntries(this.archives),
    }
    await writeAtomic(dir, ARCHIVES_FILE, JSON.stringify(file))
    this.archivesDirty = false
  }

  // ---- maintenance ----

  /**
   * Sweep and bound this store: reap files this build cannot use, then evict
   * oldest-read-first until the total is under the cap.
   *
   * Separate from `ThumbCache.maintain()` by design (D2) and independent of it:
   * one location, one policy shape, two bounds. The LRU clock is each file's
   * mtime, which `load` bumps.
   *
   * An absent store directory is success and nothing else: a cache directory
   * from before this change has no `snapshots/` in it, and neither does a
   * library nothing has walked yet.
   */
  async maintain(): Promise<void> {
    const dir = await this.storeDir()
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    const files: { path: string; size: number; lastRead: number }[] = []
    for (const name of names) {
      const path = join(dir, name)
      const info = await stat(path).catch(() => null)
      if (info === null || !info.isFile()) continue
      // A stray temp file from an interrupted write is nobody's snapshot and
      // will never be read; it is the one thing swept on sight.
      if (name.endsWith('.tmp')) {
        await rm(path, { force: true })
        continue
      }
      // Reaped here rather than on read, so a read stays pure: a file this
      // build cannot parse or whose version it does not know is dead weight
      // against the cap and will never be served.
      if (!(await this.usable(name, path))) {
        await rm(path, { force: true })
        continue
      }
      files.push({ path, size: info.size, lastRead: info.mtimeMs })
    }
    let total = files.reduce((sum, f) => sum + f.size, 0)
    if (total <= this.sizeCap) return
    files.sort((a, b) => a.lastRead - b.lastRead)
    for (const f of files) {
      if (total <= this.sizeCap) break
      await rm(f.path, { force: true })
      total -= f.size
      // The in-memory archive layer would otherwise write the evicted file
      // straight back on the next flush.
      if (f.path.endsWith(ARCHIVES_FILE)) {
        this.archives = new Map()
        this.archivesDirty = false
      }
    }
  }

  /** Can this build read this file at all? Version and owner, not contents. */
  private async usable(name: string, path: string): Promise<boolean> {
    if (name !== ARCHIVES_FILE && !name.startsWith('tree-')) return false
    const parsed = await readJson<{ version?: unknown; library?: unknown }>(path)
    if (parsed === null) return false
    return parsed.version === SNAPSHOT_VERSION && parsed.library === (await this.libraryId())
  }
}

/** Parse a JSON file, or null for absent, unreadable, torn or not-an-object. */
async function readJson<T>(file: string): Promise<T | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as T
}
