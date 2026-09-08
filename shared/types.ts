export type EntryKind = 'dir' | 'zip' | 'model'

export interface DirEntry {
  name: string
  /** Virtual path: plain fs path, or `zip.zip!/inner/entry` for zip contents. */
  path: string
  kind: EntryKind
  /** Model format, present when kind === 'model'. */
  format?: 'stl' | '3mf' | 'obj'
  size: number
  /** mtime (ms). For zip entries this is the containing zip's mtime. */
  mtime: number
  /**
   * The name the library's override store holds for this exact path, when it
   * holds one. Display only: tiles label themselves with it while `name` stays
   * the title, the accessible name, and what find, deep search and the flat
   * filter match (library-overrides D7). Absent for every entry the store does
   * not name, and for every library that has no store.
   */
  displayName?: string
  /**
   * What the server's caches already knew about this entry when the listing was
   * emitted (`listing-tree-cache` §6.3). All three are **additive and absent by
   * default**: a lookup in a derived layer either hits or it does not, emission
   * never waits on the semantic index or the filesystem for them, and a library
   * with no layer content emits listings byte-identical to one from before this
   * capability existed.
   *
   * Absent does not mean "no". It means "this server has not derived it", and
   * the client asks for it exactly as it did before — the pose wave for `pose`,
   * `/api/thumb` for `thumb`, `/api/peek` for `preview`.
   */
  thumb?: ThumbInfo
  /**
   * The index's orientation for this model, when the pose layer holds an answer.
   *
   * Three states, not two (`listing-tree-cache` §6.9, round-3 review finding 6):
   *
   * - an `IndexPose` — the index holds this orientation;
   * - **`null`** — the index was asked about this model and has no orientation
   *   for it. A recorded answer, not a gap, and the client SHALL treat the model
   *   as known-unposed rather than re-asking. Without this state a folder the
   *   index has never embedded costs a pose wave on every landing forever: the
   *   server knows the answer is "none" and had no way to say so;
   * - **absent** — this server has not derived it. The client's wave is the fill,
   *   exactly as before this capability existed.
   *
   * So the test for "has an orientation" is `pose != null`, and the test for
   * "still unknown" is `pose === undefined`. A filter written as
   * `pose === undefined` already reads a null as known, since `null !== undefined`.
   */
  pose?: IndexPose | null
  /** Directories only: the contact sheet a peek already derived for this folder. */
  preview?: DirEntry[]
}

/**
 * One render's cached state as a listing annotation carries it
 * (`thumbnail-image-serving` D2, adopted by `listing-tree-cache` 6.3 — one
 * shape, on a listing and on an enumeration alike).
 *
 * `state` is **derived at emission** from the sidecar's stored mtime for this
 * render against the entry's own mtime, never stored as a verdict: a file
 * edited since the last read would otherwise keep reading `hit`. The labels are
 * the ones the client's usability test compares — `RIG_VERSION` and
 * `POSE_VERSION` are client constants the server stores and echoes but never
 * interprets.
 */
export interface ThumbRenderInfo {
  state: ThumbStatus
  lighting?: LightingMode
  rig?: number
  posed?: number
}

/**
 * An entry's thumbnail state: the entry-level facts, then one block per
 * occlusion variant (the store keys renders that way).
 *
 * The one thing this cannot vouch for is that the PNG is still on disk — the
 * annotation is a memory lookup, and eviction removes pixels without asking it.
 * A reader that acts on `state: 'hit'` must still tolerate a `/api/thumb` answer
 * that disagrees; that fallback is `thumbnail-image-serving` D3's.
 */
export interface ThumbInfo {
  /** The entry's write generation — the cache validator every read echoes. */
  gen: number
  /** A stored orientation exists: a camera **or** an axis (`bulk-thumbnail-jobs` M4). */
  framed: boolean
  camera?: CameraState
  axis?: OrbitAxis
  ao?: ThumbRenderInfo
  noao?: ThumbRenderInfo
}

/**
 * Every model beneath a library path, with the thumbnail facts a listing entry
 * carries (`listing-tree-cache` §6.7). An **enumeration, not a listing**: no
 * response cap applies, because a scope silently cut to a cap would be a
 * different scope. `complete` is false when the traversal that produced it
 * stopped against its work budget — the answer still carries what was found,
 * and a caller that knows its scope was cut can say so.
 */
export interface ModelsListing {
  path: string
  entries: DirEntry[]
  complete: boolean
}

/**
 * What an explicit reload found (`listing-tree-cache` §6.6): how many cached
 * roots it re-checked, and whether any of them had moved on disk.
 */
export interface ReloadResult {
  ok: true
  roots: number
  changed: boolean
}

export interface DirListing {
  path: string
  entries: DirEntry[]
  /** Flat listings only: models were dropped by the return cap or walk budget. */
  truncated?: boolean
  /**
   * This answer came from a cached tree that this server process has not yet
   * checked against the filesystem (`listing-tree-cache` §5.1). The entries are
   * shown at once and a revalidation pass is already running; the client's job
   * is to say so and to ask again, at which point the corrected listing arrives.
   *
   * **Absent means fresh-or-validated** — a listing produced by an actual walk
   * carries no marker, and neither does one served from a snapshot the process
   * has since revalidated. Never `false`: the field is additive, so an older
   * client and a hand-written request see exactly what they saw before.
   */
  stale?: true
}

/**
 * Attribution for an entry, as the library's override store holds it. Every
 * field is optional: the corpus metadata this is generated from does not always
 * carry all four, and a partial credit is still a true one.
 */
export interface OverrideCredits {
  author?: string
  authorUrl?: string
  license?: string
  sourceUrl?: string
}

/**
 * What one key in `.model-browser/overrides.json` may hold (library-overrides
 * D1/D6). Unknown fields are preserved by writers and ignored by resolution, so
 * the format grows additively *within* `version: 1`.
 */
export interface OverrideEntry {
  /** A display name for the thing at this exact key. Never inherited (D2/D7). */
  name?: string
  credits?: OverrideCredits
  /**
   * Stored orientation, **reserved by name only**. Deliberately `unknown` and
   * not `IndexPose`: the stored pose's concrete shape belongs to
   * `pose-for-every-model`, and pinning the index's shape here would prejudge
   * it. Reserving the name now is documentation of the file format's contract
   * — nothing this change writes or reads depends on it (D6).
   */
  pose?: unknown
}

/**
 * An entry's effective overrides — what `GET /api/overrides` answers, `{}` where
 * nothing resolves.
 *
 * The same field set as `OverrideEntry` by construction rather than by
 * coincidence: the resolution is a field-wise merge over the entry's ancestor
 * keys, so every field it can produce is a field some key held. Named
 * separately because the two are free to diverge — a stored-only field, or a
 * resolved-only one, changes exactly one of them.
 */
export interface ResolvedOverrides {
  name?: string
  credits?: OverrideCredits
  pose?: unknown
}

/**
 * Orbit spindle axis: the model turns around this axis, camera up locked to
 * it. Sign is part of the value (six spindles). Default 'y'.
 */
export type OrbitAxis = 'x' | '-x' | 'y' | '-y' | 'z' | '-z'

/**
 * Bounds- and spindle-relative camera state: azimuth/elevation (radians)
 * measured in the model's spindle frame (its stored OrbitAxis), distance in
 * multiples of the bounding-sphere radius, target relative to the bounding-box
 * center in radius units. Never world coordinates. Under the default 'y'
 * spindle this equals the historical world-Y representation.
 */
export interface CameraState {
  az: number
  el: number
  distR: number
  target: [number, number, number]
}

/**
 * The one encoding a thumbnail is produced, stored and served in
 * (`webp-thumbnails`). Shared because three places must agree about it and a
 * disagreement is silent: the client asks `canvas.toBlob` for it, the client
 * refuses to upload a render that came back as anything else, and the image
 * route types the bytes with it.
 */
export const THUMB_MIME = 'image/webp'

/**
 * How far two `CameraState`s may differ per component and still be the same
 * orientation. Every component is unit-free in the same sense — `az`/`el` in
 * radians, `distR` in bounding-sphere radii, `target` in radii too — so one
 * tolerance covers all of them and the drift it absorbs is scale-independent.
 *
 * It exists because a camera survives a round trip that is not bit-exact: a
 * lightbox close re-captures the orientation through az/el → cartesian →
 * `asin`/`atan2` → az/el and PUTs the result whether or not the user moved
 * anything. Under value equality every close of an oriented model would read
 * as a moved camera and invalidate its sibling render (`ThumbCache.put`).
 * Measured over that round trip (y-frame, bounds pivoted to the origin, 200k
 * random states at each of radius 0.01, 1 and 137; the fourth reviewer's
 * re-run, 2026-08-28): `DEFAULT_CAMERA` drifts by 1.1e-16 and the maximum
 * per-component drift is 7.1e-15 — five orders below this constant.
 *
 * That measurement is a probe, not a quotation: `client/test/camera.test.ts`
 * re-runs the sweep and asserts the maximum drift stays far below this value.
 * The probe (`client/test/camera.test.ts`, "camera round-trip drift") is the
 * figure to trust — it re-runs on every suite: seeded, 200k states at each of
 * radius 0.01, 1 and 137, max per-component drift **2.1538e-14** (AOD-B's run,
 * 2026-08-31; the 7.1e-15 above was an earlier sweep through `statePosition`
 * with a narrower target distribution — same order, same conclusion). The
 * constant keeps ~4.6e4× headroom over the measured maximum.
 */
export const CAMERA_EPSILON = 1e-9

export type ThumbStatus = 'hit' | 'stale' | 'miss'

/**
 * The lighting label a thumbnail carries — a legacy label type with one
 * producible value.
 *
 * `remove-axis-lighting` retired the spindle-aligned rig: every render writes
 * `'camera'` and the server refuses a PUT declaring anything else. `'axis'`
 * stays in the union because entries written before that change must remain
 * readable and echoed — the cache stores and echoes the label without
 * interpreting it, and a stored `'axis'` is how a client knows those pixels
 * are stale. It is never written anew.
 */
export type LightingMode = 'axis' | 'camera'

/**
 * The answer for **one** render of an entry — the occluded one, or the
 * unoccluded sibling, whichever the request named (`ao`). `status`, `png` and
 * the recipe labels below all describe that render. `camera` and `axis` are
 * the entry's own, shared by both renders, so they come back whichever render
 * was asked for and whatever its status is.
 */
export interface ThumbGetResponse {
  status: ThumbStatus
  camera?: CameraState
  /**
   * Stored spindle axis, absent when none is stored — which is not the same as
   * 'y'. A caller defaults it; a caller that needs to know whether the user has
   * chosen an orientation reads the absence.
   */
  axis?: OrbitAxis
  /** Lighting mode the PNG was rendered with; absent on pre-lighting entries. */
  lighting?: LightingMode
  /** Pixel-recipe (rig) version the PNG was rendered with; absent on pre-rim entries. */
  rig?: number
  /**
   * Which pose recipe the PNG was rendered under, absent when it was rendered
   * without one. A version rather than a flag for the same reason `rig` is:
   * the pose is an input to the pixels that the cache key does not carry, and
   * the mapping from the index's coordinates to the scene's can change — it
   * did once already, and every posed thumbnail rendered under the old one was
   * wrong while looking perfectly fresh.
   */
  posed?: number
  /** base64 PNG, present when status === 'hit'. */
  png?: string
  /**
   * The entry's write generation — a counter the server moves on **every**
   * write to the entry, whichever render or field carried it, and never
   * regresses (`immutable-thumbnail-serving` D1). Together with the request's
   * `path`, `mtime` and `ao` it fully names the response bytes, which is what
   * lets a read that already knows it be answered `immutable`.
   *
   * Entry-level, like `camera` and `axis` and for the same reason: it is the
   * entry that is written, not one of its two renders, so both renders of a
   * path always report the same number.
   *
   * The server sets it on every answer, a miss included (0 for an entry that
   * does not exist). Optional only so that entries and clients from before
   * this change stay readable — absence reads as 0.
   */
  gen?: number
}

/**
 * What `PUT /api/thumb` answers. `gen` is the entry's generation **after** this
 * write, so the client that wrote can key its next read from it without a
 * round trip to find out what it just caused.
 */
export interface ThumbPutResponse {
  ok: true
  gen: number
}

/**
 * What `PUT /api/thumb` answers when it **refuses** a conditional write
 * (`bulk-thumbnail-jobs` D4): 412, and nothing written. A shape of its own so
 * the refusal is distinguishable from the 400 a malformed field gets — a bulk
 * job counts a refusal as a skipped entry and carries on, while a malformed
 * request is its own bug and must not be counted as one.
 *
 * `gen` is the entry's **current** generation, not the one the writer named, so
 * a caller that wants to retry can re-key from the refusal itself rather than
 * reading the entry back.
 */
export interface ThumbPutRefused {
  error: string
  gen: number
}

export interface ThumbPutRequest {
  path: string
  mtime: number
  /**
   * Three states, exactly as `camera` below has three: base64 pixels
   * **replace** this render's bytes, absence **keeps** whatever is stored, and
   * `null` **deletes** the entry's cached renders — both occlusion variants'
   * pixels and recipe labels (`bulk-thumbnail-jobs` D3).
   *
   * The deletion is what a bulk reset writes: the renders were drawn under an
   * orientation the same write gives up, so they go with it, and whatever next
   * looks at the model draws it afresh. It governs the pixels only — the
   * entry's stored orientation is this write's own `camera`/`axis` fields, on
   * their own three-state rule, never the deletion's business.
   */
  png?: string | null
  /**
   * Three states, not two: a value **sets** the camera, absence **keeps**
   * whatever was stored, and `null` **discards** it. Silence has to go on
   * meaning keep — every PNG write omits it — so giving an orientation up
   * needed a word of its own rather than a written default, which is an
   * orientation of the user's and suppresses any index that would supply one
   * (entry-context-menu D7).
   */
  camera?: CameraState | null
  /** Set / keep / discard, exactly as `camera` — the axis is discarded with it
   *  when a source can supply both, since angles measured about one axis do not
   *  describe a view about another. */
  axis?: OrbitAxis | null
  lighting?: LightingMode
  rig?: number
  /** Pose recipe version the PNG was rendered under; absent when unposed. */
  posed?: number
  /**
   * Which render these pixels and labels are: `true` — or absent — the
   * occluded one, `false` the unoccluded sibling. Absent means occluded
   * because that is what every PUT was before renders were keyed by
   * occlusion: an old client never rendered an unoccluded thumbnail, so it
   * can only ever have meant this one.
   */
  ao?: boolean
  /**
   * The generation the writer last saw, which makes this write **conditional**:
   * when it is given and is no longer the entry's current generation, the
   * server refuses the write, changes nothing, and answers `ThumbPutRefused`
   * (412). Absent is an unconditional write, which is every ordinary one.
   *
   * It exists for a bulk job's mid-job skip (`bulk-thumbnail-jobs` D4). A job
   * snapshots each entry's generation when it derives its work list; an entry
   * the user has orbited or re-rendered since is then skipped rather than
   * overwritten, and a fresh orbit is never lost to a reset that was queued
   * before it. Decided server-side rather than by a client-side
   * read-then-write, which would leave the whole round trip open as a window.
   *
   * A missing entry's current generation is 0, so `ifGen: 0` reads as "only if
   * nothing has ever been written here".
   */
  ifGen?: number
}

/**
 * What a semantic result set is, beside the entries themselves. Counts are the
 * index's claims about itself, never about the folder: `indexed` is what it
 * holds, `scanned` is what the last classify run walked and still found present
 * when the index loaded, so it tracks the folder loosely and can shift.
 */
export interface SemanticScope {
  path: string | null
  status: 'indexed' | 'partial' | 'unindexed'
  indexed: number
  scanned: number
  /** Extensions the index can hold at all — published by it, not assumed here. */
  covers: string[]
}

/**
 * An orientation the semantic index supplies for a model: which way is up, and
 * the angles its front view was rendered from.
 */
export interface IndexPose {
  up: [number, number, number]
  /** The model-space direction the index's azimuth 0 is measured from. */
  azimuth_zero: [number, number, number]
  source: string
  confidence: number
  front: { view: number; azimuth_deg: number; elevation_deg: number } | null
}

/**
 * What the index scored a result at — its two numbers, under the index's own
 * names rather than the labels a tile draws them with (`k`/`sim`, `z`).
 *
 * Both are the index's values verbatim. Nothing here is rescaled, normalised or
 * banded: the index's thresholds — `WEAK_Z = 2.0` above all — are stated against
 * these numbers, so a figure derived on this side could not be checked against
 * anything the index says about itself (confidence-scores-on-tiles D2/D4).
 *
 * `score` is comparable only *within* one result set, and the two scoring routes
 * produce measurably different distributions (model-to-model cosines run
 * 0.85–0.99 where text-query cosines run ~0.1). Which route produced a set is
 * therefore not recorded here — it is a fact about the view, read off the
 * subject it asked under (D3) — but any surface drawing `score` must name the
 * scale beside it.
 */
export interface IndexScore {
  /** Pooled cosine similarity, under whichever pooling the request asked for. */
  score: number
  /** Robust z (median/MAD) over the scored set — comparable across queries. */
  z: number
}

/** How a meaning query is shaped, beyond the phrase and the scope. */
export interface SemanticTuning {
  /** Read the phrase as written rather than through the index's templates. */
  raw?: boolean
  /** How a model's per-view scores reduce to one. */
  pool?: 'mean' | 'max' | 'softmax'
  /**
   * How many results. Composes with `minScore` rather than competing with it:
   * the floor filters and this caps what survived, so both may be present and
   * absent means *this bound is not in force* — never "unset". Clamped to
   * `MAX_RESULT_COUNT` by every reader that accepts one from a user.
   */
  top?: number
  /** Everything at or above this score, capped by `top` where one is set. */
  minScore?: number
}

/**
 * The largest count this app will send or store. It matches the index's
 * `QueryRequest.cap` *default* of 500 — `cap` is a per-request field the index
 * accepts from 1 to 10000 and this app never sends one, so 500 is what it gets.
 * A count above it names a result set the index would truncate anyway.
 *
 * Pinned to a default we rely on rather than to a fixed ceiling, which is worth
 * saying so it does not rot silently if this app ever starts sending `cap`.
 */
export const MAX_RESULT_COUNT = 500

export interface SemanticListing {
  path: string
  entries: DirEntry[]
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>
  /**
   * What the index scored each tile at, keyed as `poses` is — by the **library
   * path** the entry carries, so "no entry" and "no score" are one fact and a
   * hit that no longer stats falls out of both at once
   * (confidence-scores-on-tiles D1). It said "resolved path" until
   * `library-root` made a library path the only kind that reaches this wire.
   *
   * Optional on the wire, and the migration rests on it: an older server that
   * does not send it leaves a newer client rendering no badges rather than
   * failing, which is what makes this field additive.
   */
  scores?: Record<string, IndexScore>
  scope: SemanticScope
  /** The index found nothing standing out — the set is weak, not the results. */
  weak: boolean
  /** The index's own ceiling stopped it returning what was asked for. */
  capped: boolean
  /**
   * How many models cleared the floor *before* a count cut them — the size of
   * the set the count sampled from, so a view showing 60 can say "of 875"
   * (floor-and-count-compose D9). Distinct from `capped`, which is the index's
   * ceiling: three bounds, each reporting its own act rather than borrowing
   * another's bit.
   *
   * Optional on the wire for the reason `scores` is: an index or server that
   * does not report it leaves a newer client saying nothing extra rather than
   * failing. Never derived client-side — what arrives has already been cut, so
   * counting the tiles would just restate the count.
   */
  matched?: number
}

/**
 * A model's nearest neighbours (entry-context-menu D4). Deliberately not a
 * `SemanticListing` with fields left blank: everything a meaning answer carries
 * beyond the tiles describes a *phrase's* result — the scope a query was judged
 * within, whether it stood out, whether a bound bit — and none of it is a fact
 * about a model's neighbours. The index reports no `weak` here at all (measured:
 * model-to-model cosines run 0.85–0.99 where text-query cosines run ~0.1).
 *
 * Per-tile strength is the exception, and used to be listed above as a third
 * thing there was nothing to say about. It is carried now
 * (confidence-scores-on-tiles): a neighbour set has no `weak` flag *at all*, so
 * withholding the numbers left the ranking as literally everything a reader had
 * here. The measurement that kept them out is unchanged and is why the cosine is
 * labelled `sim` rather than `k` on this route — the two scales are named, not
 * reconciled.
 */
export interface SimilarListing {
  /** The collection the neighbours were drawn from — the whole of it (D4). */
  path: string
  entries: DirEntry[]
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>
  /** What the index scored each neighbour at, keyed as `poses` is (D1). The
   *  anchor below is absent from it: the index excludes the query model from its
   *  own ranking rather than scoring it. Optional for the same reason it is on a
   *  meaning answer — an older server simply sends no badges. */
  scores?: Record<string, IndexScore>
  /**
   * The model the neighbours were computed from, so the question can be shown
   * beside its answer. A field of its own rather than the head of `entries`,
   * because it is not one of them: the index excludes the query model from its
   * own ranking by design, and anything counting the tiles — "nothing similar",
   * the omitted-entries notice — must count the neighbours alone.
   *
   * Absent when the model no longer stats: it can be deleted after it was
   * embedded, and its neighbours are still an answer without it.
   */
  anchor?: DirEntry
}

/**
 * The index's orientations for one plain listing's models — the same fact a
 * search hit carries as a rider on `SemanticListing.poses` and `SimilarListing.
 * poses`, supplied for a whole directory instead of for a result set
 * (`pose-for-every-model` D2). Poses reach a searching client on its hits;
 * this is how they reach a *browsing* one, so the same model is oriented the
 * same way on a meaning grid and on the listing it lives in.
 *
 * Keyed by library path, like every `poses` map in this file, and holding only
 * the models the index has an orientation for: a missing key is "no pose", and
 * an index that is absent, warming, or does not cover the browsed location
 * answers `{}` rather than failing — the listing itself never depends on it.
 *
 * Its own request, never a field on `DirListing`: a listing must cost nothing
 * when the index is down, and a pose arriving as a second wave is what the
 * thumbnail sweep's reconciler is built for (D3).
 */
export interface PosesResponse {
  poses: Record<string, IndexPose>
}

/**
 * The most paths one `/poses` batch may carry — the wire bound the server
 * refuses past, and the chunk size both sides split larger sets at. One
 * declaration for both workspaces (`CAMERA_EPSILON` precedent): the client
 * chunked at its own copy of this number until a review flagged the drift
 * hazard (`pose-for-every-model` §4 F4).
 */
export const POSES_MAX = 1024

/**
 * What a client asks for poses about when naming the directory will not do:
 * the **landed entries' own paths**, so the supply above reaches the listings
 * that are not one directory's contents.
 *
 * A flat listing draws models from every folder beneath the browsed one and a
 * name search draws them from wherever they matched, so `?path=<dir>` would
 * answer for the handful that happen to sit at the top and leave the rest
 * unposed — the tiles on screen are the question, not the folder they were
 * gathered from. Sending exactly what landed also keeps the answer joinable by
 * construction: every key comes back under a path the client already has a tile
 * for.
 *
 * Library paths, like every path on this wire. A path this library will not
 * resolve is dropped from the answer rather than failing the request — the same
 * silence a pose gets for a model the index has never seen, because a listing
 * may never be made to fail by the index. At most `POSES_MAX` per request (the
 * index's own bound on the call); a longer listing asks more than once.
 */
export interface PosesRequest {
  paths: string[]
}

/** Availability of the semantic index, read from the wire (semantic-search D4). */
export type IndexState = 'ready' | 'warming' | 'wedged' | 'volume-gone' | 'absent'

export interface IndexAvailability {
  state: IndexState
  /**
   * The collection the index covers, as a **library path** (library-root D6);
   * absent when the index answered but covers a location outside the library,
   * which `detail` then names. The index keeps its own absolute root — it is
   * another process with its own view of the volume — and only the server sees
   * it.
   */
  collectionRoot?: string
  /** Extensions the index can hold — read, never assumed (semantic-search D3). */
  covers?: string[]
  elapsed?: number
  /** The index's own words when it has them; preferred to ours (D4). */
  detail?: string
}

export interface ApiError {
  error: string
}

/** One launchable application, as the platform registry names it. */
export interface AppRef {
  /** Desktop-file id (with its `.desktop` suffix), e.g. `lycheeslicer.desktop`. */
  id: string
  /** Human-readable name from the entry itself — ids never render (app-launch L2). */
  name: string
}

/** A model type's registry entry: the default is its own source and need not
 *  appear among the associations (app-launch spec). */
export interface TypeApps {
  default: AppRef | null
  associated: AppRef[]
}

/** `GET /api/apps` — fetched once per session, refetched after an open-with
 *  completes; never probed when a menu opens (open-in-slicer L5). */
export interface AppsReport {
  /** Whether a chooser command is configured server-side — gates "Open with…". */
  chooser: boolean
  /** Keyed by mime, only the model types the app handles (open-in-slicer L6). */
  types: Record<string, TypeApps>
}

/**
 * `GET /api/features` — what this server accepts and offers, as named
 * capability fields and never as a mode name (feature-report D1): the client
 * cannot branch on a deployment kind it never learns.
 *
 * Constructed once at server start and answerable in every library state. It is
 * **advisory** — it shapes what the client offers, and is never the enforcement
 * of anything: refusing a write stays the route's own job, owned by whichever
 * change turns the field off. Each future field lands with the change that owns
 * making it false.
 */
export interface FeatureReport {
  /** Whether `PUT /api/thumb` is accepted. */
  thumbWrites: boolean
  /**
   * Whether the platform launcher is offered — all three launcher routes
   * (`/api/open`, `/api/open-with`, `/api/apps`), each of which runs a command
   * on the machine the server sits on.
   */
  appLaunch: boolean
  /**
   * Whether the chat side-panel tab is offered. Its default is **off**: the tab
   * is a placeholder with no backend, and an unfinished surface belongs neither
   * in a shipped desktop build nor on a public link. It stays declarable, so
   * the day chat gains a backend the default flips (public-deployment D4).
   */
  chatTab: boolean
  /**
   * Whether the machine the server runs on is the viewer's concern — governing
   * whether any route or surface may name a location on that machine (the
   * library's top, the configured root, an enclosed library's location, a
   * dependency's cache directory) or offer a remedy only an operator can
   * perform (start a service, mount a volume, re-run a tool). Library paths are
   * not such locations and are unaffected (public-deployment D11).
   */
  hostDetails: boolean
  /**
   * Whether maintenance operations against the library are offered — the ones
   * that act on the server's own derived state rather than answering a question
   * about the library: dropping or revalidating caches, resetting stored
   * framings in bulk. Bulk work that *fills* the thumbnail cache is governed by
   * `thumbWrites` instead, since with those writes refused it would render and
   * discard (public-deployment D4).
   */
  maintenance: boolean
}

/**
 * The deployment's own configuration file — `config.json` under the XDG config
 * home, location overridable by `MODEL_BROWSER_CONFIG` — which describes *this
 * deployment*: which library it opens, which capabilities it offers, which
 * origins it answers, and where it listens (public-deployment D1).
 *
 * One file rather than several, because these keys describe the same deployment
 * `root` already describes and must be coherent with it; a separate file is for
 * a different *authoring* concern, which is what keeps `launch.json` separate.
 *
 * Parsing is **strict**, and there is no free-text key: an unknown key at
 * either level, or a wrong type anywhere, is a startup failure rather than a
 * silently ignored line. A typo that was quietly dropped would leave the server
 * running under a security posture nobody authored, which is the whole reason
 * the file fails loudly (D2). Missing keys mean the built-in defaults, which are
 * the maintained configuration rather than "everything on".
 */
export interface DeploymentConfig {
  /**
   * The library root — where the app opens inside the marked tree. Overridden
   * by a non-empty `MODEL_BROWSER_ROOT`, which overrides *this key alone* and
   * no longer suppresses the rest of the file (D2).
   */
  root?: string
  /**
   * The origins this deployment answers, e.g. `https://models.masamaeda.com`.
   * A **list**, since one deployment may answer more than one name; each entry
   * is `scheme://host[:port]` with no path. Loopback is allowed besides,
   * whatever is configured, so a health check from the machine itself is never
   * refused by the deployment it is checking (D3/D8).
   */
  origins?: string[]
  /** Where the server listens. Defaults to `127.0.0.1:3177`, as today. */
  listen?: { host?: string; port?: number }
  /**
   * Capability overrides, merged over the built-in defaults. An unknown field
   * here is a parse failure: a misspelled capability that read as "unset" would
   * silently offer the surface it was written to withhold.
   */
  features?: Partial<FeatureReport>
}

/**
 * What the server knows about the library (library-root D4). `ready` is the
 * only state in which a path route answers; the others are states the UI
 * renders rather than faults — `missing` names the root because mounting it is
 * the remedy, `nested` names the enclosed library because pointing the root at
 * it is.
 */
export type LibraryState =
  | {
      state: 'ready'
      /** The library's identity: its marker's id, or a hash when `unmarked`. */
      id: string
      /**
       * The **filesystem** path of the library's top — the marker's own
       * directory, resolved. The client joins a library path onto it to expand
       * one into a filesystem path for copy/paste.
       */
      top: string
      /**
       * The configured root as a **library path**: `/` when the root is the
       * top, `/sub/dir` when it is a folder inside the library. Where the app
       * opens is a viewpoint inside the library, not a namespace (D1).
       */
      root: string
      /**
       * Present only when no marker could be written (a read-only volume) and
       * the id fell back to a hash of the top: the library's location is its
       * identity again, so a remount is a different library.
       */
      unmarked?: true
    }
  | { state: 'unconfigured' }
  | {
      state: 'missing'
      /** The configured root's filesystem path, verbatim, so the UI can name it. */
      root: string
    }
  | {
      state: 'nested'
      /** The configured root's filesystem path, verbatim, so the UI can name it. */
      root: string
      /**
       * The **filesystem** path of a library top found *beneath* the root.
       * Claiming the root would have written a marker enclosing this one and
       * orphaned its cache, cameras included, so nothing was written and the
       * root serves nothing until it is repointed at this path or inside it
       * (D1/R1).
       */
      library: string
    }
