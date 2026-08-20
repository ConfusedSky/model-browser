import { realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirEntry } from '../../shared/types'

/**
 * Client for the semantic index — a separate service (`mini-classify`), started
 * by hand, that answers on 127.0.0.1:8077. Only this server talks to it: the
 * guard refuses cross-origin requests and never emits CORS, all client I/O goes
 * through ApiClient, and the hit→tile join needs listing data that lives here
 * (D1).
 *
 * `fetch` and `AbortSignal.timeout` only — the Hono app must still run on Node
 * unchanged.
 */
const DEFAULT_BASE = 'http://127.0.0.1:8077'
const PROBE_TIMEOUT_MS = 2000
const QUERY_TIMEOUT_MS = 30_000

/** Past this, a load has plainly gone wrong: warming becomes wedged (D4). */
const WEDGED_AFTER_S = 180

function baseUrl(): string | null {
  const raw = process.env.MODEL_BROWSER_INDEX
  if (raw === undefined) return DEFAULT_BASE
  return raw.trim() === '' ? null : raw.trim() // cleared = feature off
}

/**
 * The four states, each read from the wire rather than guessed (D4):
 * - `absent` — connection refused. The only one `/status` cannot report.
 * - `warming` — answered with `ready: false`, or 503'd a query. ~16s for SigLIP.
 * - `volume-gone` — loaded, but its library's storage is not mounted. The
 *   likeliest failure on removable media, and the one a user fixes in seconds.
 * - `ready` — answers queries.
 *
 * `wedged` is `warming` that has gone on too long; it is reported separately so
 * the UI can stop implying that waiting will help.
 */
export type IndexState = 'ready' | 'warming' | 'wedged' | 'volume-gone' | 'absent'

export interface IndexStatus {
  state: IndexState
  /** Present when the index answered at all. */
  collectionRoot?: string
  /** Extensions the index can hold — read, never assumed here (D3). */
  covers?: string[]
  elapsed?: number
  /** The index's own words when it has them; preferred to ours (D4). */
  detail?: string
}

interface RawStatus {
  ready?: boolean
  elapsed?: number
  collection_root?: string
  covers?: string[]
  failure?: string | null
  volume?: { present?: boolean; root?: string; missing?: string | null }
}

let cached: { status: IndexStatus; at: number } | null = null

/** How long a state is trusted before re-probing. Warming re-checks often
 *  enough to become usable without a reload; ready is checked rarely because
 *  nothing about it is urgent (D4). */
const TTL_MS: Record<IndexState, number> = {
  ready: 30_000,
  warming: 2000,
  wedged: 30_000,
  'volume-gone': 10_000,
  absent: 10_000,
}

async function probe(base: string): Promise<IndexStatus> {
  let raw: RawStatus
  try {
    const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!res.ok) return { state: 'absent' }
    raw = (await res.json()) as RawStatus
  } catch {
    // Refused, unreachable, or too slow to be useful: nobody started it.
    return { state: 'absent' }
  }
  const common = {
    collectionRoot: raw.collection_root,
    covers: raw.covers,
    elapsed: raw.elapsed,
    detail: raw.failure ?? undefined,
  }
  if (raw.ready !== true) {
    const wedged = (raw.elapsed ?? 0) > WEDGED_AFTER_S || typeof raw.failure === 'string'
    return { state: wedged ? 'wedged' : 'warming', ...common }
  }
  if (raw.volume?.present === false) return { state: 'volume-gone', ...common }
  return { state: 'ready', ...common }
}

/**
 * Availability, cached per state rather than probed per query (D4). Callers may
 * force a fresh look — the client's explicit retry.
 */
export async function indexStatus(opts: { fresh?: boolean } = {}): Promise<IndexStatus> {
  const base = baseUrl()
  if (base === null) return { state: 'absent' }
  const now = Date.now()
  if (!opts.fresh && cached !== null && now - cached.at < TTL_MS[cached.status.state]) {
    return cached.status
  }
  const status = await probe(base)
  cached = { status, at: now }
  return status
}

/** Test seam: forget what we think we know about the index. */
export function resetIndexStatus(): void {
  cached = null
}

export class IndexError extends Error {
  constructor(
    readonly state: IndexState,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A scope this app may ask the index about: a real path inside the collection.
 * Virtual paths never leave this server (D7) — the index rejects `!/` and no
 * archive-resident model has an embedding, so the affordance is withheld rather
 * than the failure reported.
 *
 * Compared by resolved path, not string prefix: the library lives on removable
 * media and a remount moves the mount point without changing the tree (D4).
 */
export async function scopeWithin(path: string, collectionRoot: string): Promise<string | null> {
  if (path.includes('!/')) return null
  const [real, root] = await Promise.all([
    realpath(path).catch(() => null),
    realpath(collectionRoot).catch(() => collectionRoot),
  ])
  if (real === null) return null
  if (real !== root && !real.startsWith(`${root}/`)) return null
  return real
}

export interface Hit {
  id: string
  path: string
  rel_path: string
  name: string
  score: number
  z: number
  pose: {
    up: [number, number, number]
    azimuth_zero: [number, number, number]
    source: string
    confidence: number
    front: { view: number; azimuth_deg: number; elevation_deg: number } | null
  } | null
}

export interface Scope {
  path: string | null
  status: 'indexed' | 'partial' | 'unindexed'
  n_indexed: number
  n_scanned: number
  covers: string[]
}

export interface QueryResult {
  scope: Scope
  weak: boolean
  results: Hit[]
}

/**
 * One text query. `top` is this app's own bound (D8), never the index's default
 * of 10: ten tiles is not a grid, and 500 would be ~168s of thumbnail I/O.
 */
export const TOP = 60

export async function query(text: string, scope: string | null): Promise<QueryResult> {
  const base = baseUrl()
  if (base === null) throw new IndexError('absent', 'semantic index is not configured')
  let res: Response
  try {
    res = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, path: scope ?? undefined, top: TOP }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
  } catch {
    resetIndexStatus()
    throw new IndexError('absent', 'the semantic index is not answering')
  }
  if (res.status === 503) {
    // Raced the probe while SigLIP loads — the warming state, not a failure.
    resetIndexStatus()
    throw new IndexError('warming', 'the semantic index is still loading')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
    const detail = typeof body?.detail === 'string' ? body.detail : `index error ${res.status}`
    throw new IndexError('ready', detail)
  }
  return (await res.json()) as QueryResult
}

/**
 * Turn hits into tiles using *this* server's view of the tree, never the
 * index's description of a model (D3).
 *
 * A hit carries `rel_path` and no mtime or size, and a tile needs both —
 * thumbnails are keyed path+mtime. So each hit is stat'd, at most once, bounded
 * by the number returned (`TOP`) and never by the size of the tree: no walk
 * happens behind a query.
 *
 * A hit that resolves to nothing is dropped without failing the search. Two
 * independently-cached views of one removable volume drift by construction —
 * the index's `id` is a stem plus 6 hex of the relative path, so a moved file
 * is simply a different model to it — and that is a normal outcome rather than
 * an error.
 */
export async function hitsToEntries(
  hits: Hit[],
  collectionRoot: string,
): Promise<{ entries: DirEntry[]; poses: Record<string, Hit['pose']>; dropped: number }> {
  const poses: Record<string, Hit['pose']> = {}
  const settled = await Promise.all(
    hits.map(async (h): Promise<DirEntry | null> => {
      const full = h.path.startsWith('/') ? h.path : join(collectionRoot, h.rel_path)
      const s = await stat(full).catch(() => null)
      if (s === null || !s.isFile()) return null
      if (h.pose !== null) poses[full] = h.pose
      const format = /\.([^.]+)$/.exec(full)?.[1]?.toLowerCase()
      return {
        name: h.rel_path,
        path: full,
        kind: 'model' as const,
        format: format === 'stl' || format === '3mf' || format === 'obj' ? format : undefined,
        size: s.size,
        mtime: s.mtimeMs,
      }
    }),
  )
  const entries = settled.filter((e) => e !== null)
  return { entries, poses, dropped: settled.length - entries.length }
}
