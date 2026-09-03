import type {
  AppsReport,
  CameraState,
  DirEntry,
  DirListing,
  FeatureReport,
  IndexAvailability,
  LibraryState,
  ModelsListing,
  PosesResponse,
  SemanticListing,
  SemanticTuning,
  SimilarListing,
  LightingMode,
  OrbitAxis,
  ResolvedOverrides,
  ThumbGetResponse,
  ThumbStatus,
  PosesRequest,
} from '../../../shared/types'
import { thumbImageUrl } from './thumbUrl'

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
  /**
   * The entry's write generation, as the server last reported it
   * (`immutable-thumbnail-serving` D4). Passing it back on the next read for
   * this entry is what earns an `immutable` answer; not knowing it costs a
   * revalidation, never a wrong picture.
   */
  gen?: number
}

/**
 * What a thumbnail write reports back. Only the generation: the write either
 * succeeded or threw, so there is nothing else for a caller to read.
 */
export interface ThumbPutResult {
  /** The entry's generation *after* this write. */
  gen?: number
}

export interface ThumbSave {
  path: string
  mtime: number
  /**
   * Three states, like `camera` below: a Blob **replaces** this render's
   * pixels, absence **keeps** what is stored, and `null` **deletes** the
   * entry's cached renders — both occlusion variants (`bulk-thumbnail-jobs`
   * D3). The deletion is what a bulk reset writes; the orientation it leaves is
   * governed by this same save's `camera`/`axis`, never by the deletion.
   */
  png?: Blob | null
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
  /**
   * The generation the writer last saw, making the write conditional: the
   * server refuses it, changing nothing, when the entry has moved past that
   * number (`bulk-thumbnail-jobs` D4). Absent is an unconditional write.
   */
  ifGen?: number
}

import { POSES_MAX } from '../../../shared/types'
export { POSES_MAX }


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
  /**
   * Every model beneath `path`, each carrying the caches' thumbnail facts —
   * the enumeration `listing-tree-cache` 6.7 answers, drawn from the tree
   * snapshot rather than a walk.
   *
   * **An enumeration, not a listing**: no response cap applies, because a scope
   * silently cut to a cap would be a different scope, and `complete` states
   * whether the traversal that produced it ran out of budget. Called by the
   * bulk jobs' derivation (the scope they derive their work list from) and by
   * the library tab's counts.
   *
   * **No `AbortSignal`**, like `peek` and unlike `listDir`: this answers an
   * explicit action, not a scroll position, so nothing supersedes it in flight
   * — a caller that has moved on drops the answer on arrival.
   */
  models(path: string): Promise<ModelsListing>
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
   * The directory's own models — which is why the wave stopped using it: a
   * flat listing's models and a name search's are drawn from a subtree, so a
   * directory's direct children are not a subset of that grid but a different
   * set, and an unmatched key is indistinguishable from "no orientation". The
   * wave asks by path instead (`semanticPosesFor`), and **nothing under
   * `client/src` calls this any more**; it is kept for a genuinely
   * directory-shaped ask, and the server route it names is unchanged.
   *
   * **No `AbortSignal`**, like `peek` and unlike `listDir`: the answer is
   * bounded by one directory's model count, and a superseded one is dropped on
   * arrival by whatever asked rather than stopped in flight.
   */
  semanticPoses(dirPath: string): Promise<PosesResponse>
  /**
   * The index's orientation for each of the named models, keyed by library path
   * — what a listing's wave actually asks (pose-for-every-model D3). The
   * directory form above answers a directory's *direct children*, which is a
   * different set from the one a listing put on screen: a flat listing's models
   * live in subfolders and a name search's are drawn from a whole subtree, so
   * asking about a directory would answer about tiles that are not there and
   * say nothing about the ones that are.
   *
   * Answers `{}` where the index is absent, warming, or does not cover the
   * location, exactly as the directory form does, and a path it refuses is
   * simply missing from the answer — a missing key is "no pose".
   *
   * Chunked, so the caller hands over a listing and not a batch: see
   * `POSES_MAX`. The chunking is **partial-tolerant**: a chunk that fails
   * contributes nothing and the others still land, so one bad round trip
   * un-poses its own slice rather than the whole listing. It rejects only if
   * every chunk failed — which is what makes a rejection here mean "nothing
   * arrived" to a caller whose failure handling is silence.
   *
   * **No `AbortSignal`**, for the directory form's reason: a superseded wave is
   * dropped on arrival by the landing it names (the reducer's `listingPoses`)
   * rather than stopped in flight.
   */
  semanticPosesFor(paths: string[]): Promise<PosesResponse>
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
  /**
   * `gen` names the write generation the caller believes this entry is at. Sent
   * only when known: an answer at that generation can be cached indefinitely,
   * and one that is no longer current comes back uncacheable with the current
   * number so the caller re-keys (D2).
   */
  getThumb(path: string, mtime: number, ao?: boolean, gen?: number): Promise<ThumbResult>
  /**
   * The URL at which the server answers the same render as `image/png` bytes
   * (`thumbnail-image-serving` D1) — for a tile whose listing entry vouches
   * for the render to reference by `<img src>`, with no lookup. Same key as
   * `getThumb`; a pure builder, no request.
   */
  thumbImageUrl(path: string, mtime: number, ao: boolean, gen?: number): string
  putThumb(save: ThumbSave): Promise<ThumbPutResult>
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
  /**
   * What this server accepts and offers (feature-report D2) — capability
   * fields, never a mode name, so one client build serves every deployment.
   *
   * Answerable in every library state, and read through here like everything
   * else (D1): a surface that gates on the report must not be able to reach the
   * network around the client the tests inject.
   */
  features(): Promise<FeatureReport>
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

  async models(path: string): Promise<ModelsListing> {
    const res = await this.fetchFn(`/api/models?path=${encodeURIComponent(path)}`)
    return jsonOrThrow<ModelsListing>(res)
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

  async semanticPosesFor(paths: string[]): Promise<PosesResponse> {
    // Chunked rather than sliced to `POSES_MAX`. A slice would leave the tail
    // of a large folder permanently unposed — silently, since a missing key
    // reads as "the index has no orientation for this" — which is the exact
    // class of un-posed tile this change exists to remove. Sequential, not
    // parallel: an oversized listing is the rare case, and the wave is
    // background work behind a grid that is already drawn, so it may take the
    // extra round trips rather than open a burst of connections against a
    // single-worker index.
    //
    // **Per chunk, not all-or-nothing.** A chunk that fails contributes nothing
    // and the rest still land: one 500 in the middle of a three-thousand-model
    // folder used to reject the whole promise and throw away the chunks that had
    // already answered, which is the same permanently-unposed tail the chunking
    // exists to prevent — reached by a different road. A failed chunk's paths are
    // simply missing from the map, which is what "the index has no orientation for
    // this" already looks like, and the next wave asks about them again.
    //
    // It rejects only when EVERY chunk failed, carrying the first failure: that
    // is the one case where nothing arrived, and it keeps the caller's
    // silent-failure path (`App`'s wave, whose rejection handler is empty)
    // meaning exactly that. An empty `paths` is not a failure — it makes no
    // requests and answers `{}`.
    const poses: PosesResponse['poses'] = {}
    // Both outcomes counted rather than inferred from `firstFailure`: a
    // rejection value is whatever was thrown, `null` and `undefined` included,
    // so "was there a failure" cannot be read off the value one carried.
    let landed = 0
    let failed = 0
    let firstFailure: unknown = null
    for (let i = 0; i < paths.length; i += POSES_MAX) {
      const body: PosesRequest = { paths: paths.slice(i, i + POSES_MAX) }
      try {
        const res = await this.fetchFn('/api/semantic/poses', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        Object.assign(poses, (await jsonOrThrow<PosesResponse>(res)).poses)
        landed += 1
      } catch (err) {
        if (failed === 0) firstFailure = err
        failed += 1
      }
    }
    if (landed === 0 && failed > 0) throw firstFailure
    return { poses }
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

  async getThumb(path: string, mtime: number, ao = true, gen?: number): Promise<ThumbResult> {
    // Appended only when off: absent already means the occluded render, so an
    // occlusion-on request is byte-identical to every request this client sent
    // before renders were keyed by occlusion (D2).
    //
    // `gen` follows the same rule for the same reason: appended only when the
    // caller has one, so a client that has learned nothing yet sends exactly
    // the bytes it sent before this change and rides the validator tier.
    const res = await this.fetchFn(
      `/api/thumb?path=${encodeURIComponent(path)}&mtime=${mtime}${ao ? '' : '&ao=off'}${gen !== undefined ? `&gen=${gen}` : ''}`,
    )
    const body = await jsonOrThrow<ThumbGetResponse>(res)
    return {
      status: body.status,
      camera: body.camera,
      axis: body.axis,
      lighting: body.lighting,
      rig: body.rig,
      posed: body.posed,
      gen: body.gen,
      pngUrl: body.png !== undefined ? base64ToBlobUrl(body.png) : undefined,
    }
  }

  thumbImageUrl(path: string, mtime: number, ao: boolean, gen?: number): string {
    return thumbImageUrl(path, mtime, ao, gen)
  }

  async apps(): Promise<AppsReport> {
    const res = await this.fetchFn('/api/apps')
    return jsonOrThrow<AppsReport>(res)
  }

  async features(): Promise<FeatureReport> {
    const res = await this.fetchFn('/api/features')
    return jsonOrThrow<FeatureReport>(res)
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

  async putThumb(save: ThumbSave): Promise<ThumbPutResult> {
    const res = await this.fetchFn('/api/thumb', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: save.path,
        mtime: save.mtime,
        // Three states on the wire, and `null` is the one that only survives if
        // it is passed through deliberately: `JSON.stringify` drops an
        // `undefined` field, which is exactly what "absence keeps" means, while
        // `null` is the deletion and must be written. The `save.png !==
        // undefined ? … : undefined` this replaced collapsed both into absence,
        // so a reset's deletion never left the client (`bulk-thumbnail-jobs`
        // D3).
        png: save.png === null ? null : save.png === undefined ? undefined : await blobToBase64(save.png),
        camera: save.camera,
        axis: save.axis,
        lighting: save.lighting,
        rig: save.rig,
        posed: save.posed,
        ao: save.ao,
        ifGen: save.ifGen,
      }),
    })
    // A refused conditional write arrives here as any other failure does: an
    // `HttpError` carrying 412, which is what a bulk job branches on to count
    // the entry as skipped rather than failed (D4).
    if (!res.ok) throw await errorOf(res)
    // Parsed rather than discarded since this change: the answer carries the
    // generation this write landed under, which is what lets the writer key its
    // own next read. A body that is missing or unparseable is not a failed
    // write — an older server answers `{ok:true}` and nothing else — so it
    // degrades to "generation unknown", which is the validator tier.
    const body = (await res.json().catch(() => ({}))) as { gen?: number }
    return { gen: body.gen }
  }
}
