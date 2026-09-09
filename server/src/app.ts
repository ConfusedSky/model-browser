import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { relative, resolve as resolvePath } from 'node:path'
import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import type {
  AppsReport,
  DirEntry,
  FeatureReport,
  IndexAvailability,
  IndexPose,
  LibraryState,
  LightingMode,
  ModelsListing,
  OrbitAxis,
  PosesResponse,
  Refused,
  ReloadResult,
  ThumbPutRefused,
  ThumbPutRequest,
} from '../../shared/types'
import { SEARCH_TEXT_MAX, THUMB_MIME } from '../../shared/types'
import { StaleWriteError, ThumbCache } from './cache'
import { guard } from './guard'
import { LaunchError, type Launcher, ZipTempStore, createLauncher } from './launch'
import { LibraryError, type Library, canonicalLibPath, createLibrary } from './library'
import { ListingError, PEEK_MAX_FINDS, complete, listDir, modelFormat, peek } from './listing'
import { ListingCache } from './listingCache'
import {
  type OverrideHolder,
  applyDisplayNames,
  createOverrideHolder,
  resolveOverrides,
} from './overrides'
import {
  IndexError,
  POSES_MAX,
  UNDER_LIMIT,
  entriesUnder,
  hitsToEntries,
  indexStatus,
  memoisedStatus,
  modelEntryAt,
  modelsUnder,
  posesAsked,
  posesForDir,
  posesListingAsked,
  probeStatus,
  query as indexQuery,
  scopeLibPath,
  scopeWithin,
  similar as indexSimilar,
} from './semantic'
import type { SnapshotStore } from './snapshot'
import { VPathError } from './vpath'
import { ZipError, type ZipDirCache, extractEntry } from './zip'

const ORBIT_AXES: readonly OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']
/**
 * The one lighting label a client can produce. Not a list: `remove-axis-lighting`
 * left `LightingMode` a two-value union so entries written under the retired
 * spindle-aligned rig stay readable, and a `LIGHTING_MODES` array would say the
 * server still accepts both. A GET echoes whatever the cache holds, `'axis'`
 * included; only writes are narrowed.
 */
const PRODUCIBLE_LIGHTING: LightingMode = 'camera'

/** Cells in a folder tile's contact sheet, and the most one may ever ask for (D4). */
const PEEK_DEFAULT = 4
const PEEK_MAX = 8

/**
 * The bound on how long a listing waits for a ready index to make its first
 * sight whole (`listing-tree-cache` §6.9). Beyond it the listing ships with
 * whatever arrived, and the late answers land in the layers for the next one.
 *
 * A budget rather than a wait, because the two failure shapes are different
 * sizes. What the fill buys is one navigation's worth of pop-in — a pose that
 * would have arrived on the client's wave a round trip later, a contact sheet
 * that would have arrived on a peek. What an unbounded wait would cost is the
 * listing itself, on a index that is *ready* and merely slow, which is the one
 * state the probe gate cannot catch. So the fill is allowed to make the first
 * sight whole and is never allowed to hold it up: 300 ms is under the threshold
 * where a folder feels like it hesitated, and comfortably over a warm index's
 * `/poses` round trip on loopback.
 *
 * The number is not a timeout on the upstream calls — those carry their own,
 * and `posedFirstPeek` its own budget. It is the moment emission stops caring,
 * and it applies to the fill as a whole rather than per call: two halves each
 * inside their own bound would still be two bounds deep in the worst case.
 *
 * **"Comfortably over a warm index's round trip" was an estimate until
 * 2026-09-03; it is measured now** (round-3 review, finding 10). Against the
 * mini-classify server on :8077 (`ready`, `embed-cache512`, collection root
 * `/run/media/masa/STLLibrary`, CPU SigLIP2), medians of 9 loopback POSTs each,
 * two runs of the script below on 2026-09-03:
 *
 * ```
 *   /poses  n=1  0.8-0.9 ms   n=8  1.0-1.2 ms   n=32  1.4 ms   n=64  1.7-1.9 ms
 *   /under  limit=256, 256 models              7.5-8.7 ms
 * ```
 *
 * So a full 64-path batch is under 1 % of this budget and a preview derivation's
 * `/under` about 3 %, on the machine this app is developed on. `/poses` is a
 * lookup in a loaded cache, not an inference — the timing barely moves with how
 * many of the batch are embedded (22 of those 64 were). Re-run it — the point of
 * writing it down this way — with the index up:
 *
 * ```sh
 *   python3 - <<'PY'
 *   import json, subprocess, time, urllib.request
 *   root = "/run/media/masa/STLLibrary"   # ask :8077/status for the real one
 *   found = subprocess.run(["find", root, "-name", "*.stl"],
 *                          capture_output=True, text=True).stdout.split()[:64]
 *   for n in (1, 8, 32, len(found)):
 *       body = json.dumps({"paths": found[:n]}).encode()
 *       ts = []
 *       for _ in range(9):
 *           t = time.perf_counter()
 *           req = urllib.request.Request("http://127.0.0.1:8077/poses", data=body,
 *                                        headers={"content-type": "application/json"})
 *           a = json.loads(urllib.request.urlopen(req, timeout=30).read())
 *           ts.append((time.perf_counter() - t) * 1000)
 *       print(n, len(a["poses"]), round(sorted(ts)[4], 1), "ms")
 *   PY
 * ```
 *
 * The set of paths matters to the *named* count and hardly at all to the timing,
 * so re-runs land in the same place; `find`'s order is the filesystem's, which
 * is why the numbers above are quoted as the range two runs gave rather than as
 * one figure.
 *
 * What the margin buys is not the warm case, which is free: it is the cold one,
 * where the index reads a model off the removable volume the fill is racing.
 */
export const ANNOTATION_BUDGET_MS = 300

/** The most preview derivations the fill runs at once (§6.9). */
const FILL_PREVIEW_CONCURRENCY = 4

/**
 * The most preview derivations one listing may **start** (§6.9, round-3 review
 * finding 1).
 *
 * The budget bounds *time*; this bounds *work*, and the two are not
 * interchangeable. `ANNOTATION_BUDGET_MS` stops emission waiting, but it cannot
 * un-launch what is already running or queued: a folder of 300 kits would have
 * queued 300 `/under` asks plus their walks, and the ones the budget did not
 * wait for would go on marching through the queue afterwards — a burst at the
 * index and at a removable volume, on behalf of a listing that shipped long ago.
 * With a bound, at most twelve start and the queue is abandoned when the budget
 * expires.
 *
 * **Twelve, because that is what a first paint actually asks for.** The client's
 * viewport-driven peek was measured on the demo corpus twice
 * (`folder-contact-sheets` 3.2 and 3.4, both live Playwright runs): 297 dir tiles
 * → **12 peeks on first paint**, and on the real library after a remount, 26 kit
 * folders → **12 peeks** again. So twelve is the count that makes the fill cover
 * the sheets a user is about to see, and the tiles below the fold keep the
 * behaviour they have today — the client peeks for them as they scroll into
 * view, which is the path this bound deliberately leaves in place rather than
 * replacing.
 */
export const FILL_PREVIEW_MAX = 12

/**
 * How an `IndexError` reaches the client — one mapping, shared by both scoring
 * routes, because the same upstream status means the same thing whichever route
 * met it.
 *
 * - **No `upstreamStatus`** — the index never answered. That is availability,
 *   and it keeps the 503 envelope the UI renders, state and all. Not a 500:
 *   "the index is not there" is a state, and the state itself is what tells the
 *   user which thing to do about it.
 * - **404** — the index answered, about the thing that was named: this model
 *   has no embedding. The UI owns a distinct sentence for it ("not indexed yet
 *   — run the classifier"), so it travels as the status rather than as text to
 *   sniff. Unambiguous because the one *other* reason a model can be
 *   unembeddable — living inside an archive — never reaches this server: the
 *   command is not offered on archive entries (D6) and the client refuses a
 *   `!/` subject without asking.
 * - **any other 4xx** — the index answered and refused (a virtual path, a name
 *   matching more than one model). A refusal, reported as the refusal in the
 *   index's own words. A 503 carrying `state: 'ready'` would contradict itself
 *   and tell the client to re-probe availability over a request it should have
 *   fixed.
 * - **5xx** — the index failed on its own side: a bad gateway, not an absent
 *   service.
 *
 * **`hostDetails` decides whose words travel, never which status does.** Every
 * message above the 503 is the index's own `detail`, verbatim (`askIndex` in
 * `semantic.ts`) — another process's free text, which names its cache directory,
 * its collection root, or the **filesystem path of the model it was asked
 * about**: find-similar on an unindexed model answers 404
 * `/run/media/…/harrifex.obj is not in the cache`. Where the host is not the
 * viewer's concern (D9/D11) that text is this server's to withhold, exactly as
 * `viewerIndexStatus` withholds the same service's `detail` from `/status` —
 * a route that still returned it would be the "service's own words are not a way
 * around it" hole, on the two routes a public deployment serves most.
 *
 * What is withheld is the sentence and nothing else. The 404-versus-400
 * distinction stays in the *status*, which is where the UI already reads it from
 * ("not indexed yet" is keyed off the status, never off text to sniff), so the
 * client behaves identically and only the prose changes. The operator loses
 * nothing either: the caller logs the real message beside the route.
 */
function indexErrorReply(
  err: IndexError,
  hostDetails: boolean,
): {
  body: { error: string; state?: string }
  status: 400 | 404 | 502 | 503
} {
  if (err.upstreamStatus === undefined) {
    // The availability sentence is this server's own, but it is composed from
    // the index's state and reads as a report about the operator's machine, so
    // it collapses to the one the routes' own 503 already uses.
    return {
      body: { error: hostDetails ? err.message : 'index unavailable', state: err.state },
      status: 503,
    }
  }
  const refused = hostDetails ? err.message : 'the index refused the request'
  if (err.upstreamStatus === 404) return { body: { error: refused }, status: 404 }
  const bad = err.upstreamStatus >= 400 && err.upstreamStatus < 500
  if (bad) return { body: { error: refused }, status: 400 }
  return { body: { error: hostDetails ? err.message : 'the index failed' }, status: 502 }
}

/**
 * The archive's own library path, out of a virtual path naming an entry inside
 * it — `/models.zip!/box.stl` → `/models.zip`. What an error about the *archive*
 * names, since that is the entry that failed; the entry inside it is not what
 * could not be read. A path with no `!/` is its own answer.
 */
function archiveOf(vpath: string): string {
  const i = vpath.indexOf('!/')
  return i === -1 ? vpath : vpath.slice(0, i)
}

/**
 * A `Range` header, as far as this server honours one: a **single** byte range,
 * in the three spellings RFC 9110 gives it — `bytes=a-b`, `bytes=a-`,
 * `bytes=-n`.
 *
 * Three answers, and the difference between the last two is the point:
 * `{start,end}` is a slice to send as 206; `'unsatisfiable'` is a range that
 * names nothing in a file of this size, which owes a 416; and `null` is
 * *serve the whole file* — what a multi-range or malformed header gets, since
 * answering the whole representation is always a correct answer to a range
 * request and refusing one would break a client that asked badly.
 *
 * `end` is inclusive, as the header is and as `createReadStream` takes it.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (header === undefined) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (m === null) return null
  const [, from, to] = m
  if (from === '' && to === '') return null
  // A zero-length representation before the three spellings are told apart:
  // RFC 9110 §14.1.1 makes *no* byte-range-spec satisfiable against one, and
  // the suffix branch below would otherwise answer `bytes=-n` with the empty
  // slice `{start: 0, end: -1}` — which `createReadStream` rejects outright,
  // turning a well-formed request into a 500. The `start >= size` test further
  // down already covers the two prefixed spellings here (`0 >= 0`); this makes
  // the rule the header-independent one it always was.
  if (size === 0) return 'unsatisfiable'
  if (from === '') {
    // A suffix range: the last `n` bytes. `bytes=-0` names nothing.
    const n = Number(to)
    if (n === 0) return 'unsatisfiable'
    // More than the file holds is the whole file, not a failure.
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(from)
  // Past the end is the one remaining shape that owes a 416 rather than bytes
  // (the empty file, which this check used to carry, is caught above).
  if (start >= size) return 'unsatisfiable'
  if (to === '') return { start, end: size - 1 }
  const end = Number(to)
  // A backwards range is malformed, not unsatisfiable: whole file.
  if (end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

/**
 * The end of a chain of narrowing branches, which the compiler reaches only if
 * one is missing: `never` accepts nothing, so an unhandled member of the union
 * is a type error at the call rather than a wrong answer at runtime. It throws
 * if it is ever reached anyway — a hand-written state object from a test, say —
 * because an unrecognised state is not something to answer 200 to.
 */
function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`)
}

/**
 * The walk's own answer, posed models first (`pose-for-every-model` D4) and
 * uncut — the sheet's second source since D5, and the whole of it whenever the
 * index has nothing to say about the folder.
 *
 * Posedness cannot be known mid-walk without asking per level, so the walk is
 * not asked to know it: it runs exactly as it always did, but to the **entry
 * bound** instead of to `n` — `PEEK_MAX_FINDS` is the most models that bound
 * can yield — and one `/poses` batch over everything it found decides the
 * ranking afterwards. One round trip per peek, never a per-level chain: the
 * entry bound caps the finds at 64, so the batch is a single request whatever
 * the folder held, and the peek's worst case grows by exactly that one call.
 *
 * Ranking is applied whatever the walk found, not only when it found more than
 * `n`: "prefer posed" is about the cells the user sees, and a sheet of three
 * whose posed model sat last would otherwise contradict the sheet of five
 * beside it.
 *
 * The batch's answer goes back out beside the ranking (`Learned`, round-3
 * finding 3): this walk asks the index about every model it found, and throwing
 * that away meant the same models were asked about again by the next listing's
 * fill and by the client's preview wave after that. Through `posesAsked` rather
 * than `posesForPaths` for the one thing the ranking does not need and the
 * recording does — whether the index replied at all.
 */
async function walkRanked(
  library: Library,
  libPath: string,
  collectionRootFs: string,
  /**
   * Carried for symmetry with `walkOnly` and because the signature must not lie:
   * no archive interior reaches here, since `scopeWithin` refuses a virtual path
   * structurally and sends it down `walkOnly` (D8).
   */
  zips?: ZipDirCache,
): Promise<{ entries: DirEntry[]; learned: Learned }> {
  const finds = await peek(library, libPath, PEEK_MAX_FINDS, zips)
  if (finds.length === 0) return { entries: finds, learned: NOTHING_LEARNED }
  const asked = finds.map((e) => e.path)
  const { poses, answered } = await posesAsked(library, asked, collectionRootFs)
  const posed = finds.filter((e) => poses[e.path] !== undefined)
  // A stable partition, not a sort: both halves keep the walk's order, so the
  // answer is a function of the walk and the index's reply and of nothing else.
  const unposed = finds.filter((e) => poses[e.path] === undefined)
  return {
    entries: [...posed, ...unposed],
    learned: { poses, asked: answered ? asked : [] },
  }
}

/**
 * What a preview derivation found out about poses on its way to a sheet — the
 * orientations, and the models it is entitled to record a negative for (§6.9,
 * round-3 finding 3).
 *
 * `asked` is empty when the index did not answer, exactly as in `fillPoses`:
 * "the index did not reply" is not "the index has nothing", and the two must not
 * be written down the same way.
 */
interface Learned {
  poses: Record<string, IndexPose>
  asked: readonly string[]
}

const NOTHING_LEARNED: Learned = { poses: {}, asked: [] }

/** The two sources a peek can learn poses from, in one record. */
function mergeLearned(a: Learned, b: Learned): Learned {
  if (a.asked.length === 0 && Object.keys(a.poses).length === 0) return b
  if (b.asked.length === 0 && Object.keys(b.poses).length === 0) return a
  return { poses: { ...a.poses, ...b.poses }, asked: [...a.asked, ...b.asked] }
}

/**
 * The models a contact sheet draws: the index's, where it holds any under this
 * folder, and otherwise the walk's (`pose-for-every-model` D5).
 *
 * **The walk cannot reach what the index can.** A peek walks depth-first under
 * a 64-entry budget, so a folder of folders whose first-sorted subtree is deep —
 * a "(Presupported)" tree — spends the whole budget before the first indexed kit
 * is reached, and the sheet is unposed however much of the folder the index
 * knows. Rationing the walk was weighed and rejected (D5): the index already
 * holds every model under a prefix and its orientation, so the peek asks it
 * first and walks only when the answer does not fill the sheet.
 *
 * **When the index has nothing to say about this folder, this is today's code
 * path, untouched.** The two tests below come before *any* walk, precisely so
 * that an index with nothing to say costs the peek nothing at all — not even
 * the wider walk — and the sheet is then the walk's first `n` models byte for
 * byte, which is what the requirement's determinism clause promises when the
 * index is silent.
 *
 * Two tests, because "not answering" and "answering about somewhere else" are
 * different facts. The first is availability, read from the cached probe every
 * semantic route shares (`probeStatus`), so it is not a request per tile. The
 * second is coverage, and it needs the *folder*: `posesForPaths` decides
 * coverage per path, which is the right grain for a listing but is decided too
 * late for a walk — a ready index rooted at a sibling subtree would otherwise
 * buy the entry-bound walk and a `realpath` per find to be told, path by path,
 * what one `scopeWithin` of the directory says up front. And it is `scopeWithin`
 * that produces the *real* path `/under` has to be asked about (D6), so the same
 * call answers both questions.
 *
 * The corner it gives up is a folder outside the collection holding a symlink
 * into it: that model has a pose upstream and no longer gets one here. A
 * preview is cosmetic and follows the index's coverage the way search does —
 * paying a wide walk on every uncovered folder in the library to orient the odd
 * symlinked one is the wrong trade.
 *
 * A short answer is *filled* from the walk rather than shown as it came: a
 * two-cell sheet over a visibly fuller folder would be a regression against
 * today's, whatever its provenance (D5). Deduplicated by library path, since the
 * two sources overlap by construction — the walk finds the same files the index
 * indexed — and the walk's own ranking decides the order of what it contributes.
 */
async function posedFirstPeek(
  library: Library,
  libPath: string,
  n: number,
  /**
   * The index's state, when the caller has already resolved it and this peek
   * must not resolve it again (§6.9, round-3 finding 4).
   *
   * Emission-time filling is that caller. Its gate reads the probe *memo* and
   * never takes a probe, and since the memo is now a state gate rather than a
   * freshness one, the memo it read may be older than `TTL_MS` — at which point
   * the `probeStatus` below would stop being a memo read and become a live
   * `/status` fetch, on the browse path, on behalf of a pass whose whole
   * contract is that it costs a listing nothing. So the fill hands its own
   * answer down. `/api/peek` passes nothing and probes exactly as it always has:
   * a peek is a request the client made, and paying for a look is what a request
   * is allowed to do.
   */
  resolved?: { status: IndexAvailability; collectionRootFs: string | undefined },
  /**
   * The archive layer, for the interior half of a peek
   * (`archive-interior-sheets` D3). Threaded through here because neither route
   * calls `peek` directly — both arrive through the closures below — so this is
   * where a cache handed in at the route reaches it.
   */
  zips?: ZipDirCache,
): Promise<{ entries: DirEntry[]; collectionRootFs: string | undefined; learned: Learned }> {
  // Handed back beside the sheet rather than re-probed by the caller: this
  // function already asks, the answer is what the preview layer records its
  // identity against (§6.1), and a second `probeStatus` at the route would be a
  // probe taken on the layer's behalf — which is exactly what "observe the
  // answers that already flow" rules out.
  const { status, collectionRootFs } = resolved ?? (await probeStatus(library))
  const walkOnly = async (): Promise<{
    entries: DirEntry[]
    collectionRootFs: string | undefined
    learned: Learned
  }> => ({
    entries: await peek(library, libPath, n, zips),
    collectionRootFs,
    learned: NOTHING_LEARNED,
  })
  if (status.state !== 'ready' || collectionRootFs === undefined) return walkOnly()
  // The collection's reach, asked about the folder rather than about its finds
  // — the same call, one level up. `null` is every way it can fail to reach:
  // outside the collection, a path the library refuses, or a virtual one (D7).
  const dirReal = await scopeWithin(library, libPath, collectionRootFs)
  if (dirReal === null) return walkOnly()

  // `null` is "ask the walk" — unindexed here, unreachable, or too slow. An
  // `"ok"` answer holding nothing is a real answer and lands as `[]`, which
  // fills from the walk by the same arithmetic; the two converge on purpose.
  const under = await modelsUnder(dirReal, UNDER_LIMIT)
  const answer =
    under === null ? null : await entriesUnder(library, under, dirReal, libPath, n)
  const fromIndex = answer?.entries ?? []
  // `/under` named these models and said what it holds for each, so every one of
  // them is asked-and-answered — the positives as poses, the rest as negatives.
  const fromUnder: Learned =
    answer === null
      ? NOTHING_LEARNED
      : {
          poses: Object.fromEntries(
            Object.entries(answer.poses).filter(
              (e): e is [string, IndexPose] => e[1] !== null,
            ),
          ),
          asked: Object.keys(answer.poses),
        }
  if (fromIndex.length >= n) return { entries: fromIndex, collectionRootFs, learned: fromUnder }

  const sheet = [...fromIndex]
  const seen = new Set(sheet.map((e) => e.path))
  const walked = await walkRanked(library, libPath, collectionRootFs, zips)
  for (const entry of walked.entries) {
    if (sheet.length >= n) break
    if (seen.has(entry.path)) continue
    sheet.push(entry)
  }
  return {
    entries: sheet,
    collectionRootFs,
    learned: mergeLearned(fromUnder, walked.learned),
  }
}

/**
 * The **maintained** configuration — the one this project tests as its primary
 * case and the one a distributed desktop build runs — and `createApp`'s default
 * so a caller with no opinion gets it (public-deployment D4).
 *
 * Deliberately not "every capability on", which is what its old name
 * (`ALL_FEATURES`) claimed: `chatTab` is **off**, because the tab is a
 * placeholder whose submitted input may be ignored, and an unfinished surface
 * belongs neither in a shipped desktop app nor on a public link. It stays
 * declarable, so the day chat gains a backend the default flips. All-on is
 * therefore a configuration nobody runs, and the feature-report capability's
 * *Everything on changes nothing* scenario is an inertness proof for the report
 * mechanism rather than a picture of the shipped app.
 *
 * `index.ts` builds the served report as `{ ...DEFAULT_FEATURES,
 * ...config.features }` and passes it explicitly: one value, from which both
 * the report and the routes' refusals are read (D5).
 */
export const DEFAULT_FEATURES: FeatureReport = {
  thumbWrites: true,
  appLaunch: true,
  chatTab: false,
  hostDetails: true,
  maintenance: true,
}

export function createApp(
  cache: ThumbCache = new ThumbCache(),
  launcher: Launcher = createLauncher(),
  // Per server run, per app: nothing in it is deleted while the server runs,
  // since a launched application may still be reading (app-launch L7). A test
  // can inject its own store (its own root) so it never litters the real
  // tmpdir (4.5) — additive and trailing, like `cache` and `launcher` above.
  zipTemp: ZipTempStore = new ZipTempStore(),
  // The only translator between a request's path and a filesystem path
  // (library-root D3). Injected like the three above so a test drives its own
  // tree rather than the machine's configured library.
  library: Library = createLibrary(),
  // The library's override store, held per resolved library rather than per
  // process (library-overrides D1). Injected like the four above, and defaulted
  // off `library` so the two can never disagree about which tree they are
  // talking about; `index.ts` passes its own so the eager load's report lands
  // beside the startup line.
  overrides: OverrideHolder = createOverrideHolder(library),
  // What this server accepts and offers (feature-report D4, public-deployment
  // D5). Injected like the five above so a test drives a variant rather than
  // the process's own construction, and read once — a per-process
  // configuration, so the restart-after-editing rule every config in this app
  // follows. `index.ts` builds it from the deployment's configuration over
  // `DEFAULT_FEATURES`; the routes' refusals read this same object, so a
  // declaration and a refusal cannot disagree.
  features: FeatureReport = DEFAULT_FEATURES,
  // The walked-tree cache (`listing-tree-cache` §4). Injected like the six
  // above, and **absent by default**: with no store, `ListingCache` walks every
  // request exactly as this app did before the change, so a caller with no
  // opinion — and every test written before it — is unaffected. `index.ts`
  // constructs the real one against the library.
  snapshots?: SnapshotStore,
  /**
   * The listing cache itself, which owns the per-(process, root) validation
   * state and the derived layers (§6.1). Defaulted to one built over
   * `snapshots`, so every existing caller is unaffected.
   *
   * It is a parameter because **startup revalidation must run on the same
   * instance the app serves from** (§6.5): a pass run by a second instance
   * would correct the snapshot on disk while this app's own cache still
   * believed the root unchecked, so the first listing would be marked stale and
   * would start a duplicate pass behind it — paying twice for what had just
   * been done. `index.ts` constructs one, kicks the startup pass on it, and
   * hands it here.
   */
  listings: ListingCache = new ListingCache(snapshots),
  /**
   * The origins this deployment answers, beside loopback — from the
   * deployment's configuration (public-deployment D3). Trailing and empty by
   * default, so an unconfigured app guards exactly as it did: the two loopback
   * patterns and nothing else.
   */
  origins: readonly string[] = [],
): Hono {
  const app = new Hono()
  const layers = listings.layers

  /**
   * Attach what this server's caches already knew about these entries (§6.3):
   * the thumbnail state, a model's pose, a folder's contact sheet.
   *
   * Beside `applyDisplayNames` and for its reason (library-overrides D7): a
   * listing leaves `listing.ts` by five paths and this is the one place all of
   * them pass through, so one pass covers browse, flat search, peek and the
   * enumeration alike without threading a lookup through four signatures.
   *
   * **Mutates in place, which is safe because every entry here is already
   * fresh** — `wire` mints a new object per entry on the walked path, and
   * `partition` does on the cached one, so the snapshot's own objects never
   * reach a route. That is the delta's "serve copies" rule, already discharged
   * upstream; copying again here would only hide a regression in it. It is the
   * same in-place caveat `displayName` carries, and the same answer.
   *
   * **Three Map gets and no I/O.** Nothing here can wait on the semantic index,
   * the filesystem or the thumbnail store: a fact the caches cannot answer is
   * simply absent from that entry, and the client asks for it exactly as it did
   * before. That is what makes a wedged index cost a listing nothing, and what
   * makes a library with no layer content emit byte-identical listings.
   *
   * `fillAnnotations` runs *before* this on the two listing routes and may put
   * more in the layers first (§6.9). It is a separate pass on purpose: this one
   * stays the only place a fact is attached, so there is one annotation path
   * rather than two that could come to disagree about what a field means.
   */
  /**
   * Is this held sheet derived from an archive that has since been rewritten?
   * (`archive-interior-sheets` D9.)
   *
   * An interior entry and every cell of its sheet carry the **containing
   * archive's** mtime — `listZipDir` and the interior peek both emit
   * `zipStat.mtimeMs` — so a sheet whose cells disagree with the tile above them
   * was derived against a version of the archive that is gone. That is a check
   * no filesystem directory could offer, and it is why interiors need no
   * revalidation route: the key validates itself at emission, on exactly the
   * listing that would otherwise serve it stale.
   *
   * Only interiors are asked. A filesystem directory's sheet holds models from
   * anywhere in its subtree, whose mtimes have nothing to do with the folder's,
   * and comparing them would drop every sheet on every listing.
   */
  function staleInterior(dir: DirEntry, preview: readonly DirEntry[]): boolean {
    if (!dir.path.includes('!/')) return false
    return preview.some((cell) => cell.mtime !== dir.mtime)
  }

  function annotate(entries: DirEntry[]): void {
    for (const entry of entries) {
      const thumb = cache.annotate(entry.path, entry.mtime)
      if (thumb !== undefined) entry.thumb = thumb
      if (entry.kind === 'model') {
        // `!== undefined`, not a truth test: `null` is a recorded negative and
        // rides the wire as one (§6.9, round-3 finding 6). "The index was asked
        // and has none" is what stops the client's wave asking again, and it can
        // only travel as a value — an omitted field means "this server has not
        // derived it", which is the opposite instruction.
        const pose = layers.poseFor(entry.path)
        if (pose !== undefined) entry.pose = pose
      } else if (entry.kind === 'dir') {
        // The sheet a tile draws by default. A tile asking for more cells still
        // asks `/api/peek`, which is the only place a wider sheet is derived.
        const preview = layers.previewFor(entry.path, PEEK_DEFAULT)
        if (preview !== undefined && staleInterior(entry, preview)) {
          // The archive under this sheet has been rewritten. Dropped rather
          // than served, and re-derived by the fill or the client's peek like
          // any sheet that was never held (`archive-interior-sheets` D9).
          layers.forgetPreview(entry.path, PEEK_DEFAULT)
        } else if (preview !== undefined) {
          // The cells are model tiles too, and carry what the caches know
          // exactly as the models beside their folder do — or a revisit,
          // where the sheet rides the listing, would cost a lookup per cell
          // that the first visit's peek never did (`thumbnail-image-serving`
          // D2, second review). Safe in place: `previewFor` copies out, and
          // the copy strips whatever annotation the layer's own record held.
          annotate(preview)
          entry.preview = preview
        }
      }
    }
  }

  /**
   * Fill the layers with what *this* listing is about to want, before
   * `annotate` reads them (§6.9) — a batched pose ask for its unposed models,
   * a preview derivation for its unchosen folders — and give up on it after
   * `ANNOTATION_BUDGET_MS`.
   *
   * **Why this is not the client's job any more.** The layers were filled only
   * by answers already passing through the server, so a first sight of a folder
   * carried nothing and the client filled it in with a pose wave and a peek per
   * tile: the facts arrived, visibly, one round trip after the grid did. Moving
   * the same calls to emission costs the same work and deletes the round trip —
   * the server is the process next to the index. The client's wave and peek are
   * untouched and remain the fill for everything this pass does not get.
   *
   * **The probe gate is read, never taken** (`memoisedStatus`). An index that is
   * absent, warming or wedged must cost a listing nothing, and a probe *is*
   * something: taking one here would put the index's health back on the browse
   * path by the back door, which is the one thing §6.1 exists to prevent. No
   * memoised answer is therefore not "ask" but "decline" — the semantic routes
   * take that probe, and until one has, listings emit exactly as they did
   * before this pass existed.
   *
   * **The budget covers the whole pass, and expiry is not cancellation of what
   * is running.** What is still in flight goes on running and still records, so
   * the answer is not thrown away for having been slow: it lands in the layers
   * and the next listing carries it. What expiry *does* stop is anything not yet
   * started — the preview queue, which would otherwise march on through a folder
   * of hundreds long after the listing shipped. Failures are swallowed whole —
   * the wave swallowed them too, and a listing may never be made to fail, or made
   * noisy, by the index.
   *
   * **Single-flighted per listing** (round-3 finding 2). Two requests for the
   * same listing arriving together — a reload beside a navigation, two tabs, the
   * client's own retry — each found the layers empty and each ran the whole pass:
   * the same `/poses` batch twice and the same preview derivations twice, at an
   * index that serves one request at a time. The second joins the first instead
   * and then annotates from the layers it filled, which is the same answer by the
   * same path.
   */
  const fills = new Map<string, Promise<void>>()

  async function fillAnnotations(key: string, entries: readonly DirEntry[]): Promise<void> {
    const running = fills.get(key)
    if (running !== undefined) return running
    const tracked: Promise<void> = fillOnce(entries).finally(() => {
      // Identity-guarded like `rawStatus`' in-flight probe: a settling pass must
      // not clear whatever pass replaced it.
      if (fills.get(key) === tracked) fills.delete(key)
    })
    fills.set(key, tracked)
    return tracked
  }

  /**
   * The key `fillAnnotations` single-flights on: what makes two requests the
   * *same* listing.
   *
   * Not the path alone. `/api/dir?path=/kit` and `/api/dir?flat=true&path=/kit`
   * put different entries on screen — the second draws from the whole subtree —
   * so joining them would silently under-fill whichever arrived second, for a
   * saving of nothing: they are never issued together in practice, and the join
   * exists for the case where they are literally the same request.
   */
  function fillKey(libPath: string, flat: boolean, q: string | undefined, folders: boolean): string {
    return `${flat ? 'flat' : 'dir'} ${folders ? 'f' : ''} ${q ?? ''} ${libPath}`
  }

  async function fillOnce(entries: readonly DirEntry[]): Promise<void> {
    // A layer built for another `LAYER_VERSION` records nothing and answers
    // nothing, so filling it is a round trip spent on an answer that will be
    // dropped on arrival (round-3 finding 8). The layer's own methods already
    // decline; this is the check that stops the *asking*, which is the part
    // that costs the index something.
    if (!layers.isLive) return
    const memo = memoisedStatus()
    if (memo === undefined) return
    const { status, collectionRootFs } = memo
    if (status.state !== 'ready' || collectionRootFs === undefined) return

    // What the layers cannot answer *at all* — which is not the same question
    // `annotate` asks. A model the index was asked about and had no orientation
    // for is answered ("none"), so it is not re-asked here; it simply carries no
    // pose. Reading that negative as an absence is what would turn one
    // navigation's pop-in into a `/poses` batch on every listing forever.
    // An entry past its horizon does read as unknown, which is what re-asks for
    // it — the convergence bound, applied to negatives and positives alike.
    const unposed: string[] = []
    const unchosen: string[] = []
    for (const entry of entries) {
      if (entry.kind === 'model') {
        if (!layers.poseKnown(entry.path)) unposed.push(entry.path)
      } else if (entry.kind === 'dir') {
        // `PEEK_DEFAULT` and no other count: the sheet a tile draws without
        // asking is the only one emission attaches, so a wider one derived here
        // would be work for a field no listing reads.
        //
        // `undefined`, not "empty": a folder derived to an empty sheet has been
        // answered, and re-deriving it per listing is the same standing cost
        // the pose negative exists to stop — a walk instead of a round trip.
        if (layers.previewFor(entry.path, PEEK_DEFAULT) === undefined) unchosen.push(entry.path)
      }
    }
    if (unposed.length === 0 && unchosen.length === 0) return

    // Flipped by the budget's timer and read by the preview queue before each
    // derivation. An object rather than a captured boolean so the workers see
    // the write; an `AbortSignal` would be the same thing with a listener, and
    // there is nothing here to cancel — only something to stop starting.
    const stop = { expired: false }
    const work = Promise.all([
      fillPoses(unposed, collectionRootFs),
      fillPreviews(unchosen, memo, stop),
    ])
    // Never rejects — both halves swallow — but stated rather than assumed: an
    // unhandled rejection from a continuation nobody awaits would take the
    // process down on a fault this pass is supposed to be invisible to.
    const settled = work.then(
      () => undefined,
      () => undefined,
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        stop.expired = true
        resolve()
      }, ANNOTATION_BUDGET_MS)
      // A listing's budget is not a reason for the process to stay alive, and
      // a server that exits between listings must not wait 300 ms to do it.
      timer.unref?.()
    })
    await Promise.race([
      settled.then(() => {
        if (timer !== undefined) clearTimeout(timer)
      }),
      budget,
    ])
  }

  /**
   * Has the index's collection root stayed put since a fill captured it?
   *
   * Asked by every late continuation before it records (§6.9, round-3 finding
   * 9). A fill's answers can land after the index has been repointed at another
   * collection, and `DerivedLayers.reroot` reads the root it is *handed* — so
   * recording the old root there would re-adopt it, dropping the fresh layer and
   * re-installing stale facts under a collection they were not derived from.
   *
   * A memo holding nothing is not a move, for `reroot`'s own reason: an index
   * that is absent, warming or wedged reports no root, and treating that silence
   * as a repoint would let a blip discard a perfectly valid layer.
   */
  function rootUnmoved(captured: string): boolean {
    const now = memoisedStatus()?.collectionRootFs
    return now === undefined || now === captured
  }

  /**
   * One `/poses` batch for every model on this listing the layer cannot answer
   * for, through the call the POST proxy answers with (`posesAsked`, which is
   * `posesForPaths` plus whether the index replied) — so there is one shape of
   * pose request in this server, and the confinement rules that go with it are
   * not restated here.
   *
   * `recordPoses` is called on the answer whatever it holds, empty included:
   * that is the collection-root observation the layers' identity rides on
   * (§6.1), and gating it on a non-empty answer is what made a repoint
   * undetectable once before.
   *
   * The asked paths go in beside the answer, so every model the index did not
   * name is recorded as a negative (§6.9). Without that, a folder of models the
   * index has never embedded — or one it cannot see, a symlink out of the
   * collection — would be batched at the index on *every* listing of it, which
   * is worse standing traffic than the client pop-in this pass deletes.
   *
   * A failed ask records nothing at all, negatives included: "the index did not
   * answer" is not "the index has nothing", and writing the second on the
   * strength of the first would hide a wedged index behind five minutes of
   * confident silence.
   */
  async function fillPoses(paths: readonly string[], collectionRootFs: string): Promise<void> {
    if (paths.length === 0) return
    try {
      const { poses, answered } = await posesAsked(library, paths, collectionRootFs)
      if (!rootUnmoved(collectionRootFs)) return
      layers.recordPoses(collectionRootFs, poses, answered ? paths : [])
    } catch {
      // The listing already shipped, or is about to. Nothing to report to.
    }
  }

  /**
   * A contact sheet for each folder on this listing that has none, derived by
   * the pipeline `/api/peek` uses and recorded where a peek would record it —
   * never a second derivation, so a sheet the fill produced and a sheet a peek
   * produced are the same sheet.
   *
   * Bounded three ways, and each bound covers what the others cannot.
   * `FILL_PREVIEW_CONCURRENCY` bounds how many run *at once*, so a wide folder
   * is not a burst at the index and at the disk. `FILL_PREVIEW_MAX` bounds how
   * many are ever *started* for one listing, which is the bound the budget
   * cannot provide — expiry stops emission waiting, it does not un-queue three
   * hundred derivations. And `stop.expired` ends the queue when the budget does,
   * so what has not started never starts: the work in flight finishes and
   * records, everything behind it is abandoned, and the folders past the bound
   * keep exactly the behaviour they have today — the client peeks for them as
   * they scroll into view.
   *
   * The poses each derivation learned are recorded beside its sheet (round-3
   * finding 3): `/under` reports an orientation per model and the ranking walk
   * asks `/poses` about everything it found, so a sheet's own cells arrive posed
   * and the client's preview wave has nothing left to ask about. That is the
   * round trip §6.9 exists to delete, on the surface that was still paying it.
   */
  async function fillPreviews(
    dirs: readonly string[],
    resolved: { status: IndexAvailability; collectionRootFs: string | undefined },
    stop: { expired: boolean },
  ): Promise<void> {
    if (dirs.length === 0) return
    const wanted = dirs.slice(0, FILL_PREVIEW_MAX)
    let next = 0
    const derive = async (): Promise<void> => {
      for (;;) {
        if (stop.expired) return
        const i = next++
        const dirPath = wanted[i]
        if (dirPath === undefined) return
        try {
          // The memo the fill already read, handed down rather than re-probed:
          // `posedFirstPeek`'s own `probeStatus` would fetch on a memo past its
          // TTL, which is a `/status` call on the browse path (round-3 finding
          // 4).
          const { entries, collectionRootFs, learned } = await posedFirstPeek(
            library,
            dirPath,
            PEEK_DEFAULT,
            resolved,
            snapshots?.archiveCache(),
          )
          if (collectionRootFs !== undefined && !rootUnmoved(collectionRootFs)) return
          // Recorded before any naming pass, for `/api/peek`'s reason: the
          // choice is the models and their order, never how one request
          // happened to label them.
          layers.recordPreview(collectionRootFs, dirPath, PEEK_DEFAULT, entries)
          layers.recordPoses(collectionRootFs, learned.poses, learned.asked)
        } catch {
          // A folder that cannot be peeked simply has no sheet, exactly as
          // before this pass existed.
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(FILL_PREVIEW_CONCURRENCY, wanted.length) }, derive),
    )
  }

  /**
   * The collection root the index is currently answering from, as the layers
   * record their identity against (§6.1, design D7/M9).
   *
   * Read from the probe every semantic route already makes — memoised per state
   * by `indexStatus`, so it is not a second round trip and **never a poll**. The
   * layers are told what the answers passing through this server were derived
   * against; nothing here asks the index anything on their behalf.
   *
   * Asked on every pose answer, **including an empty one**, and that is
   * load-bearing rather than tidy: the root is what `/status` reports, not
   * something the pose map carries, so "the index answered about no model here"
   * is exactly what a repointed collection looks like from this side. Gating
   * this on a non-empty answer made a repoint undetectable — the models under
   * the old root stop resolving, the answer comes back empty, and the layer
   * would have gone on serving poses derived from a collection the index has
   * left. An index that is not answering at all reports no root, and
   * `recordPoses` treats that silence as no observation rather than as a move.
   */
  async function collectionRoot(): Promise<string | undefined> {
    return (await probeStatus(library)).collectionRootFs
  }

  /**
   * The answer a route gives where this deployment declares the capability off
   * (D5). 403 — the status the guard already gives a request this server will
   * not answer — with the field named in the body, so a client tells "not
   * offered here" from "went wrong" without reading the status code alone.
   *
   * Every caller refuses on the handler's **first** line, before a body is
   * parsed, a path resolved or a command run: a refused request must do no work
   * and leak nothing about what it asked for.
   */
  function refuse(c: Context, field: keyof FeatureReport): Response {
    const body: Refused = { error: 'not offered by this deployment', refused: field }
    return c.json(body, 403)
  }

  /**
   * The library's state as this deployment's *viewer* may read it (D11).
   *
   * Where the host is declared not the viewer's concern, the three filesystem
   * locations go — the library's top, the configured root of a `missing`
   * library, and both locations of a `nested` one — while the state itself, the
   * identity, the `unmarked` flag and `ready.root` stay. `ready.root` is not a
   * sibling of `top`: it is a **library** path (`/` at the top), and
   * `bulk-thumbnail-jobs` scopes a whole-library job on it, so withholding it
   * would break that change while protecting nothing.
   *
   * One helper, read by `/api/library` and by the gate middleware's not-ready
   * envelopes both, so the two accounts of one state cannot drift apart.
   */
  function viewerState(s: LibraryState): LibraryState {
    if (features.hostDetails) return s
    if (s.state === 'ready') {
      const { top: _top, ...rest } = s
      return rest
    }
    if (s.state === 'missing') {
      const { root: _root, ...rest } = s
      return rest
    }
    if (s.state === 'nested') {
      const { root: _root, library: _library, ...rest } = s
      return rest
    }
    return s
  }

  /**
   * The index's availability as this deployment's viewer may read it (D9).
   *
   * `detail` is mini-classify's own free text — its failure's reason and hint,
   * able to name its cache directory or its collection root — so under the host
   * field it does not go on the wire. The server keeps composing it, and
   * `semantic.ts` is untouched: what changes is what three routes put in an
   * answer, since a client-side collapse would leave `curl` returning exactly
   * what the sentence was rewritten to hide.
   */
  function viewerIndexStatus(s: IndexAvailability): IndexAvailability {
    if (features.hostDetails) return s
    const { detail: _detail, ...rest } = s
    return rest
  }

  /**
   * A message this server did not compose, on its way to a viewer who may not
   * be told about the host (D9/D11). Returns what may go on the wire.
   *
   * The typed errors are not this: a `LibraryError`, `ListingError`, `VPathError`
   * or `ZipError` says something this codebase wrote, about a library path or a
   * constant, and travels whatever the deployment declares. What passes through
   * here is free text from *somewhere else* — a Node `Error` from the
   * filesystem, a launcher's account of a command that failed, an index's own
   * explanation — and the ones that name a path name a path **on the operator's
   * machine**: `EACCES: permission denied, open '/tmp/…/models.zip'`,
   * `spawn gtk-launch ENOENT`, `…/harrifex.obj is not in the cache`. There is no
   * predicting which of them does, because none of them is ours to predict.
   *
   * So the choice is made once, here, rather than at each branch that answers
   * with such a message — a branch is exactly the thing that gets added later
   * and forgets. A new one calls this and is covered.
   *
   * **The message is not lost, it is redirected.** It goes to the server's log,
   * where the operator is, beside the route that produced it; the viewer gets the
   * same status and a sentence written here. A public deployment's diagnosis is
   * the operator's job, and this is the only place the two audiences part.
   */
  function viewerError(c: Context, message: string, generic: string): string {
    if (features.hostDetails) return message
    console.error(`${c.req.path}: ${message}`)
    return generic
  }

  /**
   * Both scoring routes' one answer to an `IndexError`: `indexErrorReply` picks
   * the status and the sentence, `viewerError` applies the rule and writes the
   * log line. The two agree by construction — where the host is the viewer's
   * concern both hand back `err.message`, so the body is byte-identical to what
   * this route answered before the rule existed.
   */
  function indexError(c: Context, err: IndexError): Response {
    const { body, status } = indexErrorReply(err, features.hostDetails)
    return c.json({ ...body, error: viewerError(c, err.message, body.error) }, status)
  }

  app.use('/api/*', guard(origins))

  /**
   * The library's state, and — while it is not `ready` — the answer every path
   * route gives instead of a listing (D4). 503 with a state envelope is the
   * shape `indexErrorReply` already gives the client for an absent index: "the
   * thing is not there" is a state the UI renders, not a fault.
   *
   * The exceptions are the routes that are about the *app* rather than about a
   * path: the state itself, the machine's application registry, this server's
   * own capabilities, and the index's availability. Re-asked per request,
   * because `missing` is re-evaluated each time — a volume mounted after start
   * needs no restart.
   */
  const UNGATED = new Set([
    '/api/library',
    '/api/apps',
    '/api/features',
    '/api/semantic/status',
  ])
  app.use('/api/*', async (c, next) => {
    if (UNGATED.has(c.req.path)) return next()
    // Read through the same withholding `/api/library` answers with, so the
    // envelope on a path route and the state route's own answer cannot say
    // different things about one deployment (D11). Where the host is not the
    // viewer's concern the locations are gone here and the sentence names the
    // state alone — mounting a volume and repointing a root are an operator's
    // remedies, and this envelope reaches anyone, on every path route.
    const s = viewerState(await library.state())
    if (s.state === 'ready') return next()
    if (s.state === 'missing') {
      return c.json(
        s.root === undefined
          ? { error: 'the library is not present', state: s.state }
          : { error: `the library at ${s.root} is not present`, state: s.state, root: s.root },
        503,
      )
    }
    if (s.state === 'nested') {
      // The root encloses a library rather than being one (R1). Both paths are
      // named because the remedy is to point the root at the second — unless
      // neither is the viewer's to act on, when the state stands alone.
      return c.json(
        s.root === undefined || s.library === undefined
          ? { error: 'the root contains a library', state: s.state }
          : {
              error: `the root ${s.root} contains a library at ${s.library}`,
              state: s.state,
              root: s.root,
              library: s.library,
            },
        503,
      )
    }
    if (s.state === 'unconfigured') {
      return c.json({ error: 'no library root is configured', state: s.state }, 503)
    }
    // Every state is handled above, and the compiler is what says so. This
    // branch used to be the fall-through, answering "no library root is
    // configured" for anything it did not recognise — so a state added to
    // `LibraryState` would have been reported to the user as a missing
    // configuration, and nothing would have failed to build.
    return unreachable(s)
  })

  /**
   * The library's state. Answered through `viewerState`, so a deployment that
   * declares the host none of the viewer's business sends no filesystem
   * location here either — the state, the identity and the library-path `root`
   * are what remain (D11).
   */
  app.get('/api/library', async (c) => c.json(viewerState(await library.state())))

  /**
   * The typed branches carry sentences this codebase wrote — a library path, a
   * constant, an archive's own grammar — and are unchanged by `hostDetails`,
   * which is a rule about the *host's* locations and not about anything
   * path-shaped. The fall-through is the opposite: whatever threw, in its own
   * words, which for a Node `Error` is a host path (`EACCES: permission denied,
   * open '/tmp/…/models.zip'` — a zip whose mode is 000, on `/api/dir` and
   * `/api/file` both). It goes through `viewerError` for that reason.
   */
  app.onError((err, c) => {
    if (err instanceof LibraryError) return c.json({ error: err.message }, err.status)
    if (err instanceof ListingError) return c.json({ error: err.message }, err.status === 404 ? 404 : 400)
    if (err instanceof VPathError) return c.json({ error: err.message }, 400)
    if (err instanceof ZipError) return c.json({ error: err.message }, 422)
    return c.json({ error: viewerError(c, err.message, 'internal error') }, 500)
  })

  app.get('/api/dir', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const flat = c.req.query('flat') === 'true'
    const q = c.req.query('q')
    const blankQ = q === undefined || q.trim() === ''
    if (!blankQ && !flat) return c.json({ error: 'q requires flat=true' }, 400)
    // Additive and default-on: absent means the shipped predicate.
    const folderMatching = c.req.query('folders') !== 'false'
    // Canonicalised once, then used for everything downstream: what a listing
    // echoes as its `path` is what the client asks for next, so a spelling
    // taken in verbatim (`//kit`, `/kit/.`) would be handed straight back and
    // carried forward.
    const libPath = canonicalLibPath(path)
    // Stored display names ride the listing rather than being asked for per
    // tile: a grid is hundreds of tiles, and an exact-key Map get costs what
    // the `size` field costs (library-overrides D7). Both return paths get it —
    // the flat/deep-search listing is a listing shape like any other.
    if (flat) {
      // Through the listing cache, which serves the snapshot where there is one
      // and owns the `stale` marker; with no store behind it this is `listFlat`
      // and nothing else.
      const listing = await listings.list(library, libPath, q, { folderMatching })
      // Fill first, annotate second (§6.9): the fill's only job is putting more
      // in the layers before the pass below reads them, so a fact it fetched
      // and a fact a peek recorded reach the wire by the same path.
      await fillAnnotations(fillKey(libPath, true, q, folderMatching), listing.entries)
      // Annotation first, names second: `annotate` may attach a dir entry's
      // preview cells, which are model tiles the naming pass must also reach
      // (it recurses into `entry.preview`) — named before annotation, a carried
      // sheet would show raw filenames where a fresh peek shows the stored
      // name (288f55a's review, finding 1).
      annotate(listing.entries)
      applyDisplayNames(listing.entries, await overrides.store())
      return c.json(listing)
    }
    const listing = await listDir(library, libPath, snapshots?.archiveCache())
    // Same order as the flat branch, for its reason — fill, annotate, name.
    await fillAnnotations(fillKey(libPath, false, undefined, folderMatching), listing.entries)
    annotate(listing.entries)
    applyDisplayNames(listing.entries, await overrides.store())
    return c.json(listing)
  })

  /**
   * Every model beneath a library path, with the thumbnail facts a listing
   * carries (§6.7) — the scope a bulk job reads before it derives its work list
   * (`bulk-thumbnail-jobs` D8).
   *
   * **An enumeration, not a listing, and the difference is the point.**
   * `MODEL_BROWSER_FLAT_CAP` bounds what a *listing* returns, because a grid
   * shows a screenful; a scope silently cut to a cap would be a different scope,
   * and a job that rendered 500 of 600 models while reporting success would be
   * wrong in the one way nobody would notice. So no cap applies here. The walk's
   * step budget still does — that bounds the **work**, not the **answer** — and
   * a traversal it stops is reported as incomplete rather than refused: the
   * caller is about to read every one of these models anyway, and a job that
   * knows its scope was cut can say so.
   *
   * A path route like `/api/dir`: canonicalised the same way, gated by the
   * library's not-ready envelope with no code of its own, and 404/400 on the
   * same distinctions for the same reasons — including for a path that only
   * *looks* like it lies under a cached root, which is resolved before an
   * ancestor's tree is allowed to answer for it (round-2 finding 4a).
   *
   * **This route waits where `/api/dir` does not** (round-2 finding 4b).
   * `ListingCache.enumerate` runs the revalidation pass before answering when
   * the covering root's stamp is missing or past `REVALIDATE_TTL_MS`, rather
   * than serving marked and converging afterwards. An enumeration feeds a job's
   * work list, not a grid: an unchecked tree here means rendering models that
   * are gone and skipping ones that arrived, reported as a success, and there is
   * no staleness marker on this shape for a caller to notice it by. Correct over
   * instant. The wire is unchanged — the wait is invisible except as latency,
   * bounded by one `stat` per directory and paid only past the cadence.
   */
  app.get('/api/models', async (c) => {
    // A maintenance route, refused on the first line like every other (D5).
    // Its only consumer is the bulk jobs' scope read — the enumeration a job
    // builds its work list from — so a deployment that does not offer bulk
    // work does not answer the question the launcher would ask first, and a
    // whole-library enumeration is not a thing a visitor has standing to ask
    // for besides.
    if (!features.maintenance) return refuse(c, 'maintenance')
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const libPath = canonicalLibPath(path)
    const { models, complete } = await listings.enumerate(library, libPath)
    applyDisplayNames(models, await overrides.store())
    // The same annotation object a listing carries, from the same index by the
    // same key lookup — never a second shape for the same fact.
    annotate(models)
    const body: ModelsListing = { path: libPath, entries: models, complete }
    return c.json(body)
  })

  /**
   * Freshness on demand (§6.6, design D9): run the incremental pass now for
   * every cached root and say whether anything moved.
   *
   * No machinery of its own — it is `ListingCache.reload`, the seam built for
   * exactly this, over the roots the store holds. Never a full re-walk: the
   * cost is one `stat` per directory, the same check routine revalidation uses,
   * and a root with no snapshot is nothing to reload rather than a reason to
   * walk one.
   *
   * `reload`, not `revalidate`, and the difference is the endpoint's whole
   * contract (round-2 finding 7). `revalidate` joins a pass already in flight,
   * which is right for a serve; joining one here would let a pass that started
   * **before** the user's edit answer for the reload — it stat'd those
   * directories while the tree still looked the way it used to — and report
   * "nothing moved" about a library that had. The requirement is that a listing
   * after a completed reload reflects what the reload found, so the pass this
   * reports must be one that began after the gesture.
   *
   * The derived layers go wholesale, because a reload is the user saying "what
   * you have may be wrong" and the layers are the part of that the server cannot
   * check for itself — there is no build identity to compare an index's poses
   * against (design D7, review M9). The tree is *revalidated* instead of
   * dropped, because for the tree there is such a check.
   *
   * A POST: it drops caches and rewrites snapshots. Sequential across roots, so
   * a reload of a library with several cached trees does not put two passes on
   * the same disk head — the contention `search-cancellation` recorded.
   */
  app.post('/api/reload', async (c) => {
    // The maintenance field's first consumer (D4): dropping every cached layer
    // and revalidating each snapshot root acts on this server's own derived
    // state rather than answering a question about the library, it is expensive,
    // and it acts for every viewer at once. Refused before `dropAll`, so a
    // refused reload drops nothing.
    if (!features.maintenance) return refuse(c, 'maintenance')
    layers.dropAll()
    const roots = snapshots === undefined ? [] : await snapshots.roots()
    let changed = false
    for (const root of roots) {
      if (await listings.reload(library, root)) changed = true
    }
    const body: ReloadResult = { ok: true, roots: roots.length, changed }
    return c.json(body)
  })

  /**
   * One entry's effective overrides — the field-wise merge over its ancestor
   * keys, or `{}` where nothing resolves (D3).
   *
   * Asked per viewed entry, not folded into `/api/dir`: listings are the hot
   * path, and resolving all fields for hundreds of entries per request to serve
   * a panel that shows one is the trade `folder-contact-sheets` already refused
   * for previews. The answer is a memory lookup server-side.
   *
   * A path route on the established pattern — canonicalised like `/api/dir` and
   * `/api/peek`, resolved through the library so a refused path is refused here
   * too, and gated by the not-ready envelope middleware with no code of its own.
   */
  app.get('/api/overrides', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const libPath = canonicalLibPath(path)
    await library.resolve(libPath)
    return c.json(resolveOverrides(await overrides.store(), libPath))
  })

  /**
   * The models a folder tile draws in its contact sheet (D1): a bounded
   * depth-first look inside one directory, asked for per tile as the tile comes
   * on screen. Deliberately not a field on every `DirEntry` — a listing would
   * then pay a peek per subdirectory up front, on the cold path, for folders
   * that may never be scrolled to.
   *
   * A path route like the rest, so the not-ready gate above answers it with the
   * state envelope and nothing here has to.
   *
   * Which models it shows is `posedFirstPeek`'s: the walk is the same walk, and
   * the index only reorders and cuts what it found.
   */
  app.get('/api/peek', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const raw = c.req.query('n')
    let n = PEEK_DEFAULT
    if (raw !== undefined) {
      const asked = Number(raw)
      if (!Number.isInteger(asked) || asked < 1) return c.json({ error: `invalid n: ${raw}` }, 400)
      // Capped rather than refused: the ceiling is this server's own opinion
      // about what a sheet can show, not a malformed request to report back.
      n = Math.min(asked, PEEK_MAX)
    }
    // Canonicalised first, for the reason `/api/dir` gives: the paths that come
    // back are the ones the client asks for next.
    const libPath = canonicalLibPath(path)
    // A peek's answer is ordinary listing entries, so sheet labels come along
    // from the same seam the browse uses (library-overrides D7) — applied to
    // the posed-first ranking's output, since the ranking reorders entries and
    // never renames them.
    // `learned` deliberately dropped here, where `fillPreviews` records it
    // (round-3 finding 3). This route's answer is pinned byte-for-byte against
    // the bare walk's when the index is unindexed (`pose-for-every-model` D5's
    // determinism cells), and recording would make the `annotate` below attach a
    // `pose` to every cell — a wire change to a shape another capability owns.
    // The fill's own derivations record, so a *listing's* carried sheet arrives
    // posed either way, which is where the client's preview wave reads from.
    const { entries, collectionRootFs } = await posedFirstPeek(
      library,
      libPath,
      n,
      undefined,
      snapshots?.archiveCache(),
    )
    // Recorded **before** the naming pass, so an override name a later request
    // removes cannot survive inside the layer: what is kept is the choice — the
    // models and their order — never how they were labelled on one request.
    layers.recordPreview(collectionRootFs, libPath, n, entries)
    applyDisplayNames(entries, await overrides.store())
    annotate(entries)
    return c.json(entries)
  })

  app.get('/api/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    // Canonicalised like every sibling path route, and this was the one that
    // was not. `library.resolve` normalises internally for its own confinement,
    // so what the spelling reached was the 404 below: a miss echoed the path
    // back exactly as asked, so `/kit/../gone.stl` came back named that way —
    // this route answering in a spelling `/api/dir` and `/api/peek` would have
    // rewritten before saying anything.
    const libPath = canonicalLibPath(path)
    const { fsPath, entry } = await library.resolve(libPath)

    // octet-stream + nosniff make ORB dependably block no-cors embeds, which
    // carry no Origin and so pass the guard's origin check.
    const headers = {
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    }
    if (entry !== undefined) {
      if (/\.zip$/i.test(entry)) return c.json({ error: 'nested zips are unsupported' }, 400)
      let bytes
      try {
        bytes = await extractEntry(fsPath, entry)
      } catch (err) {
        // `listZipDir`'s taxonomy, on the route that hands the bytes over: the
        // archive resolved through the library, so a failure to read it is a
        // library entry failing and is named as one. Untyped, it escaped as the
        // host path the `open` failed on.
        if (err instanceof ZipError) throw err
        throw new ListingError(404, `cannot read zip: ${archiveOf(libPath)}`)
      }
      return c.body(new Uint8Array(bytes), 200, headers)
    }
    // Model formats only, and anything else answered **exactly** as a file
    // that is not there. The predicate is the one a listing already decides by
    // (`modelFormat`), so what a listing hides a URL cannot fetch either — a
    // deployment's `notes.txt`, its `passwords.kdbx`, the README beside a kit.
    // A rule at the route rather than an exclusion in whatever copies the
    // library up: the next rsync forgets a runbook, and this survives it.
    // Answered as missing rather than refused so a URL cannot confirm that a
    // non-model exists, which a distinct status would do.
    if (modelFormat(libPath) === undefined) {
      return c.json({ error: `no such file: ${libPath}` }, 404)
    }
    const s = await stat(fsPath).catch(() => null)
    if (s === null || !s.isFile()) return c.json({ error: `no such file: ${libPath}` }, 404)
    // Byte ranges, on the branch that streams from disk. A viewer that reads a
    // header before the mesh, and a resumed transfer over a link that dropped,
    // both ask for one; every 200 here says so. The zip branch below has the
    // whole entry in memory already and ignores `Range` — permitted, and there
    // is no partial read to save there.
    const ranged = { ...headers, 'accept-ranges': 'bytes' }
    const range = parseRange(c.req.header('range'), s.size)
    if (range === 'unsatisfiable') {
      return c.body(null, 416, { ...ranged, 'content-range': `bytes */${s.size}` })
    }
    if (range !== null) {
      const { start, end } = range
      const part = Readable.toWeb(createReadStream(fsPath, { start, end })) as ReadableStream
      return c.body(part, 206, {
        ...ranged,
        'content-range': `bytes ${start}-${end}/${s.size}`,
        'content-length': String(end - start + 1),
      })
    }
    const stream = Readable.toWeb(createReadStream(fsPath)) as ReadableStream
    return c.body(stream, 200, { ...ranged, 'content-length': String(s.size) })
  })

  /**
   * The one path pipeline both launch endpoints share: validated exactly as
   * `/api/file` validates (resolved through the library, nested zips rejected,
   * existence), zip entries temp-extracted, and the result **always absolute**
   * — a relative path breaks applications that resolve it against a running
   * instance's working directory (app-launch L5/L7). A path the library
   * refuses throws a `LibraryError` that `onError` renders, the same refusal
   * every other route gives.
   */
  type Resolved =
    | { ok: true; file: string }
    | { ok: false; body: { error: string }; status: 400 | 404 }

  async function resolveEntryFile(raw: string): Promise<Resolved> {
    // One spelling before the temp file is named: `fileFor` keys the extracted
    // entry on this string, and two spellings of one entry would otherwise
    // stage the same bytes twice.
    const path = canonicalLibPath(raw)
    const { fsPath, entry } = await library.resolve(path)
    if (entry !== undefined && /\.zip$/i.test(entry)) {
      return { ok: false, body: { error: 'nested zips are unsupported' }, status: 400 }
    }
    // `/api/file`'s model-format rule, on the other route that turns a library
    // path into bytes on this machine: launching a non-model is the same
    // exposure as serving one, and answered the same way — as a file that is
    // not there. Loose files only, as there: an entry inside an archive is a
    // name the zip reader looks up, not a path this rule can widen.
    if (entry === undefined && modelFormat(path) === undefined) {
      return { ok: false, body: { error: `no such file: ${path}` }, status: 404 }
    }
    const s = await stat(fsPath).catch(() => null)
    if (s === null || !s.isFile()) {
      return { ok: false, body: { error: `no such file: ${path}` }, status: 404 }
    }
    if (entry !== undefined) {
      try {
        return { ok: true, file: await zipTemp.fileFor(path, fsPath, entry) }
      } catch (err) {
        // The same unreadable archive reaches the launch endpoints, through the
        // third `extractEntry` call site — `fileFor` extracts before it stages.
        //
        // Narrowed to failures on the **archive itself**, deliberately: the rest
        // of `fileFor` writes and renames inside the temp store, and an
        // out-of-space or unwritable tmpdir is the server's own problem, not a
        // library entry that could not be read. Rebranding it as one would send
        // an operator to look at the archive. Both runtimes carry `path` on an
        // fs error and both set it to the file the `open` failed on (probed
        // under Node 24 and Bun, EACCES on a mode-000 archive).
        if (err instanceof ZipError) throw err
        if ((err as NodeJS.ErrnoException | null)?.path === fsPath) {
          throw new ListingError(404, `cannot read zip: ${archiveOf(path)}`)
        }
        throw err
      }
    }
    return { ok: true, file: resolvePath(fsPath) }
  }

  /**
   * What the platform registry says about the model types this app handles.
   *
   * No path parameter and no path validation: the report is about the machine,
   * not an entry. Read fresh every request — the chooser can rewrite the
   * registry mid-session, so a memoized answer would go stale exactly when it
   * mattered (L5).
   */
  app.get('/api/apps', async (c) => {
    // Short-circuited **before** `report()`, not a filter over what it returned
    // (D5): `report()` loops the handled model types calling `queryDefault`,
    // whose builtin execs `xdg-mime` and then reads the machine's application
    // entries for their names — so filtering afterwards would still spawn and
    // still read the operator's installed applications. An empty report is a
    // 200, not a refusal: this route is advisory by definition, and the whole
    // of the client's withholding is that it names nothing.
    if (!features.appLaunch) {
      const empty: AppsReport = { chooser: false, types: {} }
      return c.json(empty)
    }
    return c.json(await launcher.report())
  })

  /**
   * What this server accepts and offers (feature-report D2).
   *
   * Its own route rather than a rider on `/api/library`: that answer is dynamic
   * per-request state, this is static per-process configuration, and mixing
   * them would couple every state answer to config wiring. Ungated for the same
   * reason `/api/apps` is — the surfaces it shapes exist in every library
   * state, so the client needs it before there is a library.
   *
   * Answered verbatim from the injected value: nothing is recomputed here, and
   * nothing about the request can change it.
   */
  app.get('/api/features', (c) => c.json(features))

  /**
   * Launch an application with an entry's file. The client sends an
   * application id, never a command.
   *
   * A failed launch is a 502, on `indexErrorReply`'s reasoning: the command ran
   * and the thing downstream failed, which is a bad gateway rather than a fault
   * of this server's own code. Success means the launch command succeeded and
   * nothing more — `wine start` exits 0 once it hands off, so a Wine app that
   * then fails to open the file reads as success here, and pretending otherwise
   * would be false precision (L8).
   */
  app.post('/api/open', async (c) => {
    // First, before the body is even read: a refused launch spawns nothing and
    // resolves no path (D5).
    if (!features.appLaunch) return refuse(c, 'appLaunch')
    const body = (await c.req.json().catch(() => null)) as
      | { path?: unknown; appId?: unknown }
      | null
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return c.json({ error: 'path is required' }, 400)
    }
    const appId = body?.appId
    if (typeof appId !== 'string' || appId.trim() === '') {
      return c.json({ error: 'appId is required' }, 400)
    }
    const target = await resolveEntryFile(path)
    if (!target.ok) return c.json(target.body, target.status)
    try {
      await launcher.launch(appId, target.file)
    } catch (err) {
      // The reason is the command's own — an exit status with its stderr, or a
      // spawn failure naming the binary and the host's tmpdir — so it travels
      // under `viewerError`'s rule rather than verbatim.
      if (err instanceof LaunchError) {
        return c.json({ error: viewerError(c, err.message, 'the launch failed') }, 502)
      }
      throw err
    }
    return c.json({ ok: true })
  })

  /**
   * Hand an entry's file to the machine's own configured chooser.
   *
   * Unconfigured is **unavailable, not a failed launch** — a state the UI
   * renders by withholding the action, which is `/api/semantic`'s reasoning for
   * its own 503 rather than a 500. Nothing is spawned on that path.
   *
   * The request completes when the chooser command does, however long the human
   * takes (L9). No timeout and no abort are wired here — `SpawnOptions` has no
   * `signal` to wire — because a dismissed chooser and a killed one must never
   * read the same.
   */
  app.post('/api/open-with', async (c) => {
    // Before the body, and before `chooserConfigured` is consulted: a
    // deployment that withholds the launcher says so, rather than reporting on
    // whether the operator happens to have a chooser configured.
    if (!features.appLaunch) return refuse(c, 'appLaunch')
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return c.json({ error: 'path is required' }, 400)
    }
    if (!launcher.chooserConfigured) {
      return c.json({ error: 'no chooser is configured', unavailable: true }, 503)
    }
    const target = await resolveEntryFile(path)
    if (!target.ok) return c.json(target.body, target.status)
    try {
      await launcher.chooser(target.file)
    } catch (err) {
      // As on `/api/open`: the chooser's own account of its failure.
      if (err instanceof LaunchError) {
        return c.json({ error: viewerError(c, err.message, 'the launch failed') }, 502)
      }
      throw err
    }
    return c.json({ ok: true })
  })

  /**
   * Availability of the semantic index. Cached per state by `indexStatus`, so
   * this is cheap enough for the client to re-read on the interactions it
   * already makes; `fresh=true` is the explicit retry (D4).
   */
  app.get('/api/semantic/status', async (c) => {
    const s = await indexStatus(library, { fresh: c.req.query('fresh') === 'true' })
    return c.json(viewerIndexStatus(s))
  })

  /**
   * The index's orientations for one directory's models (D2) — what a search
   * hands the client on its hits, for a plain listing that has none.
   *
   * A **path** route, not an availability one: gated by the library like
   * `/api/dir`, canonicalised the same way and answering the same 400 and 404
   * for the same reasons, because a client asking about a directory that is not
   * there has made the same mistake whichever route it made it on. Only the
   * *index's* absence is silent — that answers `{}`, never a status, so the
   * listing this rides behind cannot be made to fail by a service it is
   * deliberately independent of.
   *
   * A GET with the path in the query, unlike the two scoring routes' POSTs:
   * there is no phrase or tuning here, only the directory the client is already
   * looking at.
   */
  app.get('/api/semantic/poses', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    // Canonicalised for `/api/dir`'s reason: this answer is keyed by the paths
    // the client asks about next, and a spelling taken in verbatim (`//kit`,
    // `/kit/.`) would key it under names no tile carries.
    const libPath = canonicalLibPath(path)
    const poses = await posesForDir(library, libPath)
    // The pose layer is filled from the answers that already pass through this
    // server (§6.1) — never by asking the index on the layer's own account. The
    // next listing that includes these models carries their orientations inline,
    // and the client's wave shrinks to what remains unknown.
    //
    // **No asked-list, unlike the POST beside it** (round-3 finding 6, resolved
    // here). This route's question is a *directory* and the models in it are
    // enumerated inside `posesForDir`, which lists the directory itself — so the
    // list the negatives would be stamped against does not exist at this layer,
    // and manufacturing one would mean threading `answered` back out through
    // `posesForDir` and `posesForListing` for a route **nothing under
    // `client/src` calls** (see `ApiClient.semanticPoses`: the wave asks by path
    // and lands on the POST). The negative loop is closed where the wave
    // actually goes. If a client-side caller ever returns, widen `posesForDir`
    // the way `posesListingAsked` widens `posesForListing` and pass its list.
    layers.recordPoses(await collectionRoot(), poses)
    const body: PosesResponse = { poses }
    return c.json(body)
  })

  /**
   * The same supply for a listing that is not one directory's contents: the
   * client names the models it landed, and gets their poses.
   *
   * The GET above answers a *folder*, which is all a plain browse ever needs.
   * A flat listing and a name search are the cases it cannot serve — they draw
   * models from every folder beneath the browsed one, so a folder-shaped
   * question answers for the few that sit at its top and leaves the rest at
   * default framing. The entries that landed are the question here, and this
   * route is the only place the client can put it.
   *
   * A POST because the paths are the body — a listing's worth of them will not
   * fit in a query string — and not because it changes anything; like the GET
   * it is a read, and it is gated by the library exactly the same way (same
   * path, so the not-ready envelope middleware covers both).
   *
   * Refused past `POSES_MAX`, in the shape every other invalid field is refused
   * in. That is the index's own bound on one `/poses` call, so it is what makes
   * this route one request in, at most one request out; a client with more to
   * ask about asks twice. It is not a bound on what this *server* may assemble
   * for itself — `posesForDir` still chunks a directory of any size.
   *
   * Which paths are answerable is not this route's business: each is
   * canonicalised the way the GET canonicalises its one path, and then
   * `posesForPaths` confines it exactly as a search hit is confined. A path the
   * library refuses, or one outside the collection, is simply absent from the
   * answer — a 404 for one bad entry would let a stale tile fail the poses of
   * every good one beside it, and a listing may never be made to fail by the
   * index.
   *
   * That rule reaches the *canonicalisation* too, and did not always: mapping
   * the batch in one expression let one path that is not spelled like a library
   * path — no leading slash, past the length bound, a nested `!/` — throw out of
   * the map and 400 the whole request, so a single stale tile in a five-hundred
   * model listing cost every other tile its pose. It is refused per path here,
   * and refusal means dropped, exactly as every other per-path refusal on this
   * route means dropped. The array-of-strings check above is the one that stays
   * a 400: a non-string element is a caller bug about the request's *shape*,
   * while an unspellable path is one entry the answer has nothing to say about.
   */
  app.post('/api/semantic/poses', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { paths?: unknown } | null
    const given = body?.paths
    if (!Array.isArray(given)) return c.json({ error: 'paths is required' }, 400)
    const raw: readonly unknown[] = given
    // Every element a string, or none of it is a request: a listing that sent
    // one stray value has a bug the answer should name, not a pose to look up.
    const paths = raw.filter((p): p is string => typeof p === 'string')
    if (paths.length !== raw.length) return c.json({ error: 'paths is required' }, 400)
    if (paths.length > POSES_MAX) {
      return c.json({ error: `invalid paths: ${paths.length} (max ${POSES_MAX})` }, 400)
    }
    const canonical: string[] = []
    for (const p of paths) {
      try {
        canonical.push(canonicalLibPath(p))
      } catch (err) {
        // The two ways a string can fail to be a library path at all, both of
        // them this route's to swallow. Anything else is a fault, not a path.
        if (!(err instanceof LibraryError) && !(err instanceof VPathError)) throw err
      }
    }
    const { poses, answered } = await posesListingAsked(library, canonical)
    // The asked-list goes in, which closes the negative loop on the wire (§6.9,
    // round-3 finding 6). This is the route the client's pose **wave** lands on,
    // so a model the wave asked about and the index did not name is recorded as
    // "asked, none" here — and the next listing carries `pose: null`, which the
    // wave reads as known and does not ask about again. Without it a folder the
    // index has never embedded costs a wave on every landing forever: the answer
    // was in this server's hands and it threw it away.
    //
    // `answered` gates it for `fillPoses`' reason, restated because this route's
    // failure mode is the visible one: an index that is down answers `{}` too,
    // and stamping negatives on that would silence poses for a whole horizon
    // over a service the pose layer is meant to be independent of.
    //
    // A wave answer also **restamps** what it re-confirms, positives and
    // negatives alike: `recordPoses` writes `recordedAt` on every path it is
    // handed, so the horizon is measured from the last time the index said so.
    layers.recordPoses(await collectionRoot(), poses, answered ? canonical : [])
    const answer: PosesResponse = { poses }
    return c.json(answer)
  })

  /**
   * A meaning query. Deliberately not folded into `/api/dir`: it consults a
   * different corpus, and its failure modes are its own — an index that is not
   * running is a state this app reports, not an error it raises (D1).
   */
  app.post('/api/semantic', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | {
          text?: string
          path?: string
          raw?: boolean
          pool?: 'mean' | 'max' | 'softmax'
          top?: number
          minScore?: number
        }
      | null
    const text = body?.text
    if (typeof text !== 'string' || text.trim() === '') {
      return c.json({ error: 'text is required' }, 400)
    }
    // Refused before the index is asked anything, `SEARCH_TEXT_MAX`'s reason —
    // which is *not* the one written here until 2026-09-08. A phrase past what
    // the index takes was said to reset the connection, and so to read as "the
    // index is not running" to the probe every other query shares. Measured: it
    // is a proper 500, no reset, availability stays `ready`, and the index's
    // limit is a token budget rather than a character count (see
    // `SEARCH_TEXT_MAX`). Nothing leaks to other requests, so this bound is a
    // coarse guard that keeps a pasted paragraph from becoming a round trip.
    if (text.length > SEARCH_TEXT_MAX) return c.json({ error: 'text is too long' }, 400)
    // Both halves of availability from one probe: the library path the client
    // is told about, and the absolute root the index itself must be asked
    // about (D6). The gate is the *index's* root — a collection the library
    // does not hold is not unavailability, it is a collection that covers
    // nothing here, and every scope inside the library then fails the
    // containment test below on its own.
    const { status, collectionRootFs } = await probeStatus(library)
    if (status.state !== 'ready' || collectionRootFs === undefined) {
      // Not a 500: "the index is not there" is a state the UI renders, and the
      // state itself is what tells the user which thing to do about it.
      return c.json(
        // `detail` through the same withholding `/api/semantic/status` uses: it
        // is undefined here on a deployment that declares the host none of the
        // viewer's business, and `JSON.stringify` drops the key (D9).
        { error: 'index unavailable', state: status.state, detail: viewerIndexStatus(status).detail },
        503,
      )
    }
    // Virtual paths never leave this server (D7), and a scope outside the
    // collection is not the index's to answer.
    const scope =
      body?.path === undefined || body.path === ''
        ? null
        : await scopeWithin(library, body.path, collectionRootFs)
    if (body?.path !== undefined && body.path !== '' && scope === null) {
      return c.json({ error: 'path is outside the indexed collection' }, 400)
    }
    let result
    try {
      result = await indexQuery(text, scope, {
        raw: body?.raw,
        pool: body?.pool,
        top: body?.top,
        minScore: body?.minScore,
      })
    } catch (err) {
      if (err instanceof IndexError) return indexError(c, err)
      throw err
    }
    const { entries, poses, scores } = await hitsToEntries(library, result.results, collectionRootFs)
    // A meaning grid is a primary browsing mode: its tiles carry what the
    // caches know exactly as a listing's do (`thumbnail-image-serving` D2), or
    // it would keep the full lookup cost the listing routes have shed.
    annotate(entries)
    // The scope the index says it answered under, as a library path (D2) —
    // `scopeLibPath` reads why it can never be the index's own spelling.
    const scopePath = await scopeLibPath(library, result.scope.path)
    return c.json({
      // A library path, like every other path on the wire (D2): the scope's,
      // else the collection's. A collection the library does not hold has no
      // library path — and no hit inside it does either, so what comes back is
      // the library root and an empty set of tiles.
      path: scope !== null ? library.libPathOf(scope) : (status.collectionRoot ?? '/'),
      entries,
      poses,
      scores,
      weak: result.weak,
      // The index's ceiling, not the ranking's horizon (D2): it returned fewer
      // than was asked for, and what was asked for is the user's control.
      capped: result.truncated === true,
      // What the count cut from, forwarded only when the index reports it —
      // the field is additive both ways, so an older index leaves it absent
      // and the client says nothing extra (D9).
      ...(result.matched !== undefined ? { matched: result.matched } : {}),
      scope: {
        // Never the index's own string: it is the real filesystem path this
        // route handed it (`scopeWithin`), echoed back, so it names the host on
        // every deployment. A library path or `null`, whatever `hostDetails`
        // says — one rule rather than a fifth branch, and the same translation
        // `path` above is built from.
        path: scopePath,
        status: result.scope.status,
        indexed: result.scope.n_indexed,
        scanned: result.scope.n_scanned,
        covers: result.scope.covers,
      },
    })
  })

  /**
   * A model's nearest neighbours. Beside the meaning query rather than folded
   * into it: it asks a different question of the same service — a model instead
   * of a phrase — and its one distinctive failure (this model is not embedded)
   * is not a failure `/api/semantic` has.
   *
   * **No scope is sent** (D4/4.1a): neighbours come from the whole indexed
   * collection, which is the index's own default, so this states that default
   * rather than passing a value. The model's own path is still resolved through
   * `scopeWithin` first — not to be sent as a scope, but because a virtual path
   * must never leave this server (D7) and a path outside the collection is not
   * the index's to answer. The honest client never sends either: the command is
   * absent on archive entries and outside the collection (D6). This is the
   * boundary refusing a hand-made request, and it is what keeps the 404 below
   * meaning exactly one thing.
   */
  app.post('/api/semantic/similar', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { path?: string; k?: number; pool?: string }
      | null
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return c.json({ error: 'path is required' }, 400)
    }
    // Validated, not defaulted: `k` is the client's deliberate choice (D4), and
    // silently substituting one here would mint a second default for a number
    // this server has no opinion about. Absent, the index's own applies.
    const k = body?.k
    if (k !== undefined && (!Number.isInteger(k) || k < 1 || k > 1000)) {
      return c.json({ error: `invalid k: ${String(k)}` }, 400)
    }
    // The same rule for the pooling, which is settable on screen now. Absent
    // still leaves the index's own — the value in force is whatever
    // `serve_api.py --pool` was started with — and only the three the index
    // names are forwarded, so a hand-made request cannot make it guess.
    const pool = body?.pool
    if (pool !== undefined && pool !== 'mean' && pool !== 'max' && pool !== 'softmax') {
      return c.json({ error: `invalid pool: ${String(pool)}` }, 400)
    }
    const { status, collectionRootFs } = await probeStatus(library)
    if (status.state !== 'ready' || collectionRootFs === undefined) {
      return c.json(
        // `detail` through the same withholding `/api/semantic/status` uses: it
        // is undefined here on a deployment that declares the host none of the
        // viewer's business, and `JSON.stringify` drops the key (D9).
        { error: 'index unavailable', state: status.state, detail: viewerIndexStatus(status).detail },
        503,
      )
    }
    const model = await scopeWithin(library, path, collectionRootFs)
    if (model === null) {
      return c.json({ error: 'path is outside the indexed collection' }, 400)
    }
    let result
    try {
      result = await indexSimilar(model, k, pool)
    } catch (err) {
      if (err instanceof IndexError) return indexError(c, err)
      throw err
    }
    // The same hit→tile join a meaning answer takes: this server's own view of
    // the tree, stat'd once per returned hit, never the index's description of a
    // model (D3).
    const { entries, poses, scores } = await hitsToEntries(library, result.results, collectionRootFs)
    // As on the meaning route: a similarity grid's tiles carry what the caches
    // know (`thumbnail-image-serving` D2).
    annotate(entries)
    // The model the neighbours were computed *from*, resolved into a tile of its
    // own. The index excludes the query model from its own ranking by design (it
    // scores 1.0 against itself and skews the z), so if the question is to be
    // visible beside its answer, this app is the only place that can add it.
    //
    // Its own field, never prepended into `entries`: the entries are the answer
    // and the anchor is the question, and a client that counted it would say a
    // model with no neighbours had one.
    //
    // Addressed by its library path, like every tile, and *named* the way a hit
    // is — relative to the collection — so it reads like the neighbours beside
    // it rather than as a path from the index's own view of the volume.
    // Omitted silently when it no longer stats: a model can be deleted after it
    // was embedded, and the neighbours are still a true answer without it.
    const anchor = await modelEntryAt(
      model,
      library.libPathOf(model),
      relative(collectionRootFs, model),
    )
    // The anchor is a tile too, and carries what the caches know like the
    // neighbours beside it.
    if (anchor !== null) annotate([anchor])
    // Deliberately without the index's `scope` dict. A similarity view reads
    // none of the meaning residue — `weak`, `capped`, the scope's coverage
    // counts are all facts about a *phrase's* result — and forwarding it would
    // make the client's label read the view as a meaning search (4.7).
    return c.json({
      // The collection as a library path (D2), and the library root where the
      // collection has none — it then encloses or misses the library, and the
      // entries are empty either way.
      path: status.collectionRoot ?? '/',
      entries,
      poses,
      // Keyed by library path like `poses` — the only kind that reaches this
      // wire since `library-root` — so the anchor below is simply not in it:
      // the index excludes the query model from its own ranking rather than
      // scoring it, and there is no hit to carry a number (D1).
      scores,
      ...(anchor !== null ? { anchor } : {}),
    })
  })

  app.get('/api/complete', async (c) => {
    const prefix = c.req.query('prefix') ?? ''
    return c.json(await complete(library, prefix))
  })

  /**
   * The key both thumbnail reads take — `path`, `mtime`, and which render —
   * validated the same way, or the 400 that says what was wrong. One parser so
   * the JSON route and the image route cannot come to key differently
   * (`thumbnail-image-serving` D1).
   *
   * Validated, not translated: the cache keys on the library path itself, so
   * what the library decides here is only whether this path is one the server
   * will speak about at all. Canonical, though — the key *is* the string, and
   * `/kit/../kit/a.stl` must not be a second entry beside `/kit/a.stl`.
   * Which render is wanted. Absent is `on`: that is what every request meant
   * before renders were keyed by occlusion, so a client from before this
   * change reads exactly what it always read (ao-as-recipe-dimension D2).
   */
  function thumbKeyOf(c: Context): { libPath: string; mtime: number; ao: boolean } | Response {
    const path = c.req.query('path')
    const mtime = Number(c.req.query('mtime'))
    if (path === undefined || Number.isNaN(mtime)) {
      return c.json({ error: 'path and mtime are required' }, 400)
    }
    const aoParam = c.req.query('ao')
    if (aoParam !== undefined && aoParam !== 'on' && aoParam !== 'off') {
      return c.json({ error: `invalid ao: ${aoParam}` }, 400)
    }
    return { libPath: canonicalLibPath(path), mtime, ao: aoParam !== 'off' }
  }

  /**
   * The cache tiers a thumbnail **hit** is served under, applied to the
   * response headers; returns whether the request is a revalidation the tiers
   * answer with 304 and no body. Extracted so the JSON route and the image
   * route apply exactly one policy (`thumbnail-image-serving` D1) — a miss is
   * each route's own to answer, `no-store`, before reaching here.
   *
   * Tier 1 — the reader named a generation. `path + mtime + ao + gen` names
   * these exact bytes, so if the number is current the answer can be pinned
   * for as long as the browser cares to keep it: any later write moves the
   * entry to a different `gen`, and this URL is simply never requested again
   * (`immutable-thumbnail-serving` D2). A number that is *not* current lost a
   * race with a write; it gets the current bytes and the current `gen` in the
   * body, uncacheable, so it re-keys on its next fetch rather than being
   * redirected or refused.
   *
   * `public` is deliberate and inert here: on loopback there is no
   * intermediary to act on it. It is written for the demo, where an edge
   * cache is exactly what should be allowed to hold these tiles.
   *
   * Tier 2 — the reader could not know the generation (a fresh session,
   * before anything has told it one). Validator caching: it stores the body
   * against this tag, and an unchanged entry then costs a 304 with no body
   * instead of the base64 PNG.
   *
   * The tag is the **entry's** generation even though this URL names one AO
   * variant. A write to either render moves it, so a write to one variant
   * makes the other revalidate once for nothing. That is deliberate
   * conservatism: the alternative is a per-render counter, and a reader keyed
   * on one render's number can be handed the other render's write without
   * noticing. One wasted 304 against never serving stale pixels.
   *
   * Exact match only. Every client that gets a tag here echoes back the bytes
   * it was given, so the list and weak-comparison forms of `If-None-Match`
   * cannot arise from this route's own tags.
   */
  function thumbHitTiers(c: Context, gen: number): boolean {
    const named = c.req.query('gen')
    if (named !== undefined) {
      c.header('Cache-Control', named === String(gen) ? 'public, max-age=31536000, immutable' : 'no-cache')
      return false
    }
    const etag = `"${gen}"`
    c.header('Cache-Control', 'no-cache')
    c.header('ETag', etag)
    return c.req.header('if-none-match') === etag
  }

  app.get('/api/thumb', async (c) => {
    const key = thumbKeyOf(c)
    if (key instanceof Response) return key
    await library.resolve(key.libPath)
    const body = await cache.get(key.libPath, key.mtime, key.ao)

    // A response that is not a hit is never cacheable, in any tier
    // (`immutable-thumbnail-serving` D3). A cached miss outlives the render
    // that fills it, which is the tile that stays empty forever; and a miss is
    // cheap to re-ask, carrying no PNG.
    if (body.status !== 'hit') {
      c.header('Cache-Control', 'no-store')
      return c.json(body)
    }
    if (thumbHitTiers(c, body.gen ?? 0)) return c.body(null, 304)
    return c.json(body)
  })

  /**
   * The same render as `image/webp` bytes, for a tile to reference by URL
   * (`thumbnail-image-serving` D1): same key, same tiers, so a listing that
   * says "cached at generation N" can point an `<img>` here and the browser's
   * own cache answers the revisit. Anything but a hit — a miss, a stale
   * render, a hit whose PNG the size cap has taken since the listing was
   * emitted — is 404 and `no-store`: there are no pixels to serve, and the
   * tile recovers through the JSON lookup, which is what says why. Confined
   * exactly as the lookup is, and bumping the render's LRU clock exactly as a
   * lookup hit does (D7).
   */
  app.get('/api/thumb/image', async (c) => {
    const key = thumbKeyOf(c)
    if (key instanceof Response) return key
    await library.resolve(key.libPath)
    const { gen, png } = await cache.image(key.libPath, key.mtime, key.ao)
    if (png === undefined) {
      c.header('Cache-Control', 'no-store')
      return c.json({ error: 'no cached thumbnail' }, 404)
    }
    if (thumbHitTiers(c, gen)) return c.body(null, 304)
    c.header('Content-Type', THUMB_MIME)
    c.header('X-Content-Type-Options', 'nosniff')
    // The one resource this server serves that a foreign page *could* embed:
    // an `<img src>` sends no Origin, so the same-origin guard lets it
    // through, and unlike model bytes this is a real image type. Without this
    // header any page the user visits could use `onload`/`onerror` on a
    // guessed URL as an existence oracle for a cached thumbnail (the pixels
    // stay unreadable — the canvas taints). Browsers enforce it on no-cors
    // loads, which is exactly the case the guard cannot see (`guard.ts`).
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    // A view over the Buffer's own bytes, not a copy (review R11): Hono's body
    // types take a `Uint8Array<ArrayBuffer>`, and a Node Buffer is one — its
    // backing store is never shared — but `tsc` types `.buffer` as
    // `ArrayBufferLike`, hence the cast.
    return c.body(new Uint8Array(png.buffer as ArrayBuffer, png.byteOffset, png.byteLength))
  })

  app.put('/api/thumb', async (c) => {
    // The first line, before the body is parsed and long before the cache is
    // touched: this route consulted nothing until now, and its cache is keyed
    // by path alone for cameras — so one accepted anonymous write re-frames the
    // model *every later visitor* sees (model-thumbnails, D5).
    if (!features.thumbWrites) return refuse(c, 'thumbWrites')
    const body = (await c.req.json()) as ThumbPutRequest
    if (typeof body.path !== 'string' || typeof body.mtime !== 'number') {
      return c.json({ error: 'path and mtime are required' }, 400)
    }
    // Before any write: a cache entry for a path this server would not serve is
    // a write the request had no standing to ask for. Canonical for the same
    // reason the read above is — one file, one entry, whatever it was spelled.
    const libPath = canonicalLibPath(body.path)
    await library.resolve(libPath)
    // `null` is the discard, not a bad axis: absence keeps, a value sets, null
    // clears (entry-context-menu D7). Only a value is worth validating.
    if (body.axis !== undefined && body.axis !== null && !ORBIT_AXES.includes(body.axis)) {
      return c.json({ error: `invalid axis: ${String(body.axis)}` }, 400)
    }
    if (body.lighting !== undefined && body.lighting !== PRODUCIBLE_LIGHTING) {
      return c.json({ error: `invalid lighting: ${String(body.lighting)}` }, 400)
    }
    if (body.rig !== undefined && typeof body.rig !== 'number') {
      return c.json({ error: `invalid rig: ${String(body.rig)}` }, 400)
    }
    // Three states here too, as on the axis: absence keeps the pixels, a string
    // replaces them, `null` deletes both renders (`bulk-thumbnail-jobs` D3).
    // This is the hop a deletion is most easily lost at — the `!== undefined`
    // reading below would have handed `Buffer.from(null)` to the cache — so the
    // third state is validated as one rather than falling through to it.
    if (body.png !== undefined && body.png !== null && typeof body.png !== 'string') {
      return c.json({ error: `invalid png: ${String(body.png)}` }, 400)
    }
    // A finite number or nothing. `Number.isFinite` refuses a string, a NaN and
    // an infinity alike, which is what makes a malformed condition a 400 and
    // keeps 412 meaning only "the entry moved" (D4).
    if (body.ifGen !== undefined && !Number.isFinite(body.ifGen)) {
      return c.json({ error: `invalid ifGen: ${String(body.ifGen)}` }, 400)
    }
    // Absent is the occluded render, for the reason the GET says: an old client
    // never rendered an unoccluded thumbnail, so an absent `ao` can only ever
    // have meant this one. Anything but a boolean is a client bug, not a
    // default — refused in the shape every other invalid field uses.
    if (body.ao !== undefined && typeof body.ao !== 'boolean') {
      return c.json({ error: `invalid ao: ${String(body.ao)}` }, 400)
    }
    let gen: number
    try {
      gen = await cache.put(libPath, {
        mtime: body.mtime,
        // `null` reaches the cache as `null`: it is the deletion, and reading it
        // as bytes here is precisely the mistake the third state exists to
        // prevent. Only a string is decoded.
        png: body.png === null ? null : body.png === undefined ? undefined : Buffer.from(body.png, 'base64'),
        camera: body.camera,
        axis: body.axis,
        lighting: body.lighting,
        rig: body.rig,
        posed: body.posed,
        ao: body.ao,
        ifGen: body.ifGen,
      })
    } catch (err) {
      // Mapped here rather than in `app.onError`, deliberately: the refusal is
      // this route's own protocol — 412 carrying the entry's *current*
      // generation, so the caller re-keys from the answer — and it belongs
      // beside the condition that produced it, where a reader of the handler
      // can see that a conditional write has a second way to end (D4).
      if (err instanceof StaleWriteError) {
        const refused: ThumbPutRefused = { error: 'generation moved', gen: err.gen }
        return c.json(refused, 412)
      }
      throw err
    }
    // The generation this write landed under, so the writer can key its next
    // read from it without a round trip to discover what it just caused. Not
    // cacheable in any sense — a PUT's answer never is — so no header here.
    return c.json({ ok: true, gen })
  })

  return app
}
