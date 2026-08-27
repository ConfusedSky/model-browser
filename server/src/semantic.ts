import { realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  IndexState,
  SemanticTuning,
} from '../../shared/types'
import { modelFormat } from './listing'

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
export type { IndexState }

interface RawStatus {
  ready?: boolean
  elapsed?: number
  collection_root?: string
  covers?: string[]
  /** One shape for every reason a load did not complete — a dict, not a string. */
  failure?: { reason?: string; hint?: string | null; kind?: string } | null
  volume?: { present?: boolean; root?: string; missing?: string | null }
}

let cached: { status: IndexAvailability; at: number } | null = null

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

async function probe(base: string): Promise<IndexAvailability> {
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
    // The index's own words, preferred to any composed here (D4). Reason and
    // hint are separate fields upstream; joined so a caller renders one string.
    detail:
      [raw.failure?.reason, raw.failure?.hint].filter((t) => typeof t === 'string').join(' — ') ||
      undefined,
  }
  // Volume before ready, and the order is the point. A library whose drive is
  // unplugged reports `ready: false` *and* `volume.present: false` — the load
  // could not finish *because* the storage is gone. Checking `ready` first
  // classified the one failure a user fixes in seconds as "starting up", and
  // as "wedged" three minutes later, so the message never mentioned the drive.
  if (raw.volume?.present === false) return { state: 'volume-gone', ...common }
  if (raw.ready !== true) {
    // Any load error means it is not going to finish on its own.
    const wedged = (raw.elapsed ?? 0) > WEDGED_AFTER_S || (raw.failure ?? null) !== null
    return { state: wedged ? 'wedged' : 'warming', ...common }
  }
  return { state: 'ready', ...common }
}

/**
 * Availability, cached per state rather than probed per query (D4). Callers may
 * force a fresh look — the client's explicit retry.
 */
export async function indexStatus(opts: { fresh?: boolean } = {}): Promise<IndexAvailability> {
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
    /**
     * The status the index itself answered with, carried only when the failure
     * was not about availability — an index that is up and refused this
     * request. Its absence is what marks the availability states, which are
     * reported to the client as such.
     */
    readonly upstreamStatus?: number,
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
  pose: IndexPose | null
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
  /** The index's own cap bit — it returned fewer than was asked for (D2). */
  truncated?: boolean
  results: Hit[]
}

/**
 * Default result bound — a default now, not a rule (tuning D1). Ten tiles (the
 * index's own default) is not a grid, and 500 is ~168s of thumbnail I/O.
 */
export const TOP = 60

/** What shapes a query beyond the phrase and the scope — the wire shape. */
export type Tuning = SemanticTuning

/**
 * POST one of the index's scoring routes, with the error contract both of them
 * share. One copy, because the caller's status mapping keys off `upstreamStatus`
 * (`app.ts`) and two routes classifying the same upstream status differently is
 * exactly the drift that mapping exists to prevent.
 */
async function askIndex(route: string, body: unknown): Promise<unknown> {
  const base = baseUrl()
  if (base === null) throw new IndexError('absent', 'semantic index is not configured')
  let res: Response
  try {
    res = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
    const detail = (await res.json().catch(() => null)) as { detail?: unknown } | null
    const message =
      typeof detail?.detail === 'string' ? detail.detail : `index error ${res.status}`
    // The index answered, so it is up: this is a refused request, not an
    // unavailable service. Its status travels with the error so the caller can
    // report it as what it is rather than as availability.
    throw new IndexError('ready', message, res.status)
  }
  return res.json()
}

export async function query(
  text: string,
  scope: string | null,
  tuning: Tuning = {},
): Promise<QueryResult> {
  return (await askIndex('/query', {
    text,
    path: scope ?? undefined,
    // A floor and a count are alternatives: the index ignores `top` when
    // `min_score` is set, so sending both would state a relationship that
    // does not exist (D1).
    ...(tuning.minScore !== undefined
      ? { min_score: tuning.minScore }
      : { top: tuning.top ?? TOP }),
    ...(tuning.raw === true ? { raw: true } : {}),
    ...(tuning.pool !== undefined ? { pool: tuning.pool } : {}),
  })) as QueryResult
}

/** What `/similar` answers with. No `weak` and no `truncated`: the index
 *  publishes neither for neighbours, and inventing them here would hand the UI
 *  a flag that can only ever read `false` (D4/4.7). */
export interface SimilarResult {
  results: Hit[]
}

/**
 * A model's nearest neighbours, drawn from the whole indexed collection.
 *
 * **No `scope` is sent, deliberately** (D4/4.1a). The index's `scope` is
 * optional and defaults to the collection, so this states that default rather
 * than passing a value — and it is where this differs from meaning search, which
 * *is* rooted at the browsed directory. A phrase is a question about a place
 * ("dragons in this kit"); "more like this one" is not, and scoped to the
 * model's own folder it would mostly return that kit's other parts, which is the
 * one answer the user already has on screen.
 *
 * `k` and `pool` are the caller's, forwarded only when it names them. Both are
 * settable on screen now (the side panel's similarity block) and both ride the
 * view's URL; where the caller names neither, the index's own defaults apply and
 * this sends no field for them — absence meaning the default at every layer,
 * which is what keeps "the pooling in force is whatever `serve_api.py --pool`
 * was started with" true for a view that made no choice.
 *
 * A 404 travels back as an `IndexError` carrying that status: the index has
 * never embedded this model, which is a fact about the model rather than about
 * availability, and the only upstream status the UI owns a distinct sentence
 * for.
 */
export async function similar(
  path: string,
  k?: number,
  pool?: Tuning['pool'],
): Promise<SimilarResult> {
  return (await askIndex('/similar', {
    path,
    ...(k !== undefined ? { k } : {}),
    ...(pool !== undefined ? { pool } : {}),
  })) as SimilarResult
}

/**
 * One model path → one tile, from *this* server's stat rather than from
 * anything the index said about the file (D3): a hit carries neither mtime nor
 * size, and a tile needs both, since thumbnails are keyed path+mtime.
 *
 * Shared by the hit join below and by the similarity route's anchor, which is
 * the query model itself — the index excludes it from its own ranking, so it
 * reaches a tile through here rather than through a hit. `null` for anything
 * that is not a file now: a model can be deleted after it is embedded, and that
 * is an ordinary outcome rather than an error.
 *
 * Containment is the *caller's* to check, and deliberately so: a hit's
 * `rel_path` is untrusted data from another process, while the anchor has
 * already been through `scopeWithin`, which compares resolved real paths and is
 * the stronger test. Re-running the prefix form over it here would reject a
 * legitimate anchor under a symlinked collection root.
 */
export async function modelEntryAt(full: string, name: string): Promise<DirEntry | null> {
  const s = await stat(full).catch(() => null)
  if (s === null || !s.isFile()) return null
  return {
    name,
    path: full,
    kind: 'model' as const,
    format: modelFormat(full),
    size: s.size,
    mtime: s.mtimeMs,
  }
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
 *
 * Three maps out, all keyed alike — by the resolved absolute path the entry
 * carries. The scores travel beside the entries rather than on them because
 * `DirEntry` is what every listing route returns, and a score field there would
 * be `undefined` for every directory, zip entry and flat-search hit in the app
 * (confidence-scores-on-tiles D1). Sharing the key with the entry is what makes
 * "no entry" and "no score" one fact: the drop above removes a stale hit from
 * all three at once, so no surface can render a number for a tile that is not
 * there.
 */
export async function hitsToEntries(
  hits: Hit[],
  collectionRoot: string,
): Promise<{
  entries: DirEntry[]
  poses: Record<string, IndexPose>
  scores: Record<string, IndexScore>
}> {
  const poses: Record<string, IndexPose> = {}
  const scores: Record<string, IndexScore> = {}
  const settled = await Promise.all(
    hits.map(async (h): Promise<DirEntry | null> => {
      // `rel_path` is the join key and the only field trusted for it: this is
      // data from another process, and `resolve` normalising `..` is what stops
      // a hit naming a file outside the collection. The index's absolute `path`
      // is ignored — preferring it would also undo D4's remount reasoning by
      // trusting a mount point this app resolved for itself.
      const full = resolve(collectionRoot, h.rel_path)
      if (full !== collectionRoot && !full.startsWith(collectionRoot + sep)) return null
      const entry = await modelEntryAt(full, h.rel_path)
      if (entry === null) return null
      if (h.pose !== null) poses[full] = h.pose
      scores[full] = { score: h.score, z: h.z }
      return entry
    }),
  )
  return { entries: settled.filter((e) => e !== null), poses, scores }
}
