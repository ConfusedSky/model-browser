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
}

export interface DirListing {
  path: string
  entries: DirEntry[]
  /** Flat listings only: models were dropped by the return cap or walk budget. */
  truncated?: boolean
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

export type ThumbStatus = 'hit' | 'stale' | 'miss'

/**
 * How the light rig is oriented: 'axis' aligns it to the model's spindle,
 * 'camera' fixes it in camera space (headlight). Global client setting.
 */
export type LightingMode = 'axis' | 'camera'

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
}

export interface ThumbPutRequest {
  path: string
  mtime: number
  /** base64 PNG. */
  png?: string
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
   * What the index scored each tile at, keyed as `poses` is — by the resolved
   * path the entry carries, so "no entry" and "no score" are one fact and a hit
   * that no longer stats falls out of both at once
   * (confidence-scores-on-tiles D1).
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

/** Availability of the semantic index, read from the wire (semantic-search D4). */
export type IndexState = 'ready' | 'warming' | 'wedged' | 'volume-gone' | 'absent'

export interface IndexAvailability {
  state: IndexState
  /** Present when the index answered: the collection it covers. */
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
 * What the server knows about the library (library-root D4). `ready` is the
 * only state in which a path route answers; the other two are states the UI
 * renders rather than faults, and `missing` names the root because mounting it
 * is the remedy.
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
