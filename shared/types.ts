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
  /** Stored spindle axis; absent when the path is unknown (read as 'y'). */
  axis?: OrbitAxis
  /** Lighting mode the PNG was rendered with; absent on pre-lighting entries. */
  lighting?: LightingMode
  /** Pixel-recipe (rig) version the PNG was rendered with; absent on pre-rim entries. */
  rig?: number
  /**
   * Whether the PNG was rendered at an index-supplied orientation. Recorded
   * because the pose is an input to the pixels that the cache key does not
   * carry: without it, a thumbnail rendered before the index had an opinion
   * stays at the default angle forever, since path+mtime still match.
   */
  posed?: boolean
  /** base64 PNG, present when status === 'hit'. */
  png?: string
}

export interface ThumbPutRequest {
  path: string
  mtime: number
  /** base64 PNG. */
  png?: string
  camera?: CameraState
  axis?: OrbitAxis
  lighting?: LightingMode
  rig?: number
  /** Whether the PNG was rendered at an index-supplied orientation. */
  posed?: boolean
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

export interface IndexPose {
  up: [number, number, number]
  /** The model-space direction the index's azimuth 0 is measured from. */
  azimuth_zero: [number, number, number]
  source: string
  confidence: number
  front: { view: number; azimuth_deg: number; elevation_deg: number } | null
}

export interface SemanticListing {
  path: string
  entries: DirEntry[]
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>
  scope: SemanticScope
  /** The index found nothing standing out — the set is weak, not the results. */
  weak: boolean
}

/** Availability of the semantic index, read from the wire (semantic-search D4). */
export type IndexState = 'ready' | 'warming' | 'wedged' | 'volume-gone' | 'absent'

export interface IndexAvailability {
  state: IndexState
  /** Present when the index answered: the collection it covers. */
  collectionRoot?: string
  covers?: string[]
  elapsed?: number
  detail?: string
}

export interface ApiError {
  error: string
}
