import type {
  AppsReport,
  CameraState,
  DirEntry,
  DirListing,
  IndexAvailability,
  LibraryState,
  PosesResponse,
  SemanticListing,
  SemanticTuning,
  SimilarListing,
  LightingMode,
  OrbitAxis,
  ResolvedOverrides,
  ThumbGetResponse,
  ThumbStatus,
} from '../../../shared/types'

/**
 * One render's answer. There is no `ao` field, deliberately: the request names
 * the render and the response describes that one, so the wire carries no echo
 * to parse (`ao-as-recipe-dimension` D2). `camera` and `axis` are the entry's,
 * shared by both renders; everything else below is the requested render's.
 */
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
  /**
   * Which render these pixels and labels are: `true` the occluded one, `false`
   * the unoccluded sibling. Absent means occluded — what every PUT meant
   * before occlusion became a key dimension. Callers that render pass the same
   * value they rendered under, never a second reading of the preference (D4a).
   */
  ao?: boolean
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
  /**
   * The first few models found inside `path`, for the folder tile's contact
   * sheet (folder-contact-sheets D1). Ordinary listing entries, so their
   * thumbnails are produced by the one pipeline every other entry goes through;
   * `n` defaults to 4 server-side and is capped at 8 there. A zip path answers
   * `[]` rather than an error, so the caller treats "nothing to preview"
   * uniformly.
   *
   * **No `AbortSignal`**, unlike `listDir` beside it: a peek is bounded by
   * construction — a fixed entry budget, not a walk of the tree — so a tile that
   * has scrolled away leaves a request that finishes cheaply rather than one
   * worth the machinery to stop. The requirement states this ("being bounded —
   * run to completion rather than stopped when its tile has scrolled away"), so
   * `search-cancellation`'s rule about abandoned traversals does not reach it.
   */
  peek(path: string, n?: number): Promise<DirEntry[]>
  fetchModel(path: string): Promise<ArrayBuffer>
  /**
   * One entry's effective overrides — the field-wise merge over its ancestor
   * keys, `{}` where nothing resolves (`library-overrides` D3). Asked per viewed
   * entry, which is why it takes a path and answers one entry's fields: the
   * lightbox shows one model, and resolving hundreds per listing to serve it is
   * the trade the route exists to refuse.
   *
   * **No `AbortSignal`**, like `peek` beside it and unlike `listDir`: the panel's
   * rule for a superseded read is ignore-on-stale, not abort (D4), and the
   * answer is a memory lookup server-side — there is nothing running to stop.
   */
  overrides(path: string): Promise<ResolvedOverrides>
  /** Availability of the semantic index — cheap, cached server-side (D4). */
  indexAvailability(opts?: { fresh?: boolean }): Promise<IndexAvailability>
  /**
   * The index's orientation for each model directly inside `dirPath`, keyed by
   * library path — the listing's second wave (pose-for-every-model D2/D3). A
   * plain listing carries no poses and waits for none; this is how they reach
   * it afterwards.
   *
   * Answers `{}` where the index is absent, warming, or does not cover the
   * location, and does not distinguish those from "the index holds no
   * orientation for anything here": every one of them is *no poses*, which
   * costs the listing nothing (the delta's own words). A rejection means the
   * same to the caller — the wave is silent, and the listing stays as it is.
   *
   * The directory's own models, so a *flat* listing's deeper entries simply
   * have no pose here: the answer is a subset of the grid, never a wrong one.
   *
   * **No `AbortSignal`**, like `peek` and unlike `listDir`: the answer is
   * bounded by one directory's model count, and a superseded wave is dropped on
   * arrival by the landing it names (the reducer's `listingPoses`) rather than
   * stopped in flight.
   */
  semanticPoses(dirPath: string): Promise<PosesResponse>
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
  /**
   * The cached thumbnail for one render of `path`. `ao` names which — occluded
   * by default, which is what a request with no `ao` has always meant and what
   * the server still reads an absent parameter as.
   */
  getThumb(path: string, mtime: number, ao?: boolean): Promise<ThumbResult>
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
     * The `state` field of the failure body, whichever route sent it — absent
     * when the body carried none. *Whose* state it is depends on the route: a
     * path route that cannot serve reports the **library's** (`'unconfigured'`,
     * `'missing'`, `'nested'` — library R4), while an index route reports the
     * **index's** (`IndexState`) in the same field.
     *
     * Carried, not interpreted, and not attributed either: a caller that wants
     * "the library is why this failed" has to match the value against the
     * library's own states, because the field alone does not say whose it is.
     * The sentence the user reads, and the root a `missing` names, come from
     * `library()`, whose answer is the one place that knows both. Typed as a
     * bare string for that reason: narrowing it here would invite a caller to
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

  async semanticPoses(dirPath: string): Promise<PosesResponse> {
    const res = await this.fetchFn(`/api/semantic/poses?path=${encodeURIComponent(dirPath)}`)
    return jsonOrThrow<PosesResponse>(res)
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

  async peek(path: string, n?: number): Promise<DirEntry[]> {
    // Sent only when the caller names one: absence already means the server's
    // own default (4), so an ordinary sheet's request carries no `n` at all —
    // the same rule `folders` and the tuning fields follow.
    const count = n !== undefined ? `&n=${n}` : ''
    const res = await this.fetchFn(`/api/peek?path=${encodeURIComponent(path)}${count}`)
    return jsonOrThrow<DirEntry[]>(res)
  }

  async overrides(path: string): Promise<ResolvedOverrides> {
    const res = await this.fetchFn(`/api/overrides?path=${encodeURIComponent(path)}`)
    return jsonOrThrow<ResolvedOverrides>(res)
  }

  async fetchModel(path: string): Promise<ArrayBuffer> {
    const res = await this.fetchFn(`/api/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw await errorOf(res)
    return res.arrayBuffer()
  }

  async getThumb(path: string, mtime: number, ao = true): Promise<ThumbResult> {
    // Appended only when off: absent already means the occluded render, so an
    // occlusion-on request is byte-identical to every request this client sent
    // before renders were keyed by occlusion (D2).
    const res = await this.fetchFn(
      `/api/thumb?path=${encodeURIComponent(path)}&mtime=${mtime}${ao ? '' : '&ao=off'}`,
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
        ao: save.ao,
      }),
    })
    if (!res.ok) throw await errorOf(res)
  }
}
