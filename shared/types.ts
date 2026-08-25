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

/** How a meaning query is shaped, beyond the phrase and the scope. */
export interface SemanticTuning {
  /** Read the phrase as written rather than through the index's templates. */
  raw?: boolean
  /** How a model's per-view scores reduce to one. */
  pool?: 'mean' | 'max' | 'softmax'
  /** How many results — ignored when a floor is set; they are one choice. */
  top?: number
  /** Everything at or above this score, instead of a count. */
  minScore?: number
}

export interface SemanticListing {
  path: string
  entries: DirEntry[]
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>
  scope: SemanticScope
  /** The index found nothing standing out — the set is weak, not the results. */
  weak: boolean
  /** The index's own ceiling stopped it returning what was asked for. */
  capped: boolean
}

/**
 * A model's nearest neighbours (entry-context-menu D4). Deliberately not a
 * `SemanticListing` with fields left blank: everything a meaning answer carries
 * beyond the tiles describes a *phrase's* result — the scope a query was judged
 * within, whether it stood out, whether a bound bit — and none of it is a fact
 * about a model's neighbours. The index reports no `weak` here at all (measured:
 * model-to-model cosines run 0.85–0.99 where text-query cosines run ~0.1), and
 * order carries strength, so there is nothing to say per tile either.
 */
export interface SimilarListing {
  /** The collection the neighbours were drawn from — the whole of it (D4). */
  path: string
  entries: DirEntry[]
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>
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
