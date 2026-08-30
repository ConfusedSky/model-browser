import type {
  AppsReport,
  CameraState,
  DirListing,
  IndexAvailability,
  LibraryState,
  SemanticListing,
  SemanticTuning,
  SimilarListing,
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
  /** Set / keep / discard: a value stores it, absence leaves what is stored,
   *  `null` gives it up (entry-context-menu D7). */
  camera?: CameraState | null
  /** Set / keep / discard, exactly as `camera`. */
  axis?: OrbitAxis | null
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
  /**
   * `signal` aborts it, for the same reason `semanticSearch` has one: a flat
   * walk the user has already superseded otherwise runs to completion on the
   * server while nobody waits for it. This is the client half of
   * `search-cancellation`'s premise.
   */
  listDir(
    path: string,
    opts?: { flat?: boolean; q?: string; folderMatching?: boolean },
    signal?: AbortSignal,
  ): Promise<DirListing>
  complete(prefix: string): Promise<string[]>
  fetchModel(path: string): Promise<ArrayBuffer>
  /** Availability of the semantic index — cheap, cached server-side (D4). */
  indexAvailability(opts?: { fresh?: boolean }): Promise<IndexAvailability>
  /**
   * What state the library is in (library R4). Always answers — this is the one
   * route that has something to say while the library is `unconfigured` or
   * `missing`, which is exactly when every other route is answering 503.
   *
   * Read once at boot and again whenever a path route reports a library state,
   * so a volume mounted after start is picked up by the next navigation rather
   * than by a reload. Its `top` is the only filesystem path the client holds,
   * and only `expandLibraryPath` reads it.
   */
  library(): Promise<LibraryState>
  /**
   * A meaning query. Throws HttpError(503) carrying the index's state.
   *
   * `signal` aborts it: a query the user has already superseded (another
   * keystroke in a tuning field) otherwise runs to the server's 30s timeout
   * while the index works on an answer nobody will read.
   */
  semanticSearch(
    text: string,
    path?: string,
    tuning?: SemanticTuning,
    signal?: AbortSignal,
  ): Promise<SemanticListing>
  /**
   * A model's nearest neighbours, drawn from the whole indexed collection — no
   * scope is sent, which is the index's own default stated rather than passed
   * (entry-context-menu D4).
   *
   * Throws `HttpError(404)` when the index has never embedded this model. That
   * status is the contract, not the message: it is the one failure with a
   * sentence of its own ("not indexed yet"), and the caller reads the code
   * rather than sniffing the index's words.
   *
   * `k` is how many neighbours to ask for and `pool` how the index reduces a
   * model's per-view scores to one — both the similarity view's own, set in the
   * side panel and carried in its URL. `pool` is positional and often
   * `undefined`, which is not the same as any of its three values: it means
   * leave the index's own default in force, so the field is dropped from the
   * body rather than sent empty.
   *
   * `signal` aborts it, like its two siblings: a superseded question must stop
   * rather than merely be ignored on arrival.
   */
  similar(
    model: string,
    k: number,
    pool?: SemanticTuning['pool'],
    signal?: AbortSignal,
  ): Promise<SimilarListing>
  getThumb(path: string, mtime: number): Promise<ThumbResult>
  putThumb(save: ThumbSave): Promise<void>
  /**
   * What the platform registry reports for the model types this app handles,
   * plus whether a chooser is configured — the whole report in one answer,
   * taking no path (open-in-slicer L5).
   *
   * Fetched **once per session** by App and read from state when a menu opens;
   * refetched when an open-with completes, since the chooser may have rewritten
   * the registry. Never called from a menu-open path (D6/2.5).
   */
  apps(): Promise<AppsReport>
  /** Open `path` in the application `appId` names — a one-shot launch, resolving
   *  when the platform's launch command succeeded (L8). */
  open(path: string, appId: string): Promise<void>
  /**
   * Hand `path` to the platform's configured chooser (L4).
   *
   * **No timeout and no `AbortSignal`**, unlike every other call here that takes
   * one: this request spans a human decision at the chooser and is unbounded by
   * construction (L9). Completion is when the registry may have changed, which
   * is what the refetch keys on, and an abort would also have to mean "kill the
   * chooser", which a dismissal and a kill must not both read as.
   */
  openWith(path: string): Promise<void>
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * The library state a path route reports while it cannot serve (library
     * R4): `'unconfigured'`, `'missing'` or `'nested'`, absent on every other
     * failure.
     *
     * Carried, not interpreted. It says only *that* the library is why this
     * failed — the sentence the user reads, and the root a `missing` names, come
     * from `library()`, whose answer is the one place that knows both. Typed as
     * a bare string for that reason: narrowing it here would invite a caller to
     * render off the error and quietly grow a second copy of the state.
     */
    readonly state?: string,
  ) {
    super(message)
  }
}

/**
 * The failure body, read once. Four call sites parsed this identically before
 * the library state gave them a third field to agree about; one shared reader
 * is what keeps them from disagreeing.
 */
async function errorOf(res: Response): Promise<HttpError> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string; state?: string }
    | null
  return new HttpError(res.status, body?.error ?? res.statusText, body?.state)
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await errorOf(res)
  return res.json() as Promise<T>
}

/** `jsonOrThrow`'s half for a call whose success carries nothing the caller
 *  reads: the same `HttpError`, no body parsed on the way past. */
async function okOrThrow(res: Response): Promise<void> {
  if (res.ok) return
  throw await errorOf(res)
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
    signal?: AbortSignal,
  ): Promise<DirListing> {
    const flat = opts?.flat === true ? '&flat=true' : ''
    // Free-form user text, unlike the boolean `flat` — the URL is built by
    // concatenation, so an unescaped `&` or `#` would silently truncate it.
    const q = opts?.q !== undefined && opts.q.trim() !== '' ? `&q=${encodeURIComponent(opts.q)}` : ''
    // Sent only when off: the server's default is the shipped predicate, so an
    // ordinary request is byte-identical to what it was before the option.
    const folders = opts?.folderMatching === false ? '&folders=false' : ''
    const res = await this.fetchFn(
      `/api/dir?path=${encodeURIComponent(path)}${flat}${q}${folders}`,
      { signal },
    )
    return jsonOrThrow<DirListing>(res)
  }

  async indexAvailability(opts?: { fresh?: boolean }): Promise<IndexAvailability> {
    const q = opts?.fresh === true ? '?fresh=true' : ''
    const res = await this.fetchFn(`/api/semantic/status${q}`)
    return jsonOrThrow<IndexAvailability>(res)
  }

  async library(): Promise<LibraryState> {
    const res = await this.fetchFn('/api/library')
    return jsonOrThrow<LibraryState>(res)
  }

  async semanticSearch(
    text: string,
    path?: string,
    tuning: SemanticTuning = {},
    signal?: AbortSignal,
  ): Promise<SemanticListing> {
    const res = await this.fetchFn('/api/semantic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, path, ...tuning }),
      signal,
    })
    return jsonOrThrow<SemanticListing>(res)
  }

  async similar(
    model: string,
    k: number,
    pool?: SemanticTuning['pool'],
    signal?: AbortSignal,
  ): Promise<SimilarListing> {
    const res = await this.fetchFn('/api/semantic/similar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `JSON.stringify` drops an `undefined` field, so an unset pool sends no
      // `pool` at all and the index's own applies — absence meaning the default
      // at every layer, the way `folderMatching` and the tuning already do.
      body: JSON.stringify({ path: model, k, pool }),
      signal,
    })
    return jsonOrThrow<SimilarListing>(res)
  }

  async complete(prefix: string): Promise<string[]> {
    const res = await this.fetchFn(`/api/complete?prefix=${encodeURIComponent(prefix)}`)
    return jsonOrThrow<string[]>(res)
  }

  async fetchModel(path: string): Promise<ArrayBuffer> {
    const res = await this.fetchFn(`/api/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw await errorOf(res)
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

  async apps(): Promise<AppsReport> {
    const res = await this.fetchFn('/api/apps')
    return jsonOrThrow<AppsReport>(res)
  }

  async open(path: string, appId: string): Promise<void> {
    const res = await this.fetchFn('/api/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, appId }),
    })
    await okOrThrow(res)
  }

  async openWith(path: string): Promise<void> {
    // No `signal`, deliberately, and no timeout wrapped around it: the chooser
    // blocks in its own UI until the user picks or dismisses (L9). The reply is
    // the completion this client waits for.
    const res = await this.fetchFn('/api/open-with', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    await okOrThrow(res)
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
    if (!res.ok) throw await errorOf(res)
  }
}
