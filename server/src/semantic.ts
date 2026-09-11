import { realpath, stat } from 'node:fs/promises'
import { basename, posix, resolve, sep } from 'node:path'
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  IndexState,
  SemanticTuning,
} from '../../shared/types'
import { POSES_MAX } from '../../shared/types'
export { POSES_MAX }
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

/**
 * What a `/poses` call may cost, and deliberately not `QUERY_TIMEOUT_MS`. A
 * query is a thing the user asked for and will wait on; a pose is advisory —
 * it rides behind a listing the client is already showing, and every folder
 * tile on screen asks for one through `posedFirstPeek`. A stalling index held
 * on the query budget would make each of those tiles wait half a minute for an
 * answer that is allowed to be empty, which is the opposite of the delta's
 * "the preview never waits on the index".
 *
 * The probe's own budget, because it bounds the same kind of call: upstream a
 * `/poses` is a pose-cache lookup with no GPU and no lock behind it
 * (`pose-for-every-model` §1.1), so an index that has not answered in two
 * seconds is not busy, it is not answering. A timeout lands in `askIndex`'s
 * network catch, which is exactly the right classification — empty poses and a
 * forgotten status, so the next probe looks again.
 */
const POSES_TIMEOUT_MS = 2000

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

/**
 * The one thing every body this module reads has to be before it is read: a
 * non-null, non-array object.
 *
 * `res.json()` succeeding is not the same as an answer arriving. `null`, a
 * bare number and a bare string are all valid JSON, and every one of them
 * makes the very next property read — `raw.collection_root`, `answer.poses`,
 * `raw.status` — a `TypeError` rather than an `undefined`. That throw lands
 * outside `askIndex`'s parse `try` and outside the `IndexError` catches that
 * are the whole of "a listing may never be made to fail by the index", so it
 * escaped as far as a 500 on a peek and an emptied pose wave.
 *
 * Arrays are excluded even though their property reads answer `undefined`
 * rather than throwing: an array is not any shape this module ever asked for,
 * and admitting one made `probe` read `[]` as a status whose every field was
 * absent — `ready !== true`, so an index answering garbage was reported as
 * `warming`, a state that says waiting will help.
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A pose's two direction fields: three numbers, no fewer and no more. Arity is
 *  half the check, because the client indexes them (`up[0]`, `up[1]`, `up[2]`). */
function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
}

/**
 * Whether a pose the index sent is a pose at all.
 *
 * `IndexPose` is another process's JSON, and until here nothing checked that it
 * was: a string, an `up` of the wrong arity, or a member that is not a number
 * all crossed this server untouched and reached the client, which reads
 * `pose.up` positionally (`client/src/three/pose.ts`, `axisOf`) and orients a
 * model by whatever it finds. One validator at the boundary, applied wherever a
 * pose enters — hits (`hitsToEntries`), `/poses` answers (`askPoses`), `/under`
 * models (`modelsUnder`) — so a malformed pose is "no pose" at every one of
 * them rather than an error at any: a pose is advisory, and the tile renders at
 * its default framing without one (D2).
 *
 * `front` is admitted absent as well as `null` — the client reads it through
 * `?.` and defaults both angles — but a *present* `front` must be the shape it
 * claims, since that is the one the angles are read out of positionally too.
 */
export function isIndexPose(v: unknown): v is IndexPose {
  if (!isObject(v)) return false
  if (!isVec3(v.up) || !isVec3(v.azimuth_zero)) return false
  if (typeof v.source !== 'string' || typeof v.confidence !== 'number') return false
  const front = v.front
  if (front === null || front === undefined) return true
  if (!isObject(front)) return false
  return (
    typeof front.view === 'number' &&
    typeof front.azimuth_deg === 'number' &&
    typeof front.elevation_deg === 'number'
  )
}

interface RawStatus {
  // Typed as the wire actually is: the index spells "not there" as JSON null
  // (a failed load answers every root field null), so every field here admits
  // it — which is what forces the `??` normalisation below and lets the
  // compiler catch the next field someone forwards raw. `?` alone hid two
  // crashes (collection_root reached libPathOf(null); elapsed rendered "(0s)").
  ready?: boolean | null
  elapsed?: number | null
  collection_root?: string | null
  covers?: string[] | null
  /** One shape for every reason a load did not complete — a dict, not a string. */
  failure?: { reason?: string; hint?: string | null; kind?: string } | null
  volume?: { present?: boolean | null; root?: string | null; missing?: string | null } | null
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
  let parsed: unknown
  try {
    const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!res.ok) return { state: 'absent' }
    parsed = await res.json()
  } catch {
    // Refused, unreachable, or too slow to be useful: nobody started it.
    return { state: 'absent' }
  }
  // A 200 carrying literal `null` parses without complaint and is *not* a
  // status: every read below (`raw.collection_root` first) throws a TypeError
  // on it, outside the catch above and outside every `IndexError` catch in this
  // module, so one such body took down whatever asked — `posedFirstPeek` and
  // the pose wave included. An index that answered something other than an
  // object has not told us what state it is in, which is the same as not
  // answering.
  if (!isObject(parsed)) return { state: 'absent' }
  const raw = parsed as RawStatus
  const common = {
    // Absence normalised at the boundary: the index reports a root it does not
    // have as JSON `null` (a failed load answers every volume field null), and
    // a null crossing into `string | undefined` land passed every `===
    // undefined` guard and walked as far as `libPathOf(null)` before crashing
    // — which took every peek down with it once peeks probed the index
    // (posedFirstPeek). `??` makes the wire's "no root" the type's.
    collectionRoot: raw.collection_root ?? undefined,
    covers: raw.covers ?? undefined,
    elapsed: raw.elapsed ?? undefined,
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
 * The probe currently in flight, if any — shared by every caller that would
 * otherwise open one of its own.
 *
 * The cache above is only written once a probe *resolves*, so callers that
 * arrive during one all miss it. That is the ordinary case rather than a race:
 * a folder grid brings its tiles on screen together, and every one of them
 * reads the index's state (`posedFirstPeek`) before it decides how to walk —
 * so a screenful of folders opened a `/status` connection per tile to learn
 * the single fact they were all waiting for.
 *
 * Cleared as soon as the probe settles, so the memo never outlives the request
 * it belongs to and the TTL alone decides when the next one is taken.
 */
let inFlight: Promise<IndexAvailability> | null = null

/**
 * Which "era" of knowledge about the index the cache belongs to, bumped by
 * everything that invalidates a look already on the wire.
 *
 * Without it the cache is written in *settle* order rather than in *start*
 * order, and the two differ exactly when it matters. Two probes overlap — a
 * memoised one and the client's explicit `fresh` retry, which deliberately does
 * not join it — the fresh one comes back `ready`, and then the older one settles
 * on `warming` and overwrites it. The user pressed retry, the index answered
 * that it was up, and the next read said it was still loading. The same shape
 * defeats `resetIndexStatus`: it drops the memo so the *next* caller looks
 * again, but a probe started before the thing we just learned could still land
 * its stale answer in the cache afterwards.
 *
 * A generation rather than a timestamp because what makes an answer stale here
 * is an event, not an interval — `at` already carries the interval, and a
 * `fresh` look and the memoised one it raced share a millisecond routinely.
 */
let generation = 0

/** One probe, its answer written to the cache the TTL protects. `at` is the
 *  moment the look was *decided on*, not the moment it came back — the TTL has
 *  always been measured from there.
 *
 *  The write is conditional on the generation this look was *started* under
 *  still being current: an answer whose question has since been superseded is
 *  still returned to whoever awaited it, and simply is not remembered. */
function look(base: string, at: number): Promise<IndexAvailability> {
  const born = generation
  return probe(base).then((status) => {
    if (born === generation) cached = { status, at }
    return status
  })
}

/**
 * What the index says about itself, `collectionRoot` still absolute — the index
 * is another process with its own view of the volume, and the path it names is
 * the one it must be asked about (D6). Cached per state rather than probed per
 * query (D4); callers may force a fresh look — the client's explicit retry.
 *
 * That retry is the one caller that never joins the in-flight probe: its whole
 * point is a look taken *after* the user asked for one, and a probe already on
 * the wire was started before. It still writes the cache everyone else reads.
 */
async function rawStatus(opts: { fresh?: boolean }): Promise<IndexAvailability> {
  const base = baseUrl()
  if (base === null) return { state: 'absent' }
  const now = Date.now()
  if (opts.fresh === true) {
    // The retry is a new era, not a second reader of the old one: every look
    // already on the wire was started before the user asked, so none of them
    // may write the cache this one is about to.
    generation++
    return look(base, now)
  }
  if (cached !== null && now - cached.at < TTL_MS[cached.status.state]) {
    return cached.status
  }
  if (inFlight !== null) return inFlight
  const started = look(base, now)
  inFlight = started
  // Identity-guarded: `resetIndexStatus` can drop the memo mid-probe, and this
  // settle must not then clear whatever look replaced it.
  const clear = (): void => {
    if (inFlight === started) inFlight = null
  }
  started.then(clear, clear)
  return started
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

/**
 * What the probe memo currently holds, or `undefined` — **and never a probe of
 * its own**. Synchronous, so it cannot become one by accident.
 *
 * `probeStatus` is the reader for anyone who *needs* an answer: it looks when
 * the memo is cold or stale, and the wait is the price of the question. This is
 * the reader for a caller that only wants to know whether an answer is already
 * lying around — emission-time annotation filling (`listing-tree-cache` §6.9),
 * whose whole contract is that an index which is absent, warming or wedged
 * costs a listing *nothing*, "nothing" including the probe. A cold memo is not
 * a ready index here; it is no answer, and the fill declines.
 *
 * **A state gate, not a freshness gate** (round-3 review, finding 4). The
 * requirement's words are "an index whose memoised probe is not ready" — a
 * property of the last known *state*, not of the memo's age — and this used to
 * apply `TTL_MS` as well, so a `ready` verdict older than 30 s made every
 * listing decline to fill until some other surface happened to re-probe. In a
 * browse-only session nothing else probes at all: the client asks
 * `/api/semantic/status` at startup and then the user browses, so the feature
 * switched itself off half a minute in and the pop-in it deletes came back.
 * Honouring the TTL here would only be safe if this reader could *refresh* the
 * memo, and refreshing is exactly what it may not do.
 *
 * **What limits a wedge, then, is the answer rather than the age.** Every way
 * the index can fail to answer a call routes through `askIndex`'s
 * `notAnswering`, which calls `resetIndexStatus` — so one failed ask drops the
 * memo to cold and the *next* fill declines, and goes on declining until
 * something that is allowed to probe takes a fresh look. That was noted as a
 * happy accident when 6.9 landed (task 6.9a); it is the designed wedge-limiter
 * now, it is what this reader leans on in place of the TTL, and it has a cell.
 *
 * Reading does not refresh the memo — a listing must not extend the life of a
 * verdict it declined to take, and with the TTL gone there is no life to extend.
 *
 * The consequence, stated so nobody reads it as a bug: emission fills nothing
 * until something else has probed, so the very first listing of a cold server
 * emits as it always did — and in the running app that costs nothing, because
 * the client asks `/api/semantic/status` at startup, before any listing a user
 * sees.
 *
 * `collectionRootFs` is the index's own absolute path, unmapped: the memo holds
 * the raw status, and `mapCollectionRoot` is applied per call by whoever is
 * telling a *client* about it. The fill is not — it asks the index about paths.
 */
export function memoisedStatus():
  | { status: IndexAvailability; collectionRootFs: string | undefined }
  | undefined {
  if (cached === null) return undefined
  return { status: cached.status, collectionRootFs: cached.status.collectionRoot }
}

/** Availability for the status route: the wire half of `probeStatus`. */
export async function indexStatus(
  library: Library,
  opts: { fresh?: boolean } = {},
): Promise<IndexAvailability> {
  return (await probeStatus(library, opts)).status
}

/**
 * Test seam, and `askIndex`'s answer to a network failure: forget what we think
 * we know about the index. The in-flight memo goes with the cache — a probe
 * started before the thing we just learned must not be what the next caller is
 * handed. Anyone already awaiting it still gets its answer; only the next
 * caller looks again.
 *
 * Dropping the memo is not enough on its own: the probe it referred to is still
 * running, and would otherwise write its pre-reset answer into the cache when it
 * settles — the very answer this call exists to forget. The generation bump is
 * what makes the forgetting stick.
 *
 * **`askIndex`'s call of this is emission-time filling's wedge-limiter** (§6.9,
 * round-3 finding 4). `memoisedStatus` gates the fill on the last known *state*
 * and no longer on the memo's age, so this is what stops a wedged or vanished
 * index being asked once per listing forever: one failed call forgets the
 * `ready` verdict, and the next fill declines until a surface that is allowed to
 * probe looks again. It was noted as an accident when 6.9 landed (task 6.9a) and
 * is a designed property now — do not "tidy" the reset out of `notAnswering`
 * without moving the limit somewhere else first.
 */
export function resetIndexStatus(): void {
  generation++
  cached = null
  inFlight = null
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
  return (await scopeDetail(library, libPath, collectionRoot)).real
}

/**
 * The other direction, for the scope the index *reports back*: a library path,
 * or `null`.
 *
 * `scopeWithin` hands the index a real filesystem path and the index echoes
 * that string verbatim in the scope of its answer, so what comes back names a
 * place on the operator's machine — `/run/media/…` — and putting it on the wire
 * names the host to every viewer, whatever the deployment declares
 * (`feature-report`, *No host location reaches a viewer*). One rule rather than
 * a fifth `hostDetails` branch: the scope on the wire is a library path
 * everywhere, like every other path this app answers with (D2).
 *
 * `null` for anything that has no library path: a scope the index reported as
 * absent, a value that is not a string (the fields inside the index's `scope`
 * are unchecked JSON — see `query`), and a real path outside the library. That
 * last one is not a fault to report: a query sent with no scope comes back
 * scoped to the *collection* root, which may sit above or beside the library
 * top, and a scope the viewer cannot browse to is not theirs to be told about.
 *
 * The `realpath` before `libPathOf` is `mapCollectionRoot`'s, for its reason:
 * `libPathOf` compares against the library's resolved top, so an unresolved
 * spelling would fail containment. It is a no-op on a value this server handed
 * over (already real) and it is what makes the *unscoped* case work, where the
 * string is the index's own spelling of its collection root.
 */
export async function scopeLibPath(library: Library, path: unknown): Promise<string | null> {
  if (typeof path !== 'string') return null
  const real = await realpath(path).catch(() => path)
  try {
    return library.libPathOf(real)
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err
    return null
  }
}

/**
 * Why a path was excluded, for the one caller that has to tell the two kinds
 * apart (`posesAsked`, §6.9 / round-3 finding 5).
 *
 * - **`structural`** — the exclusion is a settled fact about the tree and this
 *   collection root, and no round trip and no retry would change it: a virtual
 *   path (nothing inside an archive is embedded, D7), or a model that resolves
 *   cleanly to somewhere outside the collection. "The index has nothing for
 *   this" is a true statement about such a path, so recording it as a negative
 *   is honest and is exactly the standing cost §6.9 removes.
 * - **`transient`** — the exclusion is this server failing to *look*: the
 *   library refused the path (`LibraryError`, which `resolve` also raises while
 *   the library itself is not ready — an unplugged volume), or the `realpath`
 *   did not come back. Nothing about the index was learned, so nothing about the
 *   index may be written down.
 *
 * The distinction is invisible to every other caller, which is why `scopeWithin`
 * keeps its `string | null` shape: to a peek or a search hit, out of scope is out
 * of scope.
 */
type ScopeMiss = 'structural' | 'transient'

async function scopeDetail(
  library: Library,
  libPath: string,
  collectionRoot: string,
): Promise<{ real: string | null; miss?: ScopeMiss }> {
  if (libPath.includes('!/')) return { real: null, miss: 'structural' }
  let fsPath: string
  try {
    fsPath = (await library.resolve(libPath)).fsPath
  } catch (err) {
    if (err instanceof LibraryError) return { real: null, miss: 'transient' }
    throw err
  }
  const [real, root] = await Promise.all([
    realpath(fsPath).catch(() => null),
    realpath(collectionRoot).catch(() => collectionRoot),
  ])
  if (real === null) return { real: null, miss: 'transient' }
  if (real !== root && !real.startsWith(`${root}/`)) return { real: null, miss: 'structural' }
  return { real }
}

export interface Hit {
  id: string
  path: string
  rel_path: string
  name: string
  score: number
  z: number
  /**
   * `unknown`, and not `IndexPose | null`, for `RawStatus`' reason: this is
   * another process's JSON and the declared shape was never checked. Typed as
   * the contract read, a malformed pose type-checked its way to the client,
   * which reads `up` positionally. `isIndexPose` is what turns it into one.
   */
  pose: unknown
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
 * The classification for every way the index can fail to *say* something —
 * unreachable, a body that never parses, a body shaped like nothing this
 * module asked for. One constructor because the pairing is the contract: the
 * status is forgotten alongside the error, so the next probe looks again
 * rather than trusting a `ready` the index has just contradicted.
 *
 * Applied by `askIndex` to whole bodies, and by the typed callers (`query`,
 * `similar`) to a body that is an object but is missing the very field the
 * route exists to carry — an index that cannot produce its route's shape has
 * not answered that route.
 */
function notAnswering(): IndexError {
  resetIndexStatus()
  return new IndexError('absent', 'the semantic index is not answering')
}

/**
 * POST one of the index's routes, with the error contract they share. One copy,
 * because the caller's status mapping keys off `upstreamStatus` (`app.ts`) and
 * two routes classifying the same upstream status differently is exactly the
 * drift that mapping exists to prevent.
 *
 * How long to wait is the *caller's*, because that is the one thing the routes
 * do not share: a scoring route answers something the user asked for and is
 * given `QUERY_TIMEOUT_MS`, while `/poses` is advisory and is given far less
 * (`POSES_TIMEOUT_MS`). Everything past the wait — what a refusal, a 503 and an
 * unreachable service each mean — stays common.
 */
async function askIndex(
  route: string,
  body: unknown,
  timeoutMs: number = QUERY_TIMEOUT_MS,
): Promise<unknown> {
  const base = baseUrl()
  if (base === null) throw new IndexError('absent', 'semantic index is not configured')
  let res: Response
  try {
    res = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A timeout aborts the fetch, so it lands in the catch below with every
      // other way the index can fail to answer: empty poses, and a forgotten
      // status so the next probe looks rather than trusting a stale `ready`.
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw notAnswering()
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
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    // The body is read inside a `try` for the same reason the request is, and
    // it is a *second* one because the headers arriving is not the answer: a
    // 200 whose JSON does not parse, and a 200 whose body stalls until
    // `AbortSignal.timeout` aborts the read, both fail here rather than above.
    // Neither is an `IndexError`, and `posesForPaths` and `modelsUnder` catch
    // `IndexError` and nothing else — so a bare `SyntaxError` or `AbortError`
    // escaping this call would 500 a peek and empty a pose wave's whole
    // listing, against "silence → walk". An index that cannot finish saying
    // what it means is an index that is not answering, and is treated as one,
    // forgotten status and all.
    throw notAnswering()
  }
  // Parsing is not answering, and the gap between them is a `TypeError` waiting
  // in every caller. A 200 whose body is literal `null` parses perfectly and
  // then makes `answer.poses` (`askPoses`) and `raw.status` (`modelsUnder`)
  // throw — *outside* the catch above and outside the `IndexError` catches
  // those callers are built on, so it escaped verbatim: a 500 on the peek, an
  // emptied pose wave. Caught here rather than at each caller so the three
  // routes cannot come to disagree about what a body-shaped-like-nothing means,
  // which is `askIndex`' whole reason for being one function.
  if (!isObject(parsed)) throw notAnswering()
  return parsed
}

export async function query(
  text: string,
  scope: string | null,
  tuning: Tuning = {},
): Promise<QueryResult> {
  const raw = (await askIndex('/query', {
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
  })) as Partial<QueryResult>
  // An object body is not yet this route's answer: `results` feeds
  // `hitsToEntries`' map and `scope` is read field by field on the way to the
  // wire, so a body missing either would throw in the route handler, outside
  // every `IndexError` catch — a 500 for what is really an index talking
  // nonsense. The fields *inside* a present scope stay unchecked: wrong-typed
  // ones serialize oddly but crash nothing.
  if (!Array.isArray(raw.results) || !isObject(raw.scope)) throw notAnswering()
  return raw as QueryResult
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
  const raw = (await askIndex('/similar', {
    path,
    ...(k !== undefined ? { k } : {}),
    ...(pool !== undefined ? { pool } : {}),
  })) as Partial<SimilarResult>
  // `query`'s reason: `results` is the field the route exists to carry, and a
  // body without an array there would throw in `hitsToEntries`, not here.
  if (!Array.isArray(raw.results)) throw notAnswering()
  return raw as SimilarResult
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
  // Format first, and `null` without it: `kind: 'model'` is assigned only
  // through `MODEL_EXT`'s three extensions everywhere on the wire (`ModelFormat`,
  // shared/types.ts; file-frame-spindle D2), and the client's `formatOfEntry`
  // throws on a model entry it cannot classify. A hit, a peek candidate or an
  // anchor naming some other file is dropped the way a moved-away one is — it
  // could not be thumbnailed or posed anyway.
  const format = modelFormat(full)
  if (format === undefined) return null
  const s = await stat(full).catch(() => null)
  if (s === null || !s.isFile()) return null
  return {
    name,
    path: libPath,
    kind: 'model' as const,
    format,
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
 *
 * The containment prefix is built from a **normalised** root, in the same one
 * place, and that is not cosmetic: the root arrives as the index spelled it in
 * `/status`, and a `serve_api.py` started with a trailing slash reports one.
 * `resolve` puts the model at `<root>/a.stl` while the untouched string makes
 * the prefix `<root>//`, which nothing matches — so *every* hit failed
 * containment and a search that the index answered came back empty, with no
 * surface reporting why. `resolve` and not `realpath`: it is a pure string
 * normalisation, so the spelling the hits are joined onto and stat'd at stays
 * the caller's, and the symlink question is settled where it already was — the
 * per-hit `realpath` against the library's top just below.
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
  // The one spelling of the root everything below is measured against.
  const root = resolve(collectionRoot)
  let collectionLibPath: string
  try {
    collectionLibPath = library.libPathOf(await realpath(root).catch(() => root))
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err
    return { entries: [], poses, scores }
  }
  const settled = await Promise.all(
    hits.map(async (h): Promise<DirEntry | null> => {
      // The *array* was gated where the cast happened (`query`/`similar`);
      // its elements are still another process's JSON. A hit that is not an
      // object naming a string `rel_path` has no join key — `resolve` throws
      // on a non-string — and is dropped the way a hit that resolves to
      // nothing is.
      if (!isObject(h) || typeof h.rel_path !== 'string') return null
      // `rel_path` is the join key and the only field trusted for it: this is
      // data from another process, and `resolve` normalising `..` is what stops
      // a hit naming a file outside the collection. The index's absolute `path`
      // is ignored — preferring it would also undo D4's remount reasoning by
      // trusting a mount point this app resolved for itself.
      const full = resolve(root, h.rel_path)
      if (full !== root && !full.startsWith(root + sep)) return null
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
      // Validated, not merely non-null: the pose rides a hit straight to the
      // client, which reads `up` positionally, so a malformed one is dropped
      // here and the tile renders at its default framing (`isIndexPose`).
      if (isIndexPose(h.pose)) poses[libPath] = h.pose
      scores[libPath] = { score: h.score, z: h.z }
      return entry
    }),
  )
  return { entries: settled.filter((e) => e !== null), poses, scores }
}


/** The `/poses` answer, typed as the wire actually is: another process's JSON,
 *  so the values are `unknown` until `isIndexPose` has looked at them. `null`
 *  is the index's own spelling for "holds the model, has no orientation". */
interface PosesAnswer {
  poses?: Record<string, unknown> | null
}

/**
 * Poses for real filesystem paths, as the index speaks them. A pure pose-cache
 * lookup upstream — no embedding and no GPU — so the cost is the round trip and
 * nothing else, and a set past the bound costs one more of those rather than a
 * second traversal here.
 *
 * **Chunk by chunk, and partially tolerant** — the rule the client's
 * `semanticPosesFor` already applies to its own chunking (`pose-for-every-model`
 * §5.4 finding 4), mirrored here because the failure is the same one: a batch
 * that rejects as a whole discards the poses the chunks *before* it already
 * answered with, so one 500 in the middle leaves every model un-posed instead
 * of the failed chunk's share of them — the silent un-posed tail the chunking
 * exists to prevent, reached the other way round. A failed chunk contributes
 * nothing and its paths are simply absent from the map, which is
 * indistinguishable from "no orientation" and is what the next wave re-asks
 * about. It throws **only when every chunk failed**, carrying the first
 * failure, so a rejection still means "nothing arrived" to `posesForPaths`,
 * whose failure handling is silence.
 *
 * Only `IndexError` is caught: those are the shapes `askIndex` classifies, and
 * a foreign error is a fault in this server rather than an answer the index
 * declined to give. In practice a batch here exceeds one chunk only for a
 * directory of more than `POSES_MAX` models, so the partial case is a large
 * folder's alone — which is exactly the folder it costs the most.
 */
async function askPoses(paths: readonly string[]): Promise<Record<string, IndexPose | null>> {
  const out: Record<string, IndexPose | null> = {}
  let chunks = 0
  let failed = 0
  let first: IndexError | null = null
  for (let i = 0; i < paths.length; i += POSES_MAX) {
    chunks++
    let answer: PosesAnswer
    try {
      answer = (await askIndex(
        '/poses',
        { paths: paths.slice(i, i + POSES_MAX) },
        POSES_TIMEOUT_MS,
      )) as PosesAnswer
    } catch (err) {
      if (!(err instanceof IndexError)) throw err
      failed++
      first ??= err
      continue
    }
    // Counted rather than inferred from the output: a chunk that answered with
    // an empty map contributes nothing too, and "everything failed" must not be
    // reachable by an index that simply had nothing to say.
    for (const [path, pose] of Object.entries(answer.poses ?? {})) {
      out[path] = isIndexPose(pose) ? pose : null
    }
  }
  if (chunks > 0 && failed === chunks && first !== null) throw first
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
  return (await posesAsked(library, libPaths, collectionRoot)).poses
}

/**
 * `posesForPaths`, plus the one thing swallowing an `IndexError` throws away:
 * **whether the index actually answered** (`listing-tree-cache` §6.9).
 *
 * An empty map means two different things — "asked, and it holds no orientation
 * for any of these" and "could not ask" — and every caller so far was right not
 * to care, because a pose is advisory either way. Emission-time filling is the
 * caller that must: it records a model the index has nothing for as a negative,
 * so the next listing does not re-ask, and writing that on the strength of a
 * *failure* would silence the fill for a horizon over an index that was merely
 * having a bad second.
 *
 * `answered` is true when the index was asked and replied, and also when there
 * was nothing to ask **and nothing went wrong asking it** — a zip entry or a
 * symlink out of the collection is a settled "no" that no round trip would
 * change, and re-asking it per listing is the standing cost §6.9 removes.
 *
 * That second clause is narrower than it was (round-3 review, finding 5).
 * `scopeWithin` collapses two different failures into one `null`: a path
 * *structurally* out of scope, and a path this server merely failed to look at —
 * the library refused it, or its `realpath` did not come back, both of which
 * happen to every path at once when a removable volume blinks. A batch that was
 * entirely the second kind used to report `answered: true`, and the fill would
 * then stamp a negative on every model in the folder on the strength of a
 * filesystem hiccup: no pose for a horizon, from a listing that never reached
 * the index at all. So the kinds are counted (`scopeDetail`), and an *empty*
 * result carrying any transient exclusion answers `false`.
 *
 * Only the empty case. A batch that reached the index still reports `true`
 * whatever fell out of it on the way, which is `askPoses`' partial-chunk blur
 * (below) applied to the same trade for the same reason: a horizon of
 * self-correcting negatives, not a second error channel through a routine whose
 * contract is that a pose never fails anything.
 *
 * The one blur it keeps is `askPoses`' own: a batch split across chunks where
 * some chunks failed and others did not reports `true`, since the call as a
 * whole replied. The failed chunk's models are then recorded as negatives for
 * one horizon — bounded, self-correcting, and not worth a second error channel
 * through a routine whose whole contract is that a pose never fails anything.
 */
export async function posesAsked(
  library: Library,
  libPaths: readonly string[],
  collectionRoot: string,
): Promise<{ poses: Record<string, IndexPose>; answered: boolean }> {
  const poses: Record<string, IndexPose> = {}
  if (libPaths.length === 0) return { poses, answered: true }
  // Resolved in parallel, joined in the caller's order: what goes on the wire
  // must not depend on which `realpath` happened to finish first.
  const reals = await Promise.all(libPaths.map((p) => scopeDetail(library, p, collectionRoot)))
  const byReal = new Map<string, string[]>()
  let transient = 0
  libPaths.forEach((libPath, i) => {
    const detail = reals[i]
    if (detail === undefined || detail.real === null) {
      if (detail?.miss === 'transient') transient++
      return
    }
    const named = byReal.get(detail.real)
    if (named === undefined) byReal.set(detail.real, [libPath])
    else named.push(libPath)
  })
  // Nothing to ask about. That is an answer when every exclusion was structural
  // and a non-answer when any of them was this server failing to look.
  if (byReal.size === 0) return { poses, answered: transient === 0 }
  let answered: Record<string, IndexPose | null>
  try {
    answered = await askPoses([...byReal.keys()])
  } catch (err) {
    if (err instanceof IndexError) return { poses, answered: false }
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
  return { poses, answered: true }
}

/**
 * Every pose the index holds for a set of models the client is *already
 * showing*, keyed by library path (D2) — the listing-wide supply of the fact a
 * search hit carries as a rider, and the core both pose routes answer on.
 *
 * The availability gate lives here rather than in each route, so the directory
 * form and the paths form cannot come to disagree about what an unusable index
 * answers. An index that is absent, warming, wedged or volume-gone, or whose
 * collection does not cover these paths, answers `{}` — the same answers a
 * search gets, which the client reads as "no poses", leaving every tile exactly
 * as it renders today. Read through `probeStatus`, so the pose routes and the
 * scoring routes cannot disagree about which state the index is in either.
 *
 * Coverage is not tested here: it is a property of each path and `posesForPaths`
 * decides it per path, which is what lets one listing span a folder the
 * collection reaches and one it does not.
 */
export async function posesForListing(
  library: Library,
  libPaths: readonly string[],
  opts: { fresh?: boolean } = {},
): Promise<Record<string, IndexPose>> {
  return (await posesListingAsked(library, libPaths, opts)).poses
}

/**
 * `posesForListing`, plus `posesAsked`' `answered` — for the caller that records
 * what the answer implies rather than only what it says (round-3 finding 6).
 *
 * The pose wave's POST route is that caller: a model the wave asked about and
 * the index did not name is a recorded negative, so the *next* listing carries
 * `pose: null` and the wave stops asking. Without `answered` reaching the route
 * it would stamp those negatives on an unusable index too — an unavailable index
 * would silence poses for a horizon, which is the one thing the pose layer may
 * never do.
 *
 * An index that is not `ready`, or that reports no collection root, is
 * `answered: false` and not merely an empty map: nothing was asked, so nothing
 * about the index was learned.
 */
export async function posesListingAsked(
  library: Library,
  libPaths: readonly string[],
  opts: { fresh?: boolean } = {},
): Promise<{ poses: Record<string, IndexPose>; answered: boolean }> {
  const { status, collectionRootFs } = await probeStatus(library, opts)
  if (status.state !== 'ready' || collectionRootFs === undefined) {
    return { poses: {}, answered: false }
  }
  return posesAsked(library, libPaths, collectionRootFs)
}

/**
 * The same supply for the plain case the client asks about most: one directory,
 * named rather than enumerated.
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
 */
export async function posesForDir(
  library: Library,
  dirPath: string,
  opts: { fresh?: boolean } = {},
): Promise<Record<string, IndexPose>> {
  const listing = await listDir(library, dirPath)
  return posesForListing(
    library,
    listing.entries.filter((e) => e.kind === 'model').map((e) => e.path),
    opts,
  )
}

/**
 * The most models one `/under` answer may carry (`pose-for-every-model` D5).
 *
 * A contact sheet shows four cells and this asks for sixty-four times that, so
 * the number is not about the sheet: it is about how deep into a folder's models
 * the *posed* ones may sit before the sheet stops seeing them. The index answers
 * in its own deterministic order (relative path), not posed-first, so a folder
 * whose first 256 indexed models all lack an orientation shows four of *those*
 * — the answer is a real one and fills the sheet, so the walk is never
 * consulted — even though the index holds a posed model at position 257. The
 * cut costs the sheet its ranking there, not its cells.
 *
 * `matched` and `truncated` come back beside the models and are advisory here:
 * nothing re-asks for a second page, because the alternative to a truncated
 * answer is the walk, and the walk cannot see past its own 64-entry budget
 * either. Four cells is what is at stake, and a posed model past the cut being
 * invisible to them is recorded as accepted rather than fixed (D5).
 */
export const UNDER_LIMIT = 256

/**
 * `/under` rides behind a folder tile exactly as `/poses` does — advisory, one
 * per tile, on a grid that brings a screenful on at once — so it is given that
 * call's budget rather than a second number to drift from it. Upstream it is a
 * pure store scan (§5.1): an index that has not answered in two seconds is not
 * busy, it is not answering, and the peek has a walk to fall back on.
 */
const UNDER_TIMEOUT_MS = POSES_TIMEOUT_MS

/** One indexed model under a prefix: the path the index walked, and whatever
 *  orientation it holds for it. */
export interface UnderModel {
  path: string
  pose: IndexPose | null
}

/**
 * The `/under` answer, typed as the wire actually is rather than as the contract
 * reads — every field optional and nullable, for `RawStatus`' reason: this is
 * another process's JSON, and a field that arrives missing must narrow to "the
 * index said nothing useful" at the boundary instead of crashing a peek four
 * frames later.
 */
interface RawUnder {
  status?: string | null
  /** `unknown` outright, not a typed array: `models: 5` is one property read
   *  from crashing `flatMap`, so even the list-ness is checked, not declared. */
  models?: unknown
  matched?: number | null
  truncated?: boolean | null
}

/**
 * Every model the index holds under one directory, in its own deterministic
 * order — the peek's alternative to walking (D5).
 *
 * `null` means **use the walk**, and it is deliberately one value for three
 * different facts: the index answered `unindexed` (it reaches this tree and has
 * never scanned here), it could not be reached, or it took too long. All three
 * are "the index has nothing to say about this folder", which is the exact
 * condition the requirement makes the walk the answer to, and a caller that told
 * them apart would have nothing different to do about any of them. An `"ok"`
 * answer holding no models is *not* null: it is a real answer, and it lands as
 * an empty list the caller fills from the walk exactly as it fills a short one.
 *
 * The path in, `dirRealPath`, is a **real filesystem path** — the index is
 * another process with its own view of the volume (D6), and `scopeWithin` is
 * what produces the spelling it resolves.
 */
export async function modelsUnder(
  dirRealPath: string,
  limit: number = UNDER_LIMIT,
): Promise<UnderModel[] | null> {
  let raw: RawUnder
  try {
    raw = (await askIndex('/under', { path: dirRealPath, limit }, UNDER_TIMEOUT_MS)) as RawUnder
  } catch (err) {
    // Availability states and refusals alike, for `posesForPaths`' reason: a
    // preview may never be made to fail by the index, and here there is a walk
    // that answers without it.
    if (err instanceof IndexError) return null
    throw err
  }
  // Anything but the one status that means "these are the models" is the walk's
  // cue — `unindexed`, and equally a status this server has never heard of.
  if (raw.status !== 'ok') return null
  // A `models` that is not a list reads as an empty one, like an absent or
  // null field: an `"ok"` answer holding nothing usable still lands as a real
  // answer the caller fills from the walk, cell by cell, the same way it
  // fills a short one.
  const models: readonly unknown[] = Array.isArray(raw.models) ? raw.models : []
  // A malformed pose is "no pose" rather than a dropped model: the path is what
  // the peek is here for, and an unposed candidate still fills a cell — it
  // simply sorts into the unposed half of `entriesUnder`'s partition. A
  // malformed *model* — not an object, or no string path — is dropped: there
  // is no cell without a path.
  return models.flatMap((m) =>
    isObject(m) && typeof m.path === 'string'
      ? [{ path: m.path, pose: isIndexPose(m.pose) ? m.pose : null }]
      : [],
  )
}

/**
 * Index answers → contact-sheet cells, confined and mapped under exactly the
 * rules a search hit is confined and mapped under (`hitsToEntries`), with the
 * *peeked directory* standing where the collection root stands there.
 *
 * The directory rather than the collection is the base for two reasons. It is
 * what was asked about, so a model outside it is a wrong answer rather than
 * merely an out-of-scope one; and the library path it joins onto is the one the
 * tile was addressed by, so a folder reached through an in-library symlink
 * previews `/links/in/x.stl` — the spelling the walk produces for the same file
 * — rather than the symlink's target under the collection.
 *
 * Confined on each candidate's **realpath**, never on the spelling it arrived
 * in. `/under` answers paths as the index walked them, and the index is a
 * separate run with its own idea of where the collection is: invoked through a
 * symlinked root — a configuration that has actually happened (mini-classify
 * `340a8f0`'s history) — it answers `/alias/kit/x.stl` for a tree this server
 * calls `/real/kit/x.stl`. A lexical prefix test against the peeked directory
 * fails on *every* such path, so nothing is ever confined in, `fromIndex` is
 * always empty, and D5 silently becomes the walk again for the whole library
 * with no surface reporting it. The `realpath` is one syscall per *chosen*
 * candidate, taken before the `stat` and dropping the candidate the same way
 * the `stat` does, so a sheet of four still costs four of each over a
 * 256-model answer.
 *
 * That one test is the whole confinement, and deliberately: the peeked
 * directory is inside the library — `scopeWithin` produced it, against a
 * collection root `mapCollectionRoot` already proved the library holds — so a
 * realpath under it is under the library too, and `hitsToEntries`' second,
 * library-wide test would be unfalsifiable code here rather than defence.
 * What that argument rests on is the *argument*, so the argument is checked:
 * a `dirReal` outside the library answers nothing at all, once, before any
 * candidate is looked at.
 *
 * Ranked posed-first as a **stable partition**, not a sort: both halves keep the
 * index's own order, so the sheet is a function of the answer and of nothing
 * else, which is what the requirement's determinism clause promises.
 *
 * Then the chosen files are stat'd, and only the chosen ones: candidates are
 * consumed in ranked order until `n` entries exist, so a sheet of four costs
 * four stats over a 256-model answer rather than 256. A candidate that no longer
 * stats is dropped and the next one takes its cell — a model can be deleted
 * after it is embedded, and two independently-cached views of one removable
 * volume drift by construction (D3).
 *
 * **`poses` is the second half of the answer, and used to be thrown away**
 * (round-3 review, finding 3). `/under` reports each model's orientation beside
 * its path, and this routine is the only place in the server that can key that
 * orientation by *library* path — the join runs through a `realpath` and a
 * relative-path arithmetic nobody upstream can repeat. Returning it lets the
 * caller record what the derivation already learned, so a contact sheet's cells
 * carry their poses and the client's preview wave has nothing left to ask about.
 * Keyed like every `poses` map in this server, and holding `null` for a model
 * `/under` named without an orientation: that is a recorded negative, not a gap.
 * Only the models that reached a cell are in it — the rest were never resolved
 * to a library path, so there is nothing to key them by.
 */
export async function entriesUnder(
  library: Library,
  models: readonly UnderModel[],
  dirReal: string,
  dirLibPath: string,
  n: number,
): Promise<{ entries: DirEntry[]; poses: Record<string, IndexPose | null> }> {
  const posed = models.filter((m) => m.pose !== null)
  const unposed = models.filter((m) => m.pose === null)
  const out: DirEntry[] = []
  const poses: Record<string, IndexPose | null> = {}
  // The base every candidate is measured against, resolved once. `scopeWithin`
  // already hands a realpath, so this is normally `dirReal` itself; taking it
  // anyway is what stops the test depending on how the caller spelled it.
  const dirTop = await realpath(dirReal).catch(() => dirReal)
  // The premise the single per-candidate test rests on, checked rather than
  // assumed: a directory outside the library cannot lend its inside to
  // anything.
  const realTop = library.realTop()
  if (dirTop !== realTop && !dirTop.startsWith(realTop + sep)) return { entries: out, poses }
  const seen = new Set<string>()
  for (const m of [...posed, ...unposed]) {
    if (out.length >= n) break
    // `resolve` normalises `..`, for the reason `hitsToEntries` gives: this is
    // a path string from another process, and normalising is what stops a
    // `..` naming a file outside what was asked about before it is resolved.
    const full = resolve(m.path)
    // The index followed symlinks when it embedded, and spelled its answer
    // however its own run reached the tree. Both facts are settled here: the
    // realpath is the one spelling this server and the index can agree on, and
    // a model whose realpath leaves the peeked directory is a wrong answer —
    // dropped rather than named on a surface `/api/file` would refuse the same
    // path on (D3).
    const real = await realpath(full).catch(() => null)
    if (real === null) continue
    if (!real.startsWith(dirTop + sep)) continue
    // One file, two addresses, from one string — the tail below the directory,
    // joined onto its library path. Taken off the *real* path, so an aliased
    // spelling lands on the cell the walk would have named for the same file.
    const rel = real.slice(dirTop.length + 1)
    const libPath = posix.join(dirLibPath, rel)
    if (seen.has(libPath)) continue
    // `basename`, not `rel`: a peek's entries are named the way the walk names
    // them, and a sheet must not read half in bare names and half in paths.
    const entry = await modelEntryAt(real, libPath, basename(rel))
    if (entry === null) continue
    seen.add(libPath)
    out.push(entry)
    // Recorded against the cell, not against the candidate: `libPath` is the
    // spelling the walk would have produced for this file, which is the key the
    // pose layer and the client both look a tile up under.
    poses[libPath] = m.pose
  }
  return { entries: out, poses }
}
