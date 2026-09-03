import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { relative, resolve as resolvePath } from 'node:path'
import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import type {
  DirEntry,
  FeatureReport,
  LightingMode,
  ModelsListing,
  OrbitAxis,
  PosesResponse,
  ReloadResult,
  ThumbPutRequest,
} from '../../shared/types'
import { ThumbCache } from './cache'
import { guard } from './guard'
import { LaunchError, type Launcher, ZipTempStore, createLauncher } from './launch'
import { LibraryError, type Library, canonicalLibPath, createLibrary } from './library'
import { ListingError, PEEK_MAX_FINDS, complete, listDir, peek } from './listing'
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
  modelEntryAt,
  modelsUnder,
  posesForDir,
  posesForListing,
  posesForPaths,
  probeStatus,
  query as indexQuery,
  scopeWithin,
  similar as indexSimilar,
} from './semantic'
import type { SnapshotStore } from './snapshot'
import { VPathError } from './vpath'
import { ZipError, extractEntry } from './zip'

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
 */
function indexErrorReply(err: IndexError): {
  body: { error: string; state?: string }
  status: 400 | 404 | 502 | 503
} {
  if (err.upstreamStatus === undefined) {
    return { body: { error: err.message, state: err.state }, status: 503 }
  }
  if (err.upstreamStatus === 404) return { body: { error: err.message }, status: 404 }
  const bad = err.upstreamStatus >= 400 && err.upstreamStatus < 500
  return { body: { error: err.message }, status: bad ? 400 : 502 }
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
 */
async function walkRanked(
  library: Library,
  libPath: string,
  collectionRootFs: string,
): Promise<DirEntry[]> {
  const finds = await peek(library, libPath, PEEK_MAX_FINDS)
  if (finds.length === 0) return finds
  const poses = await posesForPaths(
    library,
    finds.map((e) => e.path),
    collectionRootFs,
  )
  const posed = finds.filter((e) => poses[e.path] !== undefined)
  // A stable partition, not a sort: both halves keep the walk's order, so the
  // answer is a function of the walk and the index's reply and of nothing else.
  const unposed = finds.filter((e) => poses[e.path] === undefined)
  return [...posed, ...unposed]
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
): Promise<{ entries: DirEntry[]; collectionRootFs: string | undefined }> {
  // Handed back beside the sheet rather than re-probed by the caller: this
  // function already asks, the answer is what the preview layer records its
  // identity against (§6.1), and a second `probeStatus` at the route would be a
  // probe taken on the layer's behalf — which is exactly what "observe the
  // answers that already flow" rules out.
  const { status, collectionRootFs } = await probeStatus(library)
  if (status.state !== 'ready' || collectionRootFs === undefined) {
    return { entries: await peek(library, libPath, n), collectionRootFs }
  }
  // The collection's reach, asked about the folder rather than about its finds
  // — the same call, one level up. `null` is every way it can fail to reach:
  // outside the collection, a path the library refuses, or a virtual one (D7).
  const dirReal = await scopeWithin(library, libPath, collectionRootFs)
  if (dirReal === null) return { entries: await peek(library, libPath, n), collectionRootFs }

  // `null` is "ask the walk" — unindexed here, unreachable, or too slow. An
  // `"ok"` answer holding nothing is a real answer and lands as `[]`, which
  // fills from the walk by the same arithmetic; the two converge on purpose.
  const under = await modelsUnder(dirReal, UNDER_LIMIT)
  const fromIndex =
    under === null ? [] : await entriesUnder(library, under, dirReal, libPath, n)
  if (fromIndex.length >= n) return { entries: fromIndex, collectionRootFs }

  const sheet = [...fromIndex]
  const seen = new Set(sheet.map((e) => e.path))
  for (const entry of await walkRanked(library, libPath, collectionRootFs)) {
    if (sheet.length >= n) break
    if (seen.has(entry.path)) continue
    sheet.push(entry)
  }
  return { entries: sheet, collectionRootFs }
}

/**
 * Every capability on — what this server does today, and `createApp`'s default
 * so a caller that has no opinion gets the whole app (feature-report D4).
 * `index.ts` passes it explicitly: that call is the construction site, and the
 * demo change replaces this value there with its env selection without touching
 * the mechanism.
 */
export const ALL_FEATURES: FeatureReport = { thumbWrites: true }

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
  // What this server accepts and offers (feature-report D4). Injected like the
  // five above so a test drives a variant rather than the process's own
  // construction, and read once — a per-process configuration, so the
  // restart-after-editing rule every config in this app follows.
  features: FeatureReport = ALL_FEATURES,
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
   */
  function annotate(entries: DirEntry[]): void {
    for (const entry of entries) {
      const thumb = cache.annotate(entry.path, entry.mtime)
      if (thumb !== undefined) entry.thumb = thumb
      if (entry.kind === 'model') {
        const pose = layers.poseFor(entry.path)
        if (pose !== undefined) entry.pose = pose
      } else if (entry.kind === 'dir') {
        // The sheet a tile draws by default. A tile asking for more cells still
        // asks `/api/peek`, which is the only place a wider sheet is derived.
        const preview = layers.previewFor(entry.path, PEEK_DEFAULT)
        if (preview !== undefined) {
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

  app.use('/api/*', guard)

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
    const s = await library.state()
    if (s.state === 'ready') return next()
    if (s.state === 'missing') {
      return c.json(
        { error: `the library at ${s.root} is not present`, state: s.state, root: s.root },
        503,
      )
    }
    if (s.state === 'nested') {
      // The root encloses a library rather than being one (R1). Both paths are
      // named because the remedy is to point the root at the second.
      return c.json(
        {
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

  app.get('/api/library', async (c) => c.json(await library.state()))

  app.onError((err, c) => {
    if (err instanceof LibraryError) return c.json({ error: err.message }, err.status)
    if (err instanceof ListingError) return c.json({ error: err.message }, err.status === 404 ? 404 : 400)
    if (err instanceof VPathError) return c.json({ error: err.message }, 400)
    if (err instanceof ZipError) return c.json({ error: err.message }, 422)
    return c.json({ error: err.message }, 500)
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
      applyDisplayNames(listing.entries, await overrides.store())
      annotate(listing.entries)
      return c.json(listing)
    }
    const listing = await listDir(library, libPath)
    applyDisplayNames(listing.entries, await overrides.store())
    annotate(listing.entries)
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
    const { entries, collectionRootFs } = await posedFirstPeek(library, libPath, n)
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
      const bytes = await extractEntry(fsPath, entry)
      return c.body(new Uint8Array(bytes), 200, headers)
    }
    const s = await stat(fsPath).catch(() => null)
    if (s === null || !s.isFile()) return c.json({ error: `no such file: ${libPath}` }, 404)
    const stream = Readable.toWeb(createReadStream(fsPath)) as ReadableStream
    return c.body(stream, 200, { ...headers, 'content-length': String(s.size) })
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
    const s = await stat(fsPath).catch(() => null)
    if (s === null || !s.isFile()) {
      return { ok: false, body: { error: `no such file: ${path}` }, status: 404 }
    }
    if (entry !== undefined) {
      return { ok: true, file: await zipTemp.fileFor(path, fsPath, entry) }
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
  app.get('/api/apps', async (c) => c.json(await launcher.report()))

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
      if (err instanceof LaunchError) return c.json({ error: err.message }, 502)
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
      if (err instanceof LaunchError) return c.json({ error: err.message }, 502)
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
    return c.json(s)
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
    const poses = await posesForListing(library, canonical)
    layers.recordPoses(await collectionRoot(), poses)
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
      return c.json({ error: 'index unavailable', state: status.state, detail: status.detail }, 503)
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
      if (err instanceof IndexError) {
        const { body: reply, status } = indexErrorReply(err)
        return c.json(reply, status)
      }
      throw err
    }
    const { entries, poses, scores } = await hitsToEntries(library, result.results, collectionRootFs)
    // A meaning grid is a primary browsing mode: its tiles carry what the
    // caches know exactly as a listing's do (`thumbnail-image-serving` D2), or
    // it would keep the full lookup cost the listing routes have shed.
    annotate(entries)
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
        path: result.scope.path,
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
      return c.json({ error: 'index unavailable', state: status.state, detail: status.detail }, 503)
    }
    const model = await scopeWithin(library, path, collectionRootFs)
    if (model === null) {
      return c.json({ error: 'path is outside the indexed collection' }, 400)
    }
    let result
    try {
      result = await indexSimilar(model, k, pool)
    } catch (err) {
      if (err instanceof IndexError) {
        const { body: reply, status: code } = indexErrorReply(err)
        return c.json(reply, code)
      }
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
   * The same render as `image/png` bytes, for a tile to reference by URL
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
    c.header('Content-Type', 'image/png')
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
    // Absent is the occluded render, for the reason the GET says: an old client
    // never rendered an unoccluded thumbnail, so an absent `ao` can only ever
    // have meant this one. Anything but a boolean is a client bug, not a
    // default — refused in the shape every other invalid field uses.
    if (body.ao !== undefined && typeof body.ao !== 'boolean') {
      return c.json({ error: `invalid ao: ${String(body.ao)}` }, 400)
    }
    const gen = await cache.put(libPath, {
      mtime: body.mtime,
      png: body.png !== undefined ? Buffer.from(body.png, 'base64') : undefined,
      camera: body.camera,
      axis: body.axis,
      lighting: body.lighting,
      rig: body.rig,
      posed: body.posed,
      ao: body.ao,
    })
    // The generation this write landed under, so the writer can key its next
    // read from it without a round trip to discover what it just caused. Not
    // cacheable in any sense — a PUT's answer never is — so no header here.
    return c.json({ ok: true, gen })
  })

  return app
}
