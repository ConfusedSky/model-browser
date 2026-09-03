import { readdir, realpath, stat } from 'node:fs/promises'
import { join, posix, sep } from 'node:path'
import { baseName } from '../../shared/names'
import type { DirEntry, DirListing } from '../../shared/types'
import { MARKER_DIR, type Library } from './library'
import type { SnapshotEntry, SnapshotStore, TreeSnapshot } from './snapshot'
import { joinVPath, parseVPath, VPathError } from './vpath'
import { ZipError, type ZipDirCache, listZipEntries } from './zip'

export class ListingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A revalidation pass that cannot be completed against a root that is *there*
 * (`listing-tree-cache` §4.3, design D6). Its own class because `walkFsLevel`
 * deliberately **swallows** an unreadable subdirectory — a folder the user
 * cannot read is skipped, not a failed listing — and revalidation must not
 * inherit that: the snapshot says this directory was readable and held these
 * entries, the filesystem now says otherwise, and the filesystem wins. Thrown
 * only on the revalidation path, where a recorded directory is the one that
 * failed; a walk with no snapshot behind it raises nothing new.
 */
export class RevalidationError extends Error {}

const MODEL_EXT = /\.(stl|3mf|obj)$/i

/** The format a name — or a whole path — ends in, undefined when it is not a model. */
export function modelFormat(name: string): 'stl' | '3mf' | 'obj' | undefined {
  const m = MODEL_EXT.exec(name)
  return m ? (m[1]!.toLowerCase() as 'stl' | '3mf' | 'obj') : undefined
}

/**
 * A listing entry plus the filesystem path it was read from. Every emitted
 * `path` is the **logical** library path — the route the client asks for again
 * — while the walk descends filesystem paths (library-root D3); re-resolving a
 * logical path inside the walk would realpath an in-library alias onto its
 * target and collapse the two routes into one. `fsPath` never leaves this
 * module: `wire` strips it at the boundary.
 */
interface FsEntry extends DirEntry {
  fsPath: string
}

/** The library's own confinement test, applied to an already-resolved real path. */
function within(realTop: string, real: string): boolean {
  return real === realTop || real.startsWith(realTop + sep)
}

/** Drop the internal filesystem path: only the logical path leaves this module. */
function wire(entries: readonly DirEntry[]): DirEntry[] {
  return entries.map((e) => {
    const out: DirEntry = { name: e.name, path: e.path, kind: e.kind, size: e.size, mtime: e.mtime }
    if (e.format !== undefined) out.format = e.format
    return out
  })
}

interface FlatWalk {
  /**
   * Walk steps left: every directory entry examined costs 1. Seeded from the
   * search budget or the browse budget depending on the request (D5).
   */
  budget: number
  /** Realpaths of directories already entered — cycle guard and alias dedup. */
  visited: Set<string>
  models: DirEntry[]
  /**
   * Every container *below* the root level, named by root-relative path like
   * the models are (D2). The root's own children are not here — they are the
   * containers path's job in `listFlat`, and collecting them twice would
   * return two tiles for one folder.
   *
   * Collected unconditionally: the query is applied afterwards, in `listFlat`.
   * Collecting these conditionally on `q` would make a walk's output depend on
   * the query, which `search-cancellation` (one traversal shared across
   * requests) and `listing-tree-cache` (tree snapshot keyed by root alone)
   * both assume is false.
   */
  dirs: DirEntry[]
  /**
   * The walk stopped against its step budget: what it collected is a *prefix*
   * of the tree, and the rest was never looked at.
   *
   * Split from `capped` below, and the wire does not know the difference —
   * `DirListing.truncated` is their OR and stays exactly what it was. The
   * distinction is `listing-tree-cache`'s: its 4.1a rule is that only a
   * **complete** traversal may be persisted, since a partial tree stored as a
   * whole one is indistinguishable from the real thing and permanently wrong.
   * That is a question about the walk, and only this flag answers it — a
   * response cap says nothing about whether the tree was fully seen.
   */
  budgetExhausted: boolean
  /**
   * A response cap cut entries the walk *did* find — the model cap or the
   * folder cap in `listFlat`. The tree may have been traversed in full; only
   * the answer is short. Never a reason to distrust a snapshot.
   */
  capped: boolean
  /**
   * Every directory this walk actually read, by library path, against the
   * `mtimeMs` it had when it was read — D4's per-directory freshness signal and
   * the whole of what revalidation re-checks. Populated by `levelFor`, so a
   * directory that was skipped (an alias already visited, an unreadable one) is
   * absent: revalidation must make exactly the decisions this walk made, and a
   * directory it never opened is not one of them.
   */
  dirMtimes: Map<string, number>
  /**
   * Revalidation only (§4.2): what the snapshot recorded, per directory. A
   * directory whose mtime still matches is answered from here instead of being
   * `readdir`'d, which is what makes the pass cost one `stat` per directory
   * rather than one per entry. Absent on an ordinary walk.
   */
  reuse?: Map<string, ReusedLevel>
  /**
   * The archive-directory layer (D3), threaded to every `listZipEntries` the
   * walk makes so an unchanged archive is never opened — on the walking path
   * and on the revalidation path alike. Absent when no store was supplied.
   */
  zips?: ZipDirCache
}

/** One directory as a snapshot recorded it: when it was read, and what it held. */
interface ReusedLevel {
  mtime: number
  /** Its **direct** children only, in the order the snapshot stored them. */
  children: SnapshotEntry[]
}

/** Spend one walk step; refusing (budget exhausted) stops the walk. */
function takeStep(walk: FlatWalk): boolean {
  if (walk.budget <= 0) {
    walk.budgetExhausted = true
    return false
  }
  walk.budget--
  return true
}

/**
 * One filesystem directory: `fsDir` is read, `browseLibPath` names what is
 * found. Failures name the library path — a miss that described the volume
 * would be a probe of the tree the server just declined to show.
 */
async function listFsDir(
  fsDir: string,
  browseLibPath: string,
  realTop: string,
  walk?: FlatWalk,
): Promise<FsEntry[]> {
  let names
  try {
    names = await readdir(fsDir, { withFileTypes: true })
  } catch {
    throw new ListingError(404, `cannot read directory: ${browseLibPath}`)
  }
  // Code-point order, fixed here rather than left as whatever the filesystem
  // listed (D2). The loop below charges a walk step per entry and breaks at the
  // budget, so an over-budget level keeps the entries `readdir` happened to
  // return first — and that order differs between runtimes and volumes, which
  // would make a bounded walk cut differently on two machines holding the same
  // library. Deliberately not `sortEntries`' `localeCompare`: ICU collation is
  // locale-dependent and cannot promise the same cut either. `sortEntries` still
  // runs on the way out, so the *display* order is unchanged; this only fixes
  // which entries a bound keeps, for the peek and for `listFlat`'s truncation
  // alike.
  names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const entries: FsEntry[] = []
  for (const d of names) {
    if (d.name.startsWith('.')) continue
    // A flat walk pays for every entry it examines, not just the ones it
    // keeps: the stat below is the walk's real per-entry cost, so a folder of
    // a million non-model files has to consume budget too.
    if (walk !== undefined && !takeStep(walk)) break
    const full = join(fsDir, d.name)
    // Confinement, entry by entry — but only for symlinks: a plain entry can
    // only leave the library through an ancestor the descent has already
    // confined, and a 200,000-step search walk cannot afford an lstat chain per
    // entry (design Risks). The dirent's flag is reliable: Node resolves a
    // DT_UNKNOWN with an lstat before answering `isSymbolicLink`.
    if (d.isSymbolicLink()) {
      const real = await realpath(full).catch(() => null)
      if (real === null || !within(realTop, real)) continue
    }
    let s
    try {
      s = await stat(full)
    } catch {
      continue
    }
    const path = posix.join(browseLibPath, d.name)
    // stat (not the dirent) so symlinked directories are followed and listed.
    if (s.isDirectory()) {
      entries.push({ name: d.name, path, fsPath: full, kind: 'dir', size: 0, mtime: s.mtimeMs })
    } else if (/\.zip$/i.test(d.name)) {
      entries.push({ name: d.name, path, fsPath: full, kind: 'zip', size: s.size, mtime: s.mtimeMs })
    } else {
      const format = modelFormat(d.name)
      if (format) {
        entries.push({
          name: d.name,
          path,
          fsPath: full,
          kind: 'model',
          format,
          size: s.size,
          mtime: s.mtimeMs,
        })
      }
    }
  }
  return sortEntries(entries)
}

/**
 * One directory's level for a *flat* walk: `listFsDir`, plus the two things the
 * tree cache needs around it.
 *
 * Recording — every walk notes the directory's library path against the mtime
 * it had when it was read, which is what the snapshot's `dirs` becomes. The
 * mtime is the one the parent's own `stat` already produced (the dirent stat in
 * `listFsDir`, or the root's stat in `gatherFlat`), so an ordinary walk pays
 * nothing extra for it. It is taken *before* the read, deliberately: a
 * directory changed mid-read records the older stamp and is re-read next time,
 * which is the safe direction to be wrong in.
 *
 * Reuse — on the revalidation path the recorded level is returned outright when
 * the directory's mtime has not moved (D4). There the mtime **must** be stat'd
 * fresh rather than taken from the caller: on that path the caller's copy came
 * out of the snapshot, and would compare equal to itself forever.
 */
async function levelFor(
  fsDir: string,
  libPath: string,
  realTop: string,
  walk: FlatWalk,
  mtime: number,
  charge: boolean,
): Promise<FsEntry[]> {
  // The root level is the request's baseline work — the listing a nested browse
  // would do anyway — so it is not charged to the walk budget; everything below
  // it is.
  const charged = charge ? walk : undefined
  if (walk.reuse === undefined) {
    const level = await listFsDir(fsDir, libPath, realTop, charged)
    walk.dirMtimes.set(libPath, mtime)
    return level
  }
  const held = walk.reuse.get(libPath)
  const s = await stat(fsDir).catch(() => null)
  if (s === null) {
    // A directory the snapshot recorded and that is no longer there. Normally
    // unreachable — removing it moves its parent's mtime, so the parent is
    // re-read and this level is never descended into — but reachable inside one
    // granule of the parent's mtime resolution, and the cache is what loses.
    if (held !== undefined) throw new RevalidationError(`directory is gone: ${libPath}`)
    throw new ListingError(404, `cannot read directory: ${libPath}`)
  }
  if (held !== undefined && held.mtime === s.mtimeMs) {
    walk.dirMtimes.set(libPath, s.mtimeMs)
    return reusedLevel(held, fsDir)
  }
  let level
  try {
    level = await listFsDir(fsDir, libPath, realTop, charged)
  } catch (err) {
    if (held !== undefined) throw new RevalidationError(`cannot read directory: ${libPath}`)
    throw err
  }
  walk.dirMtimes.set(libPath, s.mtimeMs)
  return level
}

/**
 * A recorded level as `listFsDir` would have returned it: fresh objects, the
 * bare name the walk prefixes (the snapshot stores the root-relative one, and
 * the library path's basename is the same string), the filesystem path rebuilt
 * under the directory being read now — so a remount is followed rather than
 * remembered — and the same `sortEntries` ordering `listFsDir` ends with.
 */
function reusedLevel(held: ReusedLevel, fsDir: string): FsEntry[] {
  return sortEntries(
    held.children.map((e) => {
      const name = posix.basename(e.path)
      const out: FsEntry = {
        name,
        path: e.path,
        fsPath: join(fsDir, name),
        kind: e.kind,
        size: e.size,
        mtime: e.mtime,
      }
      if (e.format !== undefined) out.format = e.format
      return out
    }),
  )
}

async function listZipDir(
  zipFsPath: string,
  zipLibPath: string,
  prefix: string,
): Promise<DirEntry[]> {
  let zipStat
  try {
    zipStat = await stat(zipFsPath)
  } catch {
    throw new ListingError(404, `cannot read zip: ${zipLibPath}`)
  }
  const zipEntries = await listZipEntries(zipFsPath)
  const norm = prefix === '' ? '' : prefix.endsWith('/') ? prefix : `${prefix}/`

  // A prefix that is itself a *file* entry in the archive is not a directory.
  // If that file is a zip, this is the nested-zip case.
  const exactFile = norm === '' ? undefined : zipEntries.find((e) => e.name === norm.slice(0, -1))
  if (exactFile !== undefined) {
    if (/\.zip$/i.test(exactFile.name)) throw new VPathError('nested zips are unsupported')
    throw new ListingError(400, `not a directory: ${exactFile.name}`)
  }

  const dirs = new Set<string>()
  const entries: DirEntry[] = []
  for (const e of zipEntries) {
    if (!e.name.startsWith(norm)) continue
    const rest = e.name.slice(norm.length)
    if (rest === '') continue
    const slash = rest.indexOf('/')
    if (slash !== -1) {
      dirs.add(rest.slice(0, slash))
      continue
    }
    if (/\.zip$/i.test(rest)) {
      entries.push({
        name: rest,
        path: joinVPath(zipLibPath, e.name),
        kind: 'zip',
        size: e.size,
        mtime: zipStat.mtimeMs,
      })
      continue
    }
    const format = modelFormat(rest)
    if (format) {
      entries.push({
        name: rest,
        path: joinVPath(zipLibPath, e.name),
        kind: 'model',
        format,
        size: e.size,
        mtime: zipStat.mtimeMs,
      })
    }
  }
  for (const d of dirs) {
    entries.push({
      name: d,
      path: joinVPath(zipLibPath, `${norm}${d}`),
      kind: 'dir',
      size: 0,
      mtime: zipStat.mtimeMs,
    })
  }
  return sortEntries(entries)
}

/**
 * Case-insensitive substring match on an entry's whole root-relative name
 * (D1): the query matches anywhere in the path below the search root — the
 * file's own name, any containing folder, or a containing archive. This is the
 * same string the client's live filter matches, so typing and submitting mean
 * the same thing.
 */
function matchesQuery(name: string, q: string): boolean {
  return name.toLowerCase().includes(q)
}

/**
 * A container matches on its **own** name, not its path (D2) — deliberately a
 * different predicate from `matchesQuery`. A folder inside a matching folder is
 * not itself a tile, or one hit would return a subtree of them; its models
 * still come back through the path predicate above.
 */
function matchesOwnName(name: string, q: string): boolean {
  return baseName(name).toLowerCase().includes(q)
}

const KIND_RANK: Record<string, number> = { dir: 0, zip: 1, model: 2 }

function kindRank(kind: DirEntry['kind']): number {
  return KIND_RANK[kind] ?? 9
}

function sortEntries<T extends DirEntry>(entries: T[]): T[] {
  return entries.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name))
}

/**
 * The library path of a request's filesystem half, canonicalised the way the
 * resolver canonicalises it — so an entry's emitted path is a route the client
 * can ask for again, whatever spelling this request arrived in.
 */
function libHalfOf(libPath: string): string {
  return posix.normalize(parseVPath(libPath).fsPath)
}

/**
 * A request carrying an entry half only means something when the filesystem
 * half is an archive. Read as one, a directory raises `EISDIR` from the first
 * `open` and a text file raises `ZipError`, so `/kit!/` answered 500 with an
 * errno and the filesystem path in it — a fault where the request was simply
 * malformed, and a probe of the tree besides.
 *
 * A path that does not stat at all is left alone: that is the zip readers' own
 * 404, and "not found" and "not an archive" are different answers.
 */
async function requireArchive(fsPath: string, libPath: string): Promise<void> {
  const s = await stat(fsPath).catch(() => null)
  if (s === null) return
  if (!s.isFile() || !/\.zip$/i.test(fsPath)) {
    throw new ListingError(400, `not an archive: ${libPath}`)
  }
}

export async function listDir(library: Library, libPath: string): Promise<DirListing> {
  const { fsPath, entry } = await library.resolve(libPath)
  const realTop = library.realTop()
  const libHalf = libHalfOf(libPath)
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null)
    if (s === null) throw new ListingError(404, `no such path: ${libPath}`)
    if (s.isDirectory()) {
      return { path: libPath, entries: wire(await listFsDir(fsPath, libHalf, realTop)) }
    }
    if (/\.zip$/i.test(fsPath)) {
      return { path: libPath, entries: await listZipDir(fsPath, libHalf, '') }
    }
    throw new ListingError(400, `not a directory or zip: ${libPath}`)
  }
  await requireArchive(fsPath, libPath)
  return { path: libPath, entries: await listZipDir(fsPath, libHalf, entry) }
}

/**
 * How many entries a folder tile's preview may examine. A module constant, not
 * an environment knob (D2): a preview is a glance, not a search, and a knob
 * would let one machine's contact sheet disagree with another's.
 */
const PEEK_BUDGET = 64

/**
 * The most models one peek's walk can possibly find: every model it keeps cost
 * it a walk step, so the entry bound above caps the finds too.
 *
 * Exported because the pose-ranked peek asks for exactly this many — that is
 * how "walk to the entry bound rather than stopping at four" is spelled without
 * a second stop rule inside `peekLevel` (`pose-for-every-model` D4). It is also
 * what keeps that peek's single `/poses` request far under the index's
 * thousand-path bound, whatever the folder held.
 */
export const PEEK_MAX_FINDS = PEEK_BUDGET

/**
 * One level of a peek: this level's models in order, then its subdirectories in
 * order, depth-first, until `n` models are found or the walk runs out of
 * budget.
 *
 * Not `walkFsLevel`, which takes a level in kind order — dirs first — and so
 * would reach a subfolder's models before the level's own. Its confinement and
 * cycle guards are replicated here because this recurses over `listFsDir`
 * directly: a subdirectory whose real path leaves the library is neither
 * previewed nor descended into, and a directory already entered under another
 * name is not entered twice.
 *
 * **The depth needs no cap of its own, and this has been checked.** Every level
 * of a descending chain is a *dirent* in its parent, and `listFsDir` spends a
 * `takeStep` on each dirent before it stats anything — so a chain costs one
 * step per level and `PEEK_BUDGET` (64) bounds the recursion as tightly as it
 * bounds the stats. Measured against the real module under Bun: a 500-deep
 * chain of one-subdirectory-each, with a model at every tenth level, returns
 * normally with `at9 … at49` — dead against the budget at depth ~50, never near
 * a stack limit. (`PATH_MAX` is the physical backstop behind that: building the
 * fixture failed with ENOENT at depth 836.)
 */
async function peekLevel(
  level: FsEntry[],
  realTop: string,
  walk: FlatWalk,
  found: FsEntry[],
  n: number,
): Promise<void> {
  for (const e of level) {
    if (found.length >= n) return
    if (e.kind === 'model') found.push(e)
  }
  for (const e of level) {
    if (found.length >= n || walk.budgetExhausted) return
    // Archives met on the way are skipped, never entered (Non-Goals): a
    // preview must not pay a central-directory read per tile.
    if (e.kind !== 'dir') continue
    const real = await realpath(e.fsPath).catch(() => null)
    if (real === null || !within(realTop, real)) continue
    if (walk.visited.has(real)) continue
    walk.visited.add(real)
    let sub
    try {
      sub = await listFsDir(e.fsPath, e.path, realTop, walk)
    } catch {
      continue // unreadable subdirectory: skipped, only an unreadable root fails
    }
    await peekLevel(sub, realTop, walk, found, n)
  }
}

/**
 * Up to `n` models found inside a directory — the contact sheet a folder tile
 * draws (D2). Its own request, never merged into a listing: a listing that
 * computed previews would pay one peek per subdirectory up front, on the cold
 * path, for folders the user may never scroll to (D1).
 *
 * Bounded and brief, so it carries **no cancellation token** and runs to
 * completion when the tile that asked has scrolled away — stated in the
 * requirement, so `search-cancellation`'s rule about abandoned traversals does
 * not reach it.
 *
 * A `walk` is passed down into `listFsDir` for `takeStep` alone: without one a
 * single wide folder reads and stats its whole level before the bound is
 * consulted, and the bound would say nothing about the case it exists for. The
 * walk's `models` and `dirs` stay empty — what a peek keeps is `found`, in the
 * order it found it, rather than the sorted-and-renamed collection `listFlat`
 * builds.
 */
export async function peek(library: Library, libPath: string, n: number): Promise<DirEntry[]> {
  const { fsPath, entry } = await library.resolve(libPath)
  // Neither an archive nor anything inside one is previewed (Non-Goals), and
  // both answer empty rather than refusing: the client then renders "nothing to
  // preview" the same way whatever the tile turned out to be.
  if (entry !== undefined) return []
  const realTop = library.realTop()
  const s = await stat(fsPath).catch(() => null)
  if (s === null) throw new ListingError(404, `no such path: ${libPath}`)
  if (!s.isDirectory()) {
    // Stat'd first, so a *directory* named `x.zip` is walked like any other —
    // the same order `listDir` takes, and the reason it is navigable at all.
    if (/\.zip$/i.test(fsPath)) return []
    // 400, not 404, on the distinction `requireArchive` draws: the path is
    // there, it is simply not a thing that has an inside. A 404 here would
    // claim a file the client can see in its own listing does not exist.
    throw new ListingError(400, `not a directory: ${libPath}`)
  }
  const walk: FlatWalk = {
    budget: PEEK_BUDGET,
    visited: new Set(),
    models: [],
    dirs: [],
    budgetExhausted: false,
    capped: false,
    // A peek is not a walk of the tree and is never snapshotted: it reads
    // `listFsDir` directly rather than through `levelFor`, so nothing ever
    // records into this and nothing ever reads it.
    dirMtimes: new Map(),
  }
  // The root is visited before anything below it is, or a symlink pointing back
  // at it re-enters the level the peek started from.
  walk.visited.add(await realpath(fsPath).catch(() => fsPath))
  const found: FsEntry[] = []
  // Uncaught, unlike the recursion's: an unreadable *root* is the 404 `listDir`
  // gives, while an unreadable subdirectory is skipped.
  const level = await listFsDir(fsPath, libHalfOf(libPath), realTop, walk)
  await peekLevel(level, realTop, walk, found, n)
  return wire(found)
}

async function walkFsLevel(
  level: FsEntry[],
  rel: string,
  walk: FlatWalk,
  realTop: string,
): Promise<void> {
  for (const e of level) {
    if (walk.budgetExhausted) return
    if (e.kind === 'model') {
      walk.models.push({ ...e, name: `${rel}${e.name}` })
    } else if (e.kind === 'dir') {
      // Confinement is decided **before** the push below, not at the visited
      // check after it: the push is deliberately unguarded (see the alias
      // reasoning), so a subdirectory leaving the library would otherwise still
      // be emitted as a tile that the next request refuses. A real path that
      // cannot be read is a confinement that cannot be established, and is
      // skipped the same way.
      const real = await realpath(e.fsPath).catch(() => null)
      if (real === null || !within(realTop, real)) {
        // Revalidation (§4.3): a directory the snapshot recorded whose real
        // path can no longer even be established is the pass failing against a
        // root that is *present* — the case D6 gives to the filesystem. This is
        // also the only way an unreadable **root** surfaces, since `chmod` does
        // not move a directory's mtime: the root's own level is then reused
        // unchanged and it is the children whose `realpath` raises EACCES.
        if (real === null && walk.reuse?.has(e.path) === true) {
          throw new RevalidationError(`cannot reach directory: ${e.path}`)
        }
        continue
      }
      // Pushed before the visited check, and before descending: the spec's rule
      // is every directory under the root whose own name matches, and a
      // directory reached through a symlink alias is one. Deduping it here
      // would make the *aliased* name unfindable, or — when the alias sorts
      // first — make the real folder's name unfindable while the alias stands
      // in for it. The visited set exists to bound the traversal, not to decide
      // which names exist. Guarded on `rel !== ''` because the root's own level
      // is `listFlat`'s containers, and pushing here too would return one
      // folder as two identical tiles.
      if (rel !== '') walk.dirs.push({ ...e, name: `${rel}${e.name}` })
      if (walk.visited.has(real)) continue
      walk.visited.add(real)
      let sub
      try {
        sub = await levelFor(e.fsPath, e.path, realTop, walk, e.mtime, true)
      } catch (err) {
        // A revalidation that cannot be completed is the one failure this catch
        // must not swallow (§4.3): the snapshot recorded this directory, so its
        // becoming unreadable contradicts the cache rather than being a folder
        // the user simply cannot see.
        if (err instanceof RevalidationError) throw err
        continue // unreadable subdirectory: skipped, only an unreadable root fails
      }
      await walkFsLevel(sub, `${rel}${e.name}/`, walk, realTop)
    } else {
      // The archive's filesystem path was confined when `listFsDir` emitted it,
      // so enumerating its names needs no further test here.
      if (rel !== '') walk.dirs.push({ ...e, name: `${rel}${e.name}` })
      await walkZip(e.fsPath, e.path, '', `${rel}${e.name}!/`, walk)
    }
  }
}

/**
 * Flatten one archive under `prefix`: every model beneath it at any depth,
 * plus the immediate directory names at that level. One central-directory read
 * serves both the container tiles and the models (D5).
 *
 * `root` selects the error contract: a walk rooted at the archive reports
 * failures the way `listDir` does, while a zip met partway through a
 * filesystem walk is skipped like an unreadable subdirectory.
 */
async function walkZip(
  zipFsPath: string,
  zipLibPath: string,
  prefix: string,
  namePrefix: string,
  walk: FlatWalk,
  root = false,
): Promise<DirEntry[]> {
  let zipStat, zipEntries
  try {
    zipStat = await stat(zipFsPath)
    // The archive layer (D3), on both the walking and the revalidating path: an
    // archive whose `{mtime, size}` has not moved is answered without being
    // opened, which is the largest single measured win in this change.
    zipEntries = await listZipEntries(zipFsPath, walk.zips)
  } catch (err) {
    if (!root) return [] // unreadable/corrupt zip: skipped like an unreadable subdirectory
    if (err instanceof ZipError) throw err
    throw new ListingError(404, `cannot read zip: ${zipLibPath}`)
  }
  const norm = prefix === '' ? '' : prefix.endsWith('/') ? prefix : `${prefix}/`
  if (root && norm !== '') {
    // A prefix that is itself a file entry is not a directory, and if that
    // file is a zip this is the nested-zip case — same taxonomy as listZipDir.
    const exactFile = zipEntries.find((e) => e.name === norm.slice(0, -1))
    if (exactFile !== undefined) {
      if (/\.zip$/i.test(exactFile.name)) throw new VPathError('nested zips are unsupported')
      throw new ListingError(400, `not a directory: ${exactFile.name}`)
    }
  }
  const dirs = new Set<string>()
  // Every directory *path* below `norm`, not just this level's names: a folder
  // three levels into an archive matches like one three levels into the tree,
  // which is the depth-independence this rule exists for (D2). `dirs` above
  // stays the immediate level, because that is what the container tiles are.
  const interior = new Set<string>()
  for (const e of zipEntries) {
    if (walk.budgetExhausted) break
    if (!e.name.startsWith(norm)) continue
    const rest = e.name.slice(norm.length)
    if (rest === '') continue
    if (!takeStep(walk)) break
    const slash = rest.indexOf('/')
    if (slash !== -1) dirs.add(rest.slice(0, slash))
    for (let i = slash; i !== -1; i = rest.indexOf('/', i + 1)) {
      const d = rest.slice(0, i)
      // A root walk's immediate children are the containers path's job, exactly
      // as `rel === ''` is on the filesystem side; everything deeper is ours.
      if (!root || d.includes('/')) interior.add(d)
    }
    // Only model extensions match — nested zip *file* entries fall out here,
    // while models under a directory named *.zip match like any other.
    const format = modelFormat(rest)
    if (format === undefined) continue
    walk.models.push({
      name: `${namePrefix}${rest}`,
      path: joinVPath(zipLibPath, e.name),
      kind: 'model',
      format,
      size: e.size,
      mtime: zipStat.mtimeMs,
    })
  }
  for (const d of interior) {
    walk.dirs.push({
      name: `${namePrefix}${d}`,
      path: joinVPath(zipLibPath, `${norm}${d}`),
      kind: 'dir',
      size: 0,
      mtime: zipStat.mtimeMs,
    })
  }
  return sortEntries(
    [...dirs].map((d) => ({
      name: d,
      path: joinVPath(zipLibPath, `${norm}${d}`),
      kind: 'dir' as const,
      size: 0,
      mtime: zipStat.mtimeMs,
    })),
  )
}

/**
 * Positive-integer knob from the environment. A missing, malformed, or
 * non-positive value falls back: `Number('20k')` is NaN, and a NaN limit
 * silently disables every comparison that bounds the walk.
 */
function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * Flat listing: the root's immediate dir/zip entries as tiles (plus, when a
 * query is given, every matching container below them), then every model
 * recursively under it, named by root-relative path and ordered by file name
 * (basename, full relative path as tiebreak) — or by relative path when a query
 * is given, so each matching folder's contents stay contiguous (D3). Walk work is bounded by a
 * step budget; the response by a model cap. Either dropping models sets
 * `truncated` — the wire carries the OR of the two and not which one it was;
 * `walkFlat` below is where they are told apart.
 *
 * `query`, when non-blank, narrows the walked models to those whose whole
 * root-relative name contains it case-insensitively — the query matches
 * anywhere in the path below the root (D1) — and narrows containers, the
 * root's own children and every matching directory found below them alike, to
 * those whose *own* name contains it (D2). Both are applied before the caps, so
 * a cap bounds matches rather than raw walk output. Containers carry their own
 * bound, so neither kind can crowd out the other (D4).
 * A blank or whitespace-only query is treated as absent.
 *
 * Which step budget applies depends on that query: a queried walk runs on the
 * search budget, an unqueried one on the (smaller) browse budget — see the
 * `budget` assignment below for why they differ (D5). A truncated response
 * with *no* entries therefore always means budget exhaustion, never the cap:
 * the cap is applied after the query filter, so an empty result cannot trip
 * it. The client's "the search ran out" message depends on that.
 */
export async function listFlat(
  library: Library,
  libPath: string,
  query?: string,
  opts: { folderMatching?: boolean } = {},
  store?: SnapshotStore,
): Promise<DirListing> {
  return (await walkFlat(library, libPath, query, opts, store)).listing
}

/**
 * What one traversal gathered, before any query filter or response cap touched
 * it — the three collections `walkFlat` composes an answer from, plus the
 * per-directory freshness state and whether the walk saw the whole tree.
 *
 * This is exactly what a snapshot stores, and the reason `q` and the search
 * options are absent from the cache key (D1): the walk gathers, the query
 * filters, and nothing below this line has ever seen the query.
 */
interface Gathered {
  /** The root's own immediate dir/zip entries, bare-named and pre-ranked. */
  containers: DirEntry[]
  /** Every container *below* the root level, named by root-relative path. */
  dirs: DirEntry[]
  /** Every model under the root, named by root-relative path. */
  models: DirEntry[]
  /** Directory library path → its `mtimeMs` when this walk read it (D4). */
  dirMtimes: Map<string, number>
  budgetExhausted: boolean
}

/** The traversal itself, with no query, no cap and no snapshot in sight. */
async function gatherFlat(
  library: Library,
  libPath: string,
  budget: number,
  zips?: ZipDirCache,
  reuse?: Map<string, ReusedLevel>,
): Promise<Gathered> {
  const { fsPath, entry } = await library.resolve(libPath)
  const realTop = library.realTop()
  const libHalf = libHalfOf(libPath)
  const walk: FlatWalk = {
    budget,
    visited: new Set(),
    models: [],
    dirs: [],
    budgetExhausted: false,
    capped: false,
    dirMtimes: new Map(),
    reuse,
    zips,
  }
  let containers: DirEntry[]
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null)
    if (s === null) throw new ListingError(404, `no such path: ${libPath}`)
    if (s.isDirectory()) {
      const level = await levelFor(fsPath, libHalf, realTop, walk, s.mtimeMs, false)
      containers = level.filter((e) => e.kind !== 'model')
      walk.visited.add(await realpath(fsPath).catch(() => fsPath))
      await walkFsLevel(level, '', walk, realTop)
    } else if (/\.zip$/i.test(fsPath)) {
      // A root that is an archive keeps no directory freshness state: its own
      // `{mtime, size}` is the signal, and `walkZip`'s `stat` plus the archive
      // layer check it on every pass without help from here.
      containers = await walkZip(fsPath, libHalf, '', '', walk, true)
    } else {
      throw new ListingError(400, `not a directory or zip: ${libPath}`)
    }
  } else {
    // Inside an archive the containers are its immediate *directories*: a
    // nested zip file is not enterable, so offering it as a tile would hand
    // the user a link that 400s on click.
    await requireArchive(fsPath, libPath)
    containers = await walkZip(fsPath, libHalf, entry, '', walk, true)
  }
  return {
    containers,
    dirs: walk.dirs,
    models: walk.models,
    dirMtimes: walk.dirMtimes,
    budgetExhausted: walk.budgetExhausted,
  }
}

/**
 * A gathered walk as a snapshot stores it: one flat array, in the walk's **own
 * emission order**, containers first, then the deeper containers, then the
 * models. Nothing is re-sorted on the way in or on the way out — `partition`
 * hands the three collections back in the order they went, so a cached answer
 * and a walked one are entry-for-entry identical, ordering included. (Sorting
 * here would also be untestable: `readdir` order differs between Bun and Node,
 * so a fixture built to pin an order under vitest asserts nothing about the
 * server — see the testing notes in CLAUDE.md.)
 */
function snapshotEntries(g: Pick<Gathered, 'containers' | 'dirs' | 'models'>): SnapshotEntry[] {
  return [...g.containers, ...g.dirs, ...g.models].map((e) => {
    const out: SnapshotEntry = {
      name: e.name,
      path: e.path,
      kind: e.kind,
      size: e.size,
      mtime: e.mtime,
    }
    if (e.format !== undefined) out.format = e.format
    return out
  })
}

/**
 * The inverse: a stored array back into the three collections, as **fresh**
 * `DirEntry` objects.
 *
 * Fresh is the delta's rule, not a nicety — `applyDisplayNames` mutates emitted
 * entries in place and never clears what it set, so an entry handed out twice
 * would carry the first request's override name into every later answer, across
 * a store removal or a library repoint. (`wire` copies again at the boundary,
 * and a `load` re-parses the file besides; three layers, because the failure is
 * silent and permanent.)
 *
 * The partition is by kind and by whether the stored name carries a `/`. A
 * root-level container is a bare dirent name or a first-level archive
 * directory, neither of which can contain a separator; everything the walk
 * pushed *below* the root level is named by its root-relative path and always
 * does.
 */
function partition(
  entries: readonly SnapshotEntry[],
): Pick<Gathered, 'containers' | 'dirs' | 'models'> {
  const containers: DirEntry[] = []
  const dirs: DirEntry[] = []
  const models: DirEntry[] = []
  for (const e of entries) {
    const out: DirEntry = { name: e.name, path: e.path, kind: e.kind, size: e.size, mtime: e.mtime }
    if (e.format !== undefined) out.format = e.format
    if (e.kind === 'model') models.push(out)
    else if (e.name.includes('/')) dirs.push(out)
    else containers.push(out)
  }
  return { containers, dirs, models }
}

/** A snapshot's `dirs`, indexed for `levelFor`'s reuse check. */
function levelIndex(snapshot: TreeSnapshot): Map<string, ReusedLevel> {
  const byDir = new Map<string, SnapshotEntry[]>()
  for (const e of snapshot.entries) {
    const parent = posix.dirname(e.path)
    const held = byDir.get(parent)
    if (held === undefined) byDir.set(parent, [e])
    else held.push(e)
  }
  const out = new Map<string, ReusedLevel>()
  // Driven from `dirs`, so only a directory the walk actually *read* can be
  // reused. An archive's interior entries group under keys like
  // `/kit.zip!/arms` that no `readdir` ever produced, and are ignored here —
  // archives are revalidated by their own identity, through the D3 layer.
  for (const d of snapshot.dirs) {
    out.set(d.path, { mtime: d.mtime, children: byDir.get(d.path) ?? [] })
  }
  return out
}

function dirRecords(dirMtimes: Map<string, number>): TreeSnapshot['dirs'] {
  return [...dirMtimes].map(([path, mtime]) => ({ path, mtime }))
}

/** Entry-for-entry equality, in order — what "the tree moved" means (§4.2). */
function sameEntries(a: readonly SnapshotEntry[], b: readonly SnapshotEntry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    return (
      x.name === y.name &&
      x.path === y.path &&
      x.kind === y.kind &&
      x.format === y.format &&
      x.size === y.size &&
      x.mtime === y.mtime
    )
  })
}

/**
 * The incremental revalidation pass (§4.2, design D4): one `stat` per recorded
 * directory, a `readdir` only where the mtime moved, and the archive layer
 * answering every unchanged zip without opening it. **Never a background
 * re-walk** — that would reintroduce the cold cost this change exists to
 * remove, off the critical path where nobody can see it.
 *
 * Returns whether anything moved, and **which directories** it was that moved
 * (§6.1): a preview choice is derived from a directory's subtree, so the layer
 * above re-derives the changed directory's and each of its ancestors'. That
 * list is a by-product of the pass — `levelFor` has already stat'd every
 * recorded directory and knows which mtimes it found unchanged — so reporting it
 * costs a comparison rather than a second look.
 *
 * A directory the snapshot recorded and this pass did **not** reach is not in
 * the list, and needs not be: it is gone, and something removed it, which moved
 * its parent's mtime and put the parent in the list instead.
 *
 * Raises `RevalidationError` when the pass cannot be completed against a root
 * that is present — a recorded directory that has become unreadable, or a tree
 * that has outgrown the walk budget — and the caller then invalidates rather
 * than going on serving contradicted entries (§4.3, D6). A root with no
 * snapshot is nothing to revalidate, not a reason to walk one.
 */
export async function revalidateTree(
  library: Library,
  root: string,
  store: SnapshotStore,
): Promise<{ changed: boolean; changedDirs: string[] }> {
  const snapshot = await store.load(root)
  if (snapshot === null) return { changed: false, changedDirs: [] }
  const g = await gatherFlat(
    library,
    root,
    // Not the browse budget: this pass is nobody's request, and a tree that a
    // *search* could reach must stay revalidatable whatever kind of listing
    // last cached it.
    envLimit('MODEL_BROWSER_SEARCH_BUDGET', 200_000),
    store.archiveCache(),
    levelIndex(snapshot),
  )
  if (g.budgetExhausted) throw new RevalidationError(`revalidation did not finish: ${root}`)
  const entries = snapshotEntries(g)
  const changed = !sameEntries(snapshot.entries, entries)
  // A directory whose mtime is not the one recorded — including one the
  // snapshot never recorded at all, which is a folder that has just appeared.
  const before = new Map(snapshot.dirs.map((d) => [d.path, d.mtime]))
  const changedDirs = [...g.dirMtimes]
    .filter(([path, mtime]) => before.get(path) !== mtime)
    .map(([path]) => path)
  await store.save({ root, walkedAt: Date.now(), entries, dirs: dirRecords(g.dirMtimes) })
  return { changed, changedDirs }
}

/**
 * Every model beneath a library path, with no response cap (§6.7, design D7's
 * enumeration note).
 *
 * **Uncapped is not unbounded.** `MODEL_BROWSER_FLAT_CAP` bounds a *listing* —
 * how many tiles an answer may carry — and this is not one: a scope cut to a cap
 * would silently be a different scope, and the caller is about to act on every
 * model in it. The walk's step *budget* still applies, because that bounds the
 * work rather than the answer; a traversal it stops is reported as incomplete
 * rather than refused, and nothing is cached for it (§4.1a).
 *
 * Three ways to answer, cheapest first:
 *
 * 1. A snapshot for this exact path — filter and hand back, no filesystem I/O.
 * 2. A snapshot for an **ancestor** root, which already holds this subtree: the
 *    common case, since the library tab enumerates the root that browsing has
 *    walked. Entries are re-named relative to the path asked about, so this
 *    answer is indistinguishable from a walk of it.
 * 3. No snapshot: walk it as a listing miss walks, on the search budget, and
 *    persist only a traversal that saw the whole tree.
 */
export async function enumerateModels(
  library: Library,
  libPath: string,
  store?: SnapshotStore,
): Promise<{ models: DirEntry[]; complete: boolean; fromSnapshot: boolean }> {
  if (store !== undefined) {
    const exact = await store.load(libPath)
    if (exact !== null) {
      return { models: modelsUnder(partition(exact.entries).models, libPath), complete: true, fromSnapshot: true }
    }
    // Longest first: the nearest enclosing root holds the fewest entries to
    // filter, and every one of them holds this subtree identically.
    const roots = (await store.roots())
      .filter((root) => encloses(root, libPath))
      .sort((a, b) => b.length - a.length)
    for (const root of roots) {
      const snapshot = await store.load(root)
      if (snapshot === null) continue
      return { models: modelsUnder(partition(snapshot.entries).models, libPath), complete: true, fromSnapshot: true }
    }
  }
  const g = await gatherFlat(
    library,
    libPath,
    // The search budget, not the browse one: an enumeration is a deliberate
    // action over a whole subtree, and the smaller budget is sized for the
    // tiles one screen shows.
    envLimit('MODEL_BROWSER_SEARCH_BUDGET', 200_000),
    store?.archiveCache(),
  )
  const complete = !g.budgetExhausted
  if (store !== undefined && complete) {
    await store.save({
      root: libPath,
      walkedAt: Date.now(),
      entries: snapshotEntries(g),
      dirs: dirRecords(g.dirMtimes),
    })
  }
  // Through the same filter as the two cached paths, though a fresh walk's
  // models are all under the root already and already named that way: one rule,
  // so the three answers cannot differ in their naming or in whether they hand
  // out objects the walk still holds.
  return { models: modelsUnder(g.models, libPath), complete, fromSnapshot: false }
}

/** Is `root` at or above `libPath`? Segment-wise, so `/kit` never encloses `/kit2`. */
function encloses(root: string, libPath: string): boolean {
  return root === libPath || libPath.startsWith(root === '/' ? '/' : `${root}/`)
}

/**
 * The models of a gathered set that lie beneath `libPath`, each named the way a
 * walk rooted *there* would name it — by its path relative to that root.
 *
 * Re-naming is what makes a snapshot-served enumeration and a walked one the
 * same answer: a snapshot's names are relative to the root it was walked from,
 * which for an ancestor root is one level too high. Deriving the name from the
 * path is exact rather than approximate — that is precisely how the walk builds
 * it, on both the filesystem side (`${rel}${name}`) and the archive side
 * (`${namePrefix}${rest}`).
 */
function modelsUnder(models: readonly DirEntry[], libPath: string): DirEntry[] {
  // Two separators, because a root can be an archive: everything inside
  // `/kit/box.zip` is addressed `/kit/box.zip!/…`, and a `/` prefix would match
  // none of it — the enumeration of an archive would come back empty, which is
  // a wrong answer rather than a missing feature.
  const prefixes = libPath === '/' ? ['/'] : [`${libPath}/`, `${libPath}!/`]
  const out: DirEntry[] = []
  for (const m of models) {
    if (m.kind !== 'model') continue
    const prefix = prefixes.find((p) => m.path.startsWith(p))
    if (prefix === undefined) continue
    // A fresh object, never the stored one: emission annotates entries in place
    // (the `applyDisplayNames` hazard the delta's copies rule names).
    const copy: DirEntry = {
      name: m.path.slice(prefix.length),
      path: m.path,
      kind: m.kind,
      size: m.size,
      mtime: m.mtime,
    }
    if (m.format !== undefined) copy.format = m.format
    out.push(copy)
  }
  return out
}

/**
 * What a flat listing *was*, beside the listing itself: whether the walk saw
 * the whole tree, and whether a response cap then shortened what it found.
 *
 * Two facts the wire deliberately does not carry — `DirListing.truncated` is
 * their OR, unchanged, because a client showing "the search ran out" has the
 * same thing to say either way. Inside the server they are not one fact:
 *
 * - `budgetExhausted` is a property of the **traversal**. What the walk holds is
 *   a prefix of the tree and the rest was never looked at.
 * - `capped` is a property of the **answer**. The tree may have been walked in
 *   full; only the reply was cut to the model cap or the folder cap.
 *
 * Exported, and not folded back into `listFlat`, for two callers. It is what
 * `flat.test.ts` drives to assert each flag on its own — through `listFlat` the
 * two are indistinguishable, both being `truncated: true` and nothing else. And
 * it is the seam `listing-tree-cache` needs: its 4.1a rule is that only a
 * **complete** traversal may be persisted (a partial tree stored as a whole one
 * is permanently wrong and indistinguishable from the real thing), which is a
 * question about the walk that `truncated` cannot answer — a 501-model folder
 * walked end to end would refuse to cache itself forever. Please do not inline
 * it as an unused indirection.
 *
 * With a `store` it is also §4.1's serving seam. A root that has a snapshot is
 * answered **from it** — no `readdir`, no `stat`, no archive opened — and one
 * that has not is walked and, if the walk saw the whole tree, persisted. The
 * snapshot is keyed by the root alone: `query` and `opts` filter over what it
 * holds exactly as they filter over a live walk, so one cached tree serves
 * every query and both settings of the folder-matching option (D1).
 *
 * `fromSnapshot` says which of the two happened. The caller above this one owns
 * what that means to the user — whether the answer is marked stale and whether
 * a revalidation pass starts — because that is a fact about the *process*, not
 * about this walk.
 */
export async function walkFlat(
  library: Library,
  libPath: string,
  query?: string,
  opts: { folderMatching?: boolean } = {},
  store?: SnapshotStore,
): Promise<{
  listing: DirListing
  budgetExhausted: boolean
  capped: boolean
  fromSnapshot: boolean
}> {
  const q = query?.trim().toLowerCase()
  const hasQuery = q !== undefined && q !== ''
  // Default on: an absent parameter is the shipped predicate, so an old client
  // and a hand-written URL both get what they got before the option existed.
  const folderMatching = opts.folderMatching !== false
  // Confinement was settled when the snapshot was written: only a walk that
  // resolved through the library can have created one, and the key is the
  // library path it resolved. So a served snapshot needs no re-resolution, and
  // that is the point — "touching no directory or archive" is the requirement.
  const snapshot = store === undefined ? null : await store.load(libPath)
  const fromSnapshot = snapshot !== null
  let gathered: Pick<Gathered, 'containers' | 'dirs' | 'models'>
  let budgetExhausted = false
  if (snapshot !== null) {
    gathered = partition(snapshot.entries)
  } else {
    const g = await gatherFlat(
      library,
      libPath,
      // A search affords a far larger walk than a browse (D5): the flat view
      // must render everything it walks as tiles, while a search discards
      // non-matches and returns at most the cap — so its budget buys reach, not
      // payload. 10× default; independently tunable.
      hasQuery
        ? envLimit('MODEL_BROWSER_SEARCH_BUDGET', 200_000)
        : envLimit('MODEL_BROWSER_FLAT_BUDGET', 20000),
      store?.archiveCache(),
    )
    gathered = g
    budgetExhausted = g.budgetExhausted
    // §4.1a: **only a complete traversal is persisted.** The test is
    // `budgetExhausted`, never the wire's `truncated` — that is the OR of this
    // flag and the response caps, and a folder walked end to end whose 501st
    // model the cap dropped would otherwise refuse to cache itself forever. A
    // walk that threw (a cancelled one, when that lands) never reaches this
    // line, so nothing is written and the store's archive layer stays unflushed
    // in memory, which is the same rule stated once.
    if (store !== undefined && !budgetExhausted) {
      await store.save({
        root: libPath,
        walkedAt: Date.now(),
        entries: snapshotEntries(g),
        dirs: dirRecords(g.dirMtimes),
      })
    }
  }
  let containers = gathered.containers
  let models = gathered.models
  let capped = false

  const cap = envLimit('MODEL_BROWSER_FLAT_CAP', 500)
  // Filter before sorting, not after: a search walks up to its own budget
  // (200k steps) but keeps only matches, and the comparator below runs
  // `localeCompare` — collation over the whole walk to return a handful of
  // rows. Discarding first is the same output (a sorted subset equals the
  // sorted set filtered) for a fraction of the comparisons.
  if (hasQuery) {
    containers = containers.filter((e) => matchesOwnName(e.name, q))
    // The option narrows the *model* predicate from the whole relative path to
    // the file's own name; container matching is the other option's business
    // and is unaffected, so the two stay orthogonal.
    const modelMatches = folderMatching ? matchesQuery : matchesOwnName
    models = models.filter((m) => modelMatches(m.name, q))
    // Two predicates on purpose: a model matches anywhere in its path, a
    // container only on its own name (D2).
    containers = [...containers, ...gathered.dirs.filter((d) => matchesOwnName(d.name, q))]
    // Containers normally arrive pre-ranked from `listFsDir` and are never
    // re-sorted here; appending deeper matches to them makes that untrue, so a
    // queried listing sorts the block explicitly. Same kind rank as everywhere
    // else — dirs before zips — with the root-relative path as the tiebreak,
    // which needs no special case for the root's own bare-named children,
    // since a bare name is its own root-relative path (D3).
    containers.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name))
    // Containers get their own bound rather than sharing the model cap, so a
    // fragment matching many folders cannot spend the models' budget (D4).
    const folderCap = envLimit('MODEL_BROWSER_FOLDER_CAP', 50)
    if (containers.length > folderCap) {
      capped = true
      containers.length = folderCap
    }
  }
  // Not sortEntries: its model comparison is the full name, i.e. the relative
  // path — flat ordering is by file name so same-named parts sit together (D2).
  // A queried listing orders by that relative path instead, so each matching
  // folder's contents stay contiguous rather than scattering among every
  // same-named part in the tree — the sort key would otherwise be the one part
  // of the name the user did not type (D3).
  // Sorted on a copy: `partition` mints fresh entry objects, but the array
  // holding them belongs to this call, and sorting a collection in place that
  // some later caller might hand over twice is the kind of thing that is
  // harmless right up until it is not.
  models = [...models].sort(
    hasQuery
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) =>
          baseName(a.name).localeCompare(baseName(b.name)) || a.name.localeCompare(b.name),
  )
  if (models.length > cap) {
    capped = true
    models.length = cap
  }
  const listing: DirListing = { path: libPath, entries: wire([...containers, ...models]) }
  // The wire's `truncated` is the OR of the two, and is exactly what it was
  // before they were told apart: "some models were dropped", whichever bound
  // dropped them.
  if (budgetExhausted || capped) listing.truncated = true
  return { listing, budgetExhausted, capped, fromSnapshot }
}

/**
 * Subdirectory completions for a partial library path (path-bar autocomplete).
 * In and out are library paths; a prefix that is not one, or that resolves
 * outside the library, completes to nothing rather than to a refusal — a path
 * bar is typed one character at a time, and most of those characters name
 * nothing yet.
 */
export async function complete(library: Library, prefix: string): Promise<string[]> {
  if (!prefix.startsWith('/')) return []
  const dirLibPath = prefix.endsWith('/') ? prefix : posix.dirname(prefix)
  const base = prefix.endsWith('/') ? '' : posix.basename(prefix)
  let fsDir
  try {
    fsDir = (await library.resolve(dirLibPath)).fsPath
  } catch {
    return []
  }
  let names
  try {
    names = await readdir(fsDir, { withFileTypes: true })
  } catch {
    return []
  }
  return names
    .filter(
      (d) =>
        d.isDirectory() &&
        // The marker is invisible everywhere, and a dot-prefix would otherwise
        // be the one spelling that revealed it.
        d.name !== MARKER_DIR &&
        d.name.startsWith(base) &&
        (base.startsWith('.') || !d.name.startsWith('.')),
    )
    .map((d) => `${posix.join(dirLibPath, d.name)}/`)
    .sort()
    .slice(0, 20)
}
