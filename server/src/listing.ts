import { readdir, realpath, stat } from 'node:fs/promises'
import { join, posix, sep } from 'node:path'
import { baseName } from '../../shared/names'
import type { DirEntry, DirListing } from '../../shared/types'
import { MARKER_DIR, type Library } from './library'
import { joinVPath, parseVPath, VPathError } from './vpath'
import { ZipError, listZipEntries } from './zip'

export class ListingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

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
  truncated: boolean
}

/** Spend one walk step; refusing (budget exhausted) marks the walk truncated. */
function takeStep(walk: FlatWalk): boolean {
  if (walk.budget <= 0) {
    walk.truncated = true
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
  return { path: libPath, entries: await listZipDir(fsPath, libHalf, entry) }
}

async function walkFsLevel(
  level: FsEntry[],
  rel: string,
  walk: FlatWalk,
  realTop: string,
): Promise<void> {
  for (const e of level) {
    if (walk.truncated) return
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
      if (real === null || !within(realTop, real)) continue
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
        sub = await listFsDir(e.fsPath, e.path, realTop, walk)
      } catch {
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
    zipEntries = await listZipEntries(zipFsPath)
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
    if (walk.truncated) break
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
 * `truncated`.
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
): Promise<DirListing> {
  const q = query?.trim().toLowerCase()
  const hasQuery = q !== undefined && q !== ''
  // Default on: an absent parameter is the shipped predicate, so an old client
  // and a hand-written URL both get what they got before the option existed.
  const folderMatching = opts.folderMatching !== false
  const { fsPath, entry } = await library.resolve(libPath)
  const realTop = library.realTop()
  const libHalf = libHalfOf(libPath)
  const walk: FlatWalk = {
    // A search affords a far larger walk than a browse (D5): the flat view
    // must render everything it walks as tiles, while a search discards
    // non-matches and returns at most the cap — so its budget buys reach, not
    // payload. 10× default; independently tunable.
    budget: hasQuery
      ? envLimit('MODEL_BROWSER_SEARCH_BUDGET', 200_000)
      : envLimit('MODEL_BROWSER_FLAT_BUDGET', 20000),
    visited: new Set(),
    models: [],
    dirs: [],
    truncated: false,
  }
  let containers: DirEntry[]
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null)
    if (s === null) throw new ListingError(404, `no such path: ${libPath}`)
    if (s.isDirectory()) {
      // The root level is the request's baseline work — the listing a nested
      // browse would do anyway — so it is not charged to the walk budget.
      const level = await listFsDir(fsPath, libHalf, realTop)
      containers = level.filter((e) => e.kind !== 'model')
      walk.visited.add(await realpath(fsPath).catch(() => fsPath))
      await walkFsLevel(level, '', walk, realTop)
    } else if (/\.zip$/i.test(fsPath)) {
      containers = await walkZip(fsPath, libHalf, '', '', walk, true)
    } else {
      throw new ListingError(400, `not a directory or zip: ${libPath}`)
    }
  } else {
    // Inside an archive the containers are its immediate *directories*: a
    // nested zip file is not enterable, so offering it as a tile would hand
    // the user a link that 400s on click.
    containers = await walkZip(fsPath, libHalf, entry, '', walk, true)
  }

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
    walk.models = walk.models.filter((m) => modelMatches(m.name, q))
    // Two predicates on purpose: a model matches anywhere in its path, a
    // container only on its own name (D2).
    containers = [...containers, ...walk.dirs.filter((d) => matchesOwnName(d.name, q))]
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
      walk.truncated = true
      containers.length = folderCap
    }
  }
  // Not sortEntries: its model comparison is the full name, i.e. the relative
  // path — flat ordering is by file name so same-named parts sit together (D2).
  // A queried listing orders by that relative path instead, so each matching
  // folder's contents stay contiguous rather than scattering among every
  // same-named part in the tree — the sort key would otherwise be the one part
  // of the name the user did not type (D3).
  walk.models.sort(
    hasQuery
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) =>
          baseName(a.name).localeCompare(baseName(b.name)) || a.name.localeCompare(b.name),
  )
  if (walk.models.length > cap) {
    walk.truncated = true
    walk.models.length = cap
  }
  const listing: DirListing = { path: libPath, entries: wire([...containers, ...walk.models]) }
  if (walk.truncated) listing.truncated = true
  return listing
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
