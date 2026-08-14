import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { baseName } from '../../shared/names'
import type { DirEntry, DirListing } from '../../shared/types'
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

function modelFormat(name: string): 'stl' | '3mf' | 'obj' | undefined {
  const m = MODEL_EXT.exec(name)
  return m ? (m[1]!.toLowerCase() as 'stl' | '3mf' | 'obj') : undefined
}

interface FlatWalk {
  /** Walk steps left: every directory entry examined costs 1. */
  budget: number
  /** Realpaths of directories already entered — cycle guard and alias dedup. */
  visited: Set<string>
  models: DirEntry[]
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

async function listFsDir(path: string, walk?: FlatWalk): Promise<DirEntry[]> {
  let names
  try {
    names = await readdir(path, { withFileTypes: true })
  } catch {
    throw new ListingError(404, `cannot read directory: ${path}`)
  }
  const entries: DirEntry[] = []
  for (const d of names) {
    if (d.name.startsWith('.')) continue
    // A flat walk pays for every entry it examines, not just the ones it
    // keeps: the stat below is the walk's real per-entry cost, so a folder of
    // a million non-model files has to consume budget too.
    if (walk !== undefined && !takeStep(walk)) break
    const full = join(path, d.name)
    let s
    try {
      s = await stat(full)
    } catch {
      continue
    }
    // stat (not the dirent) so symlinked directories are followed and listed.
    if (s.isDirectory()) {
      entries.push({ name: d.name, path: full, kind: 'dir', size: 0, mtime: s.mtimeMs })
    } else if (/\.zip$/i.test(d.name)) {
      entries.push({ name: d.name, path: full, kind: 'zip', size: s.size, mtime: s.mtimeMs })
    } else {
      const format = modelFormat(d.name)
      if (format) {
        entries.push({ name: d.name, path: full, kind: 'model', format, size: s.size, mtime: s.mtimeMs })
      }
    }
  }
  return sortEntries(entries)
}

async function listZipDir(zipPath: string, prefix: string): Promise<DirEntry[]> {
  let zipStat
  try {
    zipStat = await stat(zipPath)
  } catch {
    throw new ListingError(404, `cannot read zip: ${zipPath}`)
  }
  const zipEntries = await listZipEntries(zipPath)
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
        path: joinVPath(zipPath, e.name),
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
        path: joinVPath(zipPath, e.name),
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
      path: joinVPath(zipPath, `${norm}${d}`),
      kind: 'dir',
      size: 0,
      mtime: zipStat.mtimeMs,
    })
  }
  return sortEntries(entries)
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  const rank: Record<string, number> = { dir: 0, zip: 1, model: 2 }
  return entries.sort(
    (a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.name.localeCompare(b.name),
  )
}

export async function listDir(vpath: string): Promise<DirListing> {
  const { fsPath, entry } = parseVPath(vpath)
  if (!isAbsolute(fsPath)) throw new ListingError(400, 'path must be absolute')
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null)
    if (s === null) throw new ListingError(404, `no such path: ${fsPath}`)
    if (s.isDirectory()) return { path: vpath, entries: await listFsDir(fsPath) }
    if (/\.zip$/i.test(fsPath)) return { path: vpath, entries: await listZipDir(fsPath, '') }
    throw new ListingError(400, `not a directory or zip: ${fsPath}`)
  }
  return { path: vpath, entries: await listZipDir(fsPath, entry) }
}

async function walkFsLevel(level: DirEntry[], rel: string, walk: FlatWalk): Promise<void> {
  for (const e of level) {
    if (walk.truncated) return
    if (e.kind === 'model') {
      walk.models.push({ ...e, name: `${rel}${e.name}` })
    } else if (e.kind === 'dir') {
      const real = await realpath(e.path).catch(() => null)
      if (real === null || walk.visited.has(real)) continue
      walk.visited.add(real)
      let sub
      try {
        sub = await listFsDir(e.path, walk)
      } catch {
        continue // unreadable subdirectory: skipped, only an unreadable root fails
      }
      await walkFsLevel(sub, `${rel}${e.name}/`, walk)
    } else {
      await walkZip(e.path, '', `${rel}${e.name}!/`, walk)
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
  zipPath: string,
  prefix: string,
  namePrefix: string,
  walk: FlatWalk,
  root = false,
): Promise<DirEntry[]> {
  let zipStat, zipEntries
  try {
    zipStat = await stat(zipPath)
    zipEntries = await listZipEntries(zipPath)
  } catch (err) {
    if (!root) return [] // unreadable/corrupt zip: skipped like an unreadable subdirectory
    if (err instanceof ZipError) throw err
    throw new ListingError(404, `cannot read zip: ${zipPath}`)
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
  for (const e of zipEntries) {
    if (walk.truncated) break
    if (!e.name.startsWith(norm)) continue
    const rest = e.name.slice(norm.length)
    if (rest === '') continue
    if (!takeStep(walk)) break
    const slash = rest.indexOf('/')
    if (slash !== -1) dirs.add(rest.slice(0, slash))
    // Only model extensions match — nested zip *file* entries fall out here,
    // while models under a directory named *.zip match like any other.
    const format = modelFormat(rest)
    if (format === undefined) continue
    walk.models.push({
      name: `${namePrefix}${rest}`,
      path: joinVPath(zipPath, e.name),
      kind: 'model',
      format,
      size: e.size,
      mtime: zipStat.mtimeMs,
    })
  }
  return sortEntries(
    [...dirs].map((d) => ({
      name: d,
      path: joinVPath(zipPath, `${norm}${d}`),
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
 * Flat listing: the root's immediate dir/zip entries as tiles, then every
 * model recursively under it, named by root-relative path and ordered by file
 * name (basename, full relative path as tiebreak). Walk work is bounded by a
 * step budget; the response by a model cap. Either dropping models sets
 * `truncated`.
 */
export async function listFlat(vpath: string): Promise<DirListing> {
  const { fsPath, entry } = parseVPath(vpath)
  if (!isAbsolute(fsPath)) throw new ListingError(400, 'path must be absolute')
  const walk: FlatWalk = {
    budget: envLimit('MODEL_BROWSER_FLAT_BUDGET', 20000),
    visited: new Set(),
    models: [],
    truncated: false,
  }
  let containers: DirEntry[]
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null)
    if (s === null) throw new ListingError(404, `no such path: ${fsPath}`)
    if (s.isDirectory()) {
      // The root level is the request's baseline work — the listing a nested
      // browse would do anyway — so it is not charged to the walk budget.
      const level = await listFsDir(fsPath)
      containers = level.filter((e) => e.kind !== 'model')
      walk.visited.add(await realpath(fsPath).catch(() => fsPath))
      await walkFsLevel(level, '', walk)
    } else if (/\.zip$/i.test(fsPath)) {
      containers = await walkZip(fsPath, '', '', walk, true)
    } else {
      throw new ListingError(400, `not a directory or zip: ${fsPath}`)
    }
  } else {
    // Inside an archive the containers are its immediate *directories*: a
    // nested zip file is not enterable, so offering it as a tile would hand
    // the user a link that 400s on click.
    containers = await walkZip(fsPath, entry, '', walk, true)
  }

  const cap = envLimit('MODEL_BROWSER_FLAT_CAP', 500)
  // Not sortEntries: its model comparison is the full name, i.e. the relative
  // path — flat ordering is by file name so same-named parts sit together (D2).
  walk.models.sort(
    (a, b) => baseName(a.name).localeCompare(baseName(b.name)) || a.name.localeCompare(b.name),
  )
  if (walk.models.length > cap) {
    walk.truncated = true
    walk.models.length = cap
  }
  const listing: DirListing = { path: vpath, entries: [...containers, ...walk.models] }
  if (walk.truncated) listing.truncated = true
  return listing
}

/** Subdirectory completions for a partial path (path-bar autocomplete). */
export async function complete(prefix: string): Promise<string[]> {
  if (!isAbsolute(prefix)) return []
  const dir = prefix.endsWith('/') ? prefix : dirname(prefix)
  const base = prefix.endsWith('/') ? '' : basename(prefix)
  let names
  try {
    names = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return names
    .filter(
      (d) =>
        d.isDirectory() &&
        d.name.startsWith(base) &&
        (base.startsWith('.') || !d.name.startsWith('.')),
    )
    .map((d) => `${join(dir, d.name)}/`)
    .sort()
    .slice(0, 20)
}
