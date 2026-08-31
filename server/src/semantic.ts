import { realpath, stat } from 'node:fs/promises'
import { posix, resolve, sep } from 'node:path'
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  IndexState,
  SemanticTuning,
} from '../../shared/types'
import { type Library, LibraryError } from './library'
import { listDir, modelFormat } from './listing'

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
    // Absence normalised at the boundary: the index reports a root it does not
    // have as JSON `null` (a failed load answers every volume field null), and
    // a null crossing into `string | undefined` land passed every `===
    // undefined` guard and walked as far as `libPathOf(null)` before crashing
    // — which took every peek down with it once peeks probed the index
    // (posedFirstPeek). `??` makes the wire's "no root" the type's.
    collectionRoot: raw.collection_root ?? undefined,
    covers: raw.covers ?? undefined,
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
 * What the index says about itself, `collectionRoot` still absolute — the index
 * is another process with its own view of the volume, and the path it names is
 * the one it must be asked about (D6). Cached per state rather than probed per
 * query (D4); callers may force a fresh look — the client's explicit retry.
 */
async function rawStatus(opts: { fresh?: boolean }): Promise<IndexAvailability> {
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

/** What the UI says when the index covers a tree this library does not hold. */
const OUTSIDE_LIBRARY = 'the index covers a location outside the library'

/**
 * Availability as the client reads it: the collection root mapped through the
 * library, so what reaches the wire is a path the user can navigate to (D6).
 *
 * A collection outside the library has no library path at all, and that is
 * reported as absence with a reason rather than as an absolute path nothing in
 * this app could address — `indexCovers` then withholds every scope affordance,
 * and the side panel names the situation.
 *
 * The mapping is applied on the way out, per call, rather than cached with the
 * probe: the raw status is what the TTL protects, and a library that becomes
 * ready after a status was cached must not be described by a mapping made
 * before it existed. The cost is one `realpath` of a path already in the page
 * cache — the same call `scopeWithin` makes beside it.
 */
async function mapCollectionRoot(
  library: Library,
  raw: IndexAvailability,
): Promise<IndexAvailability> {
  const abs = raw.collectionRoot
  if (abs === undefined) return raw
  const { collectionRoot: _abs, ...rest } = raw
  // Nothing to map *through* yet. The library's own state is what the client is
  // being told about in that case, so no reason is invented here.
  if ((await library.state()).state !== 'ready') return rest
  const real = await realpath(abs).catch(() => abs)
  try {
    return { ...rest, collectionRoot: library.libPathOf(real) }
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err
    return { ...rest, detail: OUTSIDE_LIBRARY }
  }
}

/**
 * Both halves of availability at once, from one probe: what the client is told
 * (`status`, whose `collectionRoot` is a library path) and what the index has
 * to be asked about (`collectionRootFs`, absolute and its own).
 *
 * One call rather than two so a scoring route cannot pair a library path with
 * an absolute root read a TTL apart.
 */
export async function probeStatus(
  library: Library,
  opts: { fresh?: boolean } = {},
): Promise<{ status: IndexAvailability; collectionRootFs: string | undefined }> {
  const raw = await rawStatus(opts)
  return { status: await mapCollectionRoot(library, raw), collectionRootFs: raw.collectionRoot }
}

/** Availability for the status route: the wire half of `probeStatus`. */
export async function indexStatus(
  library: Library,
  opts: { fresh?: boolean } = {},
): Promise<IndexAvailability> {
  return (await probeStatus(library, opts)).status
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
 * A scope this app may ask the index about: a library path, in — a real
 * filesystem path, out. The index is another process with its own view of the
 * volume, so the absolute path is what it must be told (D6), and this is the
 * one place that translation happens.
 *
 * Virtual paths never leave this server (D7) — the index rejects `!/` and no
 * archive-resident model has an embedding, so the affordance is withheld rather
 * than the failure reported. A path the library refuses is `null` for the same
 * reason rather than an error: out of the library is out of scope, and the
 * caller withholds the affordance instead of reporting a fault.
 *
 * Compared by resolved path, not string prefix: the library lives on removable
 * media and a remount moves the mount point without changing the tree (D4).
 */
export async function scopeWithin(
  library: Library,
  libPath: string,
  collectionRoot: string,
): Promise<string | null> {
  if (libPath.includes('!/')) return null
  let fsPath: string
  try {
    fsPath = (await library.resolve(libPath)).fsPath
  } catch (err) {
    if (err instanceof LibraryError) return null
    throw err
  }
  const [real, root] = await Promise.all([
    realpath(fsPath).catch(() => null),
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
  /**
   * How many models cleared the floor before `top` cut them. Optional: an
   * older index does not send it, and the client renders nothing rather than
   * failing (floor-and-count-compose D9).
   */
  matched?: number
  results: Hit[]
}

/**
 * Fallback count for a tuning naming no bound at all. Sixty tiles because ten
 * is not a grid and 500 is ~168s of thumbnail I/O; it is a floor under this
 * server's own requests, not a default the UI shows — `TUNING_DEFAULTS` is
 * where the user-facing count lives. The index no longer defaults `top` to ten
 * (`mini-classify` add7fd4), so a request omitting every bound would otherwise
 * be bounded only by the index's cap.
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
    // Each bound forwarded on its own presence, because the two compose in the
    // index (`rank()` filters by the floor, then caps what survived) and this
    // app's job is to report which the user set, not to choose between them.
    // The `TOP` fallback is for a tuning naming neither bound — no caller
    // produces one today, and an unbounded query would be the whole collection.
    ...(tuning.minScore !== undefined ? { min_score: tuning.minScore } : {}),
    ...(tuning.top !== undefined ? { top: tuning.top } : {}),
    ...(tuning.minScore === undefined && tuning.top === undefined
      ? { top: TOP }
      : {}),
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
 *
 * Three arguments because a tile's address and its label are different facts
 * here: `full` is the filesystem path this server stats, `libPath` is what the
 * tile is *addressed* by (a library path — the only kind that reaches the wire,
 * D2), and `name` is what it reads as, which is the path relative to the
 * collection for a hit and stays exactly what it was before the addresses
 * changed.
 */
export async function modelEntryAt(
  full: string,
  libPath: string,
  name: string,
): Promise<DirEntry | null> {
  const s = await stat(full).catch(() => null)
  if (s === null || !s.isFile()) return null
  return {
    name,
    path: libPath,
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
 * happens behind a query. Confining it costs one `realpath` beside that stat —
 * the same per-hit bound, and the same call every other route makes.
 *
 * A hit that resolves to nothing is dropped without failing the search. Two
 * independently-cached views of one removable volume drift by construction —
 * the index's `id` is a stem plus 6 hex of the relative path, so a moved file
 * is simply a different model to it — and that is a normal outcome rather than
 * an error.
 *
 * Three maps out, all keyed alike — by the **library path** the entry carries,
 * which is what the client looks a tile up by (`useThumbnails` reads
 * `poses[entry.path]`). The scores travel beside the entries rather than on
 * them because `DirEntry` is what every listing route returns, and a score
 * field there would be `undefined` for every directory, zip entry and
 * flat-search hit in the app (confidence-scores-on-tiles D1). Sharing the key
 * with the entry is what makes "no entry" and "no score" one fact: the drop
 * above removes a stale hit from all three at once, so no surface can render a
 * number for a tile that is not there.
 *
 * The collection root's own library path is computed **once**, before the hits
 * are walked (D6): the per-hit cost is the single `stat` a tile needs, and
 * `realpath`ing per hit would put the number of index results back into the
 * filesystem work a query does. A collection root the library does not hold has
 * no library path, and then no hit inside it can have one either — the answer
 * is empty rather than a set of tiles nothing in this app could address.
 */
export async function hitsToEntries(
  library: Library,
  hits: Hit[],
  collectionRoot: string,
): Promise<{
  entries: DirEntry[]
  poses: Record<string, IndexPose>
  scores: Record<string, IndexScore>
}> {
  const poses: Record<string, IndexPose> = {}
  const scores: Record<string, IndexScore> = {}
  const realTop = library.realTop()
  let collectionLibPath: string
  try {
    collectionLibPath = library.libPathOf(await realpath(collectionRoot).catch(() => collectionRoot))
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err
    return { entries: [], poses, scores }
  }
  const settled = await Promise.all(
    hits.map(async (h): Promise<DirEntry | null> => {
      // `rel_path` is the join key and the only field trusted for it: this is
      // data from another process, and `resolve` normalising `..` is what stops
      // a hit naming a file outside the collection. The index's absolute `path`
      // is ignored — preferring it would also undo D4's remount reasoning by
      // trusting a mount point this app resolved for itself.
      const full = resolve(collectionRoot, h.rel_path)
      if (full !== collectionRoot && !full.startsWith(collectionRoot + sep)) return null
      // Inside the collection is not yet inside the library: a symlink in the
      // indexed tree resolves wherever it points, and the index followed it
      // when it embedded the file. Confined the way every other route is
      // confined (D3), so a hit cannot be named and scored on a surface where
      // `/api/file` refuses the very same path. `realpath` rather than `stat`,
      // so the single stat a tile costs stays the query's per-hit bound.
      const real = await realpath(full).catch(() => null)
      if (real === null) return null
      if (real !== realTop && !real.startsWith(realTop + sep)) return null
      // The same `rel_path`, joined onto the collection's library path instead
      // of onto its filesystem path — one hit, two addresses, from one string.
      const libPath = posix.join(collectionLibPath, h.rel_path)
      const entry = await modelEntryAt(full, libPath, h.rel_path)
      if (entry === null) return null
      if (h.pose !== null) poses[libPath] = h.pose
      scores[libPath] = { score: h.score, z: h.z }
      return entry
    }),
  )
  return { entries: settled.filter((e) => e !== null), poses, scores }
}

/**
 * The most paths one `/poses` request may carry — the index's own bound on the
 * call (`pose-for-every-model` §1.1). A larger set is chunked rather than
 * refused here: this server decides what it wants poses for, and a directory
 * holding more than a thousand models is a listing, not a malformed request.
 *
 * A peek can never reach it — its finds are bounded by `PEEK_MAX_FINDS` (64),
 * which is why a contact sheet is one request whatever it walked.
 */
const POSES_MAX = 1024

/** The `/poses` answer: one entry per path asked about, `null` where the index
 *  holds the model but has no orientation for it. */
interface PosesAnswer {
  poses?: Record<string, IndexPose | null>
}

/**
 * Poses for real filesystem paths, as the index speaks them. A pure pose-cache
 * lookup upstream — no embedding and no GPU — so the cost is the round trip and
 * nothing else, and a set past the bound costs one more of those rather than a
 * second traversal here.
 */
async function askPoses(paths: readonly string[]): Promise<Record<string, IndexPose | null>> {
  const out: Record<string, IndexPose | null> = {}
  for (let i = 0; i < paths.length; i += POSES_MAX) {
    const answer = (await askIndex('/poses', {
      paths: paths.slice(i, i + POSES_MAX),
    })) as PosesAnswer
    Object.assign(out, answer.poses ?? {})
  }
  return out
}

/**
 * The index's orientation for models this server already knows about, keyed by
 * the **library path** each was named by — the key `hitsToEntries` hands back
 * and the one the client looks a tile up under (D2).
 *
 * Confined per path exactly as a hit is, through the call the scoring routes
 * already make: `scopeWithin` refuses a virtual path (nothing inside an archive
 * is embedded, D7), a path the library will not resolve, and a path resolving
 * outside the collection — so a model that is a symlink out of the library is
 * dropped, never an error and never asked about. Confinement is a property of
 * each path, so one bad one costs the others nothing.
 *
 * Two library paths can resolve to one real path (an in-library alias) and the
 * index knows only the target, so the pose it answers with is given to both:
 * the join is a map from real path to every library path that named it, rather
 * than a pair of parallel arrays.
 *
 * Every `IndexError` is swallowed into an empty answer — availability states
 * and refusals alike. A pose is advisory, the tile renders at its default
 * framing without one, and no surface that asks for poses may fail because the
 * index did; that is the whole of D2's "a listing must stay index-independent".
 *
 * The per-path `realpath` of the collection root inside `scopeWithin` is
 * deliberate duplication of one page-cached syscall per model: sharing the
 * translator with the scoring routes is worth more than saving it, and the
 * round trip below dominates either way.
 */
export async function posesForPaths(
  library: Library,
  libPaths: readonly string[],
  collectionRoot: string,
): Promise<Record<string, IndexPose>> {
  const poses: Record<string, IndexPose> = {}
  if (libPaths.length === 0) return poses
  // Resolved in parallel, joined in the caller's order: what goes on the wire
  // must not depend on which `realpath` happened to finish first.
  const reals = await Promise.all(libPaths.map((p) => scopeWithin(library, p, collectionRoot)))
  const byReal = new Map<string, string[]>()
  libPaths.forEach((libPath, i) => {
    const real = reals[i]
    if (real === undefined || real === null) return
    const named = byReal.get(real)
    if (named === undefined) byReal.set(real, [libPath])
    else named.push(libPath)
  })
  if (byReal.size === 0) return poses
  let answered: Record<string, IndexPose | null>
  try {
    answered = await askPoses([...byReal.keys()])
  } catch (err) {
    if (err instanceof IndexError) return poses
    throw err
  }
  for (const [real, named] of byReal) {
    const pose = answered[real]
    // Absent and null are one fact — the index holds no orientation for this
    // model — and the key is left out rather than set to null: `poses[path]`
    // reads as "no pose" either way, and a present-but-null key would make
    // "has a pose" two tests everywhere it is asked.
    if (pose === undefined || pose === null) continue
    for (const libPath of named) poses[libPath] = pose
  }
  return poses
}

/**
 * Every pose the index holds for one directory's models, keyed by library path
 * (D2) — the listing-wide supply of the fact a search hit carries as a rider.
 *
 * The directory is listed through `listDir`, the machinery `/api/dir` itself
 * answers with, so the models asked about are exactly the models the client is
 * showing and there is no second walk to drift from it. That listing happens
 * **before** the index is consulted, deliberately: a path that is missing, or
 * is a file rather than a directory, must answer 404/400 whether or not the
 * index is up, and probing first would make this route's path semantics depend
 * on another process's availability. The cost of that ordering is one `readdir`
 * of a directory the client has just listed — page-cached — when the index
 * turns out to have nothing to say.
 *
 * An index that is absent, warming, wedged or volume-gone, or whose collection
 * does not cover this location, answers `{}` — the same answers a search gets,
 * which the client reads as "no poses", leaving every tile exactly as it
 * renders today. Read through `probeStatus`, so this route and the scoring
 * routes cannot disagree about which state the index is in.
 */
export async function posesForDir(
  library: Library,
  dirPath: string,
  opts: { fresh?: boolean } = {},
): Promise<Record<string, IndexPose>> {
  const listing = await listDir(library, dirPath)
  const { status, collectionRootFs } = await probeStatus(library, opts)
  if (status.state !== 'ready' || collectionRootFs === undefined) return {}
  return posesForPaths(
    library,
    listing.entries.filter((e) => e.kind === 'model').map((e) => e.path),
    collectionRootFs,
  )
}
