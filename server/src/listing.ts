import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { DirEntry, DirListing } from '../../shared/types'
import { joinVPath, parseVPath, VPathError } from './vpath'
import { listZipEntries } from './zip'

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

async function listFsDir(path: string): Promise<DirEntry[]> {
  let names
  try {
    names = await readdir(path, { withFileTypes: true })
  } catch {
    throw new ListingError(404, `cannot read directory: ${path}`)
  }
  const entries: DirEntry[] = []
  for (const d of names) {
    if (d.name.startsWith('.')) continue
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
