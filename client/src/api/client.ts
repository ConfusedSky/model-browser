import type {
  CameraState,
  DirListing,
  IndexAvailability,
  SemanticListing,
  SemanticTuning,
  LightingMode,
  OrbitAxis,
  ThumbGetResponse,
  ThumbStatus,
} from '../../../shared/types'

export interface ThumbResult {
  status: ThumbStatus
  camera?: CameraState
  /** Stored spindle axis; absent when the path is unknown (read as 'y'). */
  axis?: OrbitAxis
  /** Lighting mode the PNG was rendered with; absent on pre-lighting entries. */
  lighting?: LightingMode
  /** Pixel-recipe (rig) version the PNG was rendered with; absent on pre-rim entries. */
  rig?: number
  /** Pose recipe version the PNG was rendered under; absent when unposed. */
  posed?: number
  /** Object URL for the cached PNG, present on 'hit'. */
  pngUrl?: string
}

export interface ThumbSave {
  path: string
  mtime: number
  png?: Blob
  camera?: CameraState
  axis?: OrbitAxis
  lighting?: LightingMode
  rig?: number
  posed?: number
}

/**
 * All frontend I/O goes through this interface — never raw fetch in
 * components. The Electron port swaps the implementation (HTTP → IPC) without
 * touching callers.
 */
export interface ApiClient {
  listDir(
    path: string,
    opts?: { flat?: boolean; q?: string; folderMatching?: boolean },
  ): Promise<DirListing>
  complete(prefix: string): Promise<string[]>
  fetchModel(path: string): Promise<ArrayBuffer>
  /** Availability of the semantic index — cheap, cached server-side (D4). */
  indexAvailability(opts?: { fresh?: boolean }): Promise<IndexAvailability>
  /** A meaning query. Throws HttpError(503) carrying the index's state. */
  semanticSearch(text: string, path?: string, tuning?: SemanticTuning): Promise<SemanticListing>
  getThumb(path: string, mtime: number): Promise<ThumbResult>
  putThumb(save: ThumbSave): Promise<void>
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new HttpError(res.status, body?.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

function base64ToBlobUrl(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export class HttpApiClient implements ApiClient {
  constructor(private fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  async listDir(
    path: string,
    opts?: { flat?: boolean; q?: string; folderMatching?: boolean },
  ): Promise<DirListing> {
    const flat = opts?.flat === true ? '&flat=true' : ''
    // Free-form user text, unlike the boolean `flat` — the URL is built by
    // concatenation, so an unescaped `&` or `#` would silently truncate it.
    const q = opts?.q !== undefined && opts.q.trim() !== '' ? `&q=${encodeURIComponent(opts.q)}` : ''
    // Sent only when off: the server's default is the shipped predicate, so an
    // ordinary request is byte-identical to what it was before the option.
    const folders = opts?.folderMatching === false ? '&folders=false' : ''
    const res = await this.fetchFn(`/api/dir?path=${encodeURIComponent(path)}${flat}${q}${folders}`)
    return jsonOrThrow<DirListing>(res)
  }

  async indexAvailability(opts?: { fresh?: boolean }): Promise<IndexAvailability> {
    const q = opts?.fresh === true ? '?fresh=true' : ''
    const res = await this.fetchFn(`/api/semantic/status${q}`)
    return jsonOrThrow<IndexAvailability>(res)
  }

  async semanticSearch(
    text: string,
    path?: string,
    tuning: SemanticTuning = {},
  ): Promise<SemanticListing> {
    const res = await this.fetchFn('/api/semantic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, path, ...tuning }),
    })
    return jsonOrThrow<SemanticListing>(res)
  }

  async complete(prefix: string): Promise<string[]> {
    const res = await this.fetchFn(`/api/complete?prefix=${encodeURIComponent(prefix)}`)
    return jsonOrThrow<string[]>(res)
  }

  async fetchModel(path: string): Promise<ArrayBuffer> {
    const res = await this.fetchFn(`/api/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new HttpError(res.status, body?.error ?? res.statusText)
    }
    return res.arrayBuffer()
  }

  async getThumb(path: string, mtime: number): Promise<ThumbResult> {
    const res = await this.fetchFn(
      `/api/thumb?path=${encodeURIComponent(path)}&mtime=${mtime}`,
    )
    const body = await jsonOrThrow<ThumbGetResponse>(res)
    return {
      status: body.status,
      camera: body.camera,
      axis: body.axis,
      lighting: body.lighting,
      rig: body.rig,
      posed: body.posed,
      pngUrl: body.png !== undefined ? base64ToBlobUrl(body.png) : undefined,
    }
  }

  async putThumb(save: ThumbSave): Promise<void> {
    const res = await this.fetchFn('/api/thumb', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: save.path,
        mtime: save.mtime,
        png: save.png !== undefined ? await blobToBase64(save.png) : undefined,
        camera: save.camera,
        axis: save.axis,
        lighting: save.lighting,
        rig: save.rig,
        posed: save.posed,
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new HttpError(res.status, body?.error ?? res.statusText)
    }
  }
}
