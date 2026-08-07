import type {
  CameraState,
  DirListing,
  OrbitAxis,
  ThumbGetResponse,
  ThumbStatus,
} from '../../../shared/types'

export interface ThumbResult {
  status: ThumbStatus
  camera?: CameraState
  /** Stored spindle axis; absent when the path is unknown (read as 'y'). */
  axis?: OrbitAxis
  /** Object URL for the cached PNG, present on 'hit'. */
  pngUrl?: string
}

export interface ThumbSave {
  path: string
  mtime: number
  png?: Blob
  camera?: CameraState
  axis?: OrbitAxis
}

/**
 * All frontend I/O goes through this interface — never raw fetch in
 * components. The Electron port swaps the implementation (HTTP → IPC) without
 * touching callers.
 */
export interface ApiClient {
  listDir(path: string, opts?: { flat?: boolean }): Promise<DirListing>
  complete(prefix: string): Promise<string[]>
  fetchModel(path: string): Promise<ArrayBuffer>
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

  async listDir(path: string, opts?: { flat?: boolean }): Promise<DirListing> {
    const flat = opts?.flat === true ? '&flat=true' : ''
    const res = await this.fetchFn(`/api/dir?path=${encodeURIComponent(path)}${flat}`)
    return jsonOrThrow<DirListing>(res)
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
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new HttpError(res.status, body?.error ?? res.statusText)
    }
  }
}
