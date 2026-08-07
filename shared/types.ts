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

export interface ThumbGetResponse {
  status: ThumbStatus
  camera?: CameraState
  /** Stored spindle axis; absent when the path is unknown (read as 'y'). */
  axis?: OrbitAxis
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
}

export interface ApiError {
  error: string
}
