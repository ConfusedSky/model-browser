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
 * Bounds-relative camera state: azimuth/elevation (radians), distance in
 * multiples of the bounding-sphere radius, target relative to the bounding-box
 * center in radius units. Never world coordinates.
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
  /** base64 PNG, present when status === 'hit'. */
  png?: string
}

export interface ThumbPutRequest {
  path: string
  mtime: number
  /** base64 PNG. */
  png?: string
  camera?: CameraState
}

export interface ApiError {
  error: string
}
