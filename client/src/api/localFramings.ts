import type {
  AppsReport,
  CameraState,
  DirEntry,
  DirListing,
  FeatureReport,
  IndexAvailability,
  LibraryState,
  ModelsListing,
  OrbitAxis,
  PosesResponse,
  ResolvedOverrides,
  SemanticListing,
  SemanticTuning,
  SimilarListing,
} from '../../../shared/types'
// TEMPORARY — `file-frame-spindle` D7; deleted by task 5.2 with the guard below.
import { BAKE_PILL_PRESENT } from '../three/bakeToggle'
import { HttpError } from './client'
import type { ApiClient, ThumbPutResult, ThumbResult, ThumbSave } from './client'

/**
 * A visitor's own framings, kept in their browser, on a deployment that refuses
 * thumbnail writes (`public-deployment` D6).
 *
 * The rule this module holds is the delta's precedence — this browser's stored
 * orientation, then the server's, then an orientation source, then the default
 * — and it holds it in **one** place for **two** arrival points: the decorator
 * below overlays a `getThumb` answer, and `useThumbnails`' listing-annotation
 * seed overlays an entry the listing already answered. One store, one rule.
 *
 * Nothing here may throw. `localStorage` is absent in some test environments and
 * refused in others (a private window, blocked site data), and a framing is a
 * convenience: a read that cannot happen reads as "nothing stored" and a write
 * that cannot happen is dropped, exactly as `lib/stored.ts` degrades.
 */

/** Just the three calls used here, so a test can pass a plain object. */
export type FramingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** One model's locally-held orientation. Never both-absent — that is `undefined`. */
export interface LocalFraming {
  camera?: CameraState
  axis?: OrbitAxis
}

/** This store's own namespace in a shared `localStorage`. See `framingKey`. */
const PREFIX = 'mb:framing:'

/**
 * The default library-id getter, module-level for the reason `useThumbnails`'
 * `NO_FEATURES` is: an inline `() => null` is a fresh function per call, and
 * this value lands in that hook's sweep dependency array.
 */
export const NO_LIBRARY = (): string | null => null

/**
 * Where one library's framing for `path` is held: `mb:framing:<id>:<path>`.
 *
 * The **library id** is in front of the path because the server's thumbnail
 * cache is keyed by it, and this store stands in for that cache. A personal
 * installation repointed between two libraries that share relative paths — the
 * same kit copied to a second drive, a backup mounted beside the original —
 * would otherwise read one library's framings onto the other's models. Moot on
 * a public deployment, which is one library per origin; real locally, which is
 * where the store is reached through a refused write (`putThumb` below).
 *
 * `null` — the library is not known yet — has **no key at all**: a framing
 * cannot be filed under a library that has not been named, so a read answers
 * `undefined` and a write is dropped. That window is acceptable because it
 * cannot hold a gesture: every path route answers 503 until the library is
 * `ready`, and `App` asks `/api/library` before any listing lands, so there is
 * no tile on screen to orbit before the id is here.
 */
function framingKey(path: string, libraryId: string | null): string | null {
  return libraryId === null ? null : `${PREFIX}${libraryId}:${path}`
}

const AXES: readonly string[] = ['x', '-x', 'y', '-y', 'z', '-z']

function browserStorage(): FramingStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Accessing the property itself throws where site data is blocked.
    return null
  }
}

function isCamera(value: unknown): value is CameraState {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.az === 'number' &&
    typeof c.el === 'number' &&
    typeof c.distR === 'number' &&
    Array.isArray(c.target) &&
    c.target.length === 3 &&
    c.target.every((n) => typeof n === 'number')
  )
}

function isAxis(value: unknown): value is OrbitAxis {
  return typeof value === 'string' && AXES.includes(value)
}

/**
 * Whether this client keeps its framings rather than sending them.
 *
 * Only a **known** report declaring writes off (`public-deployment` D6, task
 * 4.2): an unresolved or failed report is `null` and keeps writing to the
 * server, because the feature-report capability is normative that not knowing
 * must never relocate where a user's data is stored.
 */
export function keepsFramingsLocally(report: FeatureReport | null): boolean {
  return report !== null && report.thumbWrites === false
}

/**
 * What this browser holds for `path`, validated. A malformed or hand-edited
 * value reads as nothing stored rather than propagating (`stored.ts`'s rule),
 * and a record holding neither half is `undefined` so callers have one absence
 * to test.
 */
export function readLocalFraming(
  path: string,
  storage: FramingStorage | null = browserStorage(),
  libraryId: () => string | null = NO_LIBRARY,
): LocalFraming | undefined {
  if (storage === null) return undefined
  const key = framingKey(path, libraryId())
  if (key === null) return undefined
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return undefined
  }
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { camera, axis } = parsed as { camera?: unknown; axis?: unknown }
  const held: LocalFraming = {
    camera: isCamera(camera) ? camera : undefined,
    axis: isAxis(axis) ? axis : undefined,
  }
  if (held.camera === undefined && held.axis === undefined) return undefined
  return held
}

/**
 * Store what a write carried, in `ThumbSave`'s own three states: a value
 * **stores**, absence **keeps** what is held, and `null` **deletes** that half.
 *
 * The deletion is the half that matters. A discard (`camera: null`, from a tile
 * or the viewer giving a framing up) must not survive as a stale local
 * override, or the model would be stuck at an orientation the user has already
 * abandoned and no later server value could reach it. Once deleted the delta's
 * precedence resumes below this browser: the server's value, then an
 * orientation source, then the default.
 */
export function writeLocalFraming(
  path: string,
  save: Pick<ThumbSave, 'camera' | 'axis'>,
  storage: FramingStorage | null = browserStorage(),
  libraryId: () => string | null = NO_LIBRARY,
): void {
  if (storage === null) return
  const key = framingKey(path, libraryId())
  if (key === null) return
  // Neither half named is not a write at all — pixels alone reach here on a
  // refusing deployment, and there is nothing of them to keep.
  if (save.camera === undefined && save.axis === undefined) return
  const held = readLocalFraming(path, storage, libraryId)
  const next: LocalFraming = {
    camera: save.camera === undefined ? held?.camera : (save.camera ?? undefined),
    axis: save.axis === undefined ? held?.axis : (save.axis ?? undefined),
  }
  try {
    if (next.camera === undefined && next.axis === undefined) storage.removeItem(key)
    // `JSON.stringify` drops an `undefined` field, which is what "this half is
    // not held" means on the way back in.
    else storage.setItem(key, JSON.stringify(next))
  } catch {
    // Storage refused the write — the framing is simply not kept.
  }
}

/**
 * `ApiClient` with the thumbnail read and write routed through this browser
 * where the deployment refuses writes (D6).
 *
 * **Explicit delegates, not a prototype trick.** Every other method is a
 * one-liner onto `inner` so that a method added to `ApiClient` later fails to
 * compile here — its author then decides whether it needs the overlay, rather
 * than being delegated without anyone looking. The repo prefers the compiler to
 * say so over a silent fall-through (`createApp`'s `unreachable`, `StoredTab`'s
 * excluded tab). Delegates call `inner.x(...)`, never `this.x(...)`.
 *
 * Each takes `...args: Parameters<…>` rather than naming its parameters, and
 * that is load-bearing rather than terse: naming an optional parameter and
 * passing it on re-emits it as an explicit `undefined`, so a three-argument
 * call arrives at the inner client as four. That is invisible at runtime and
 * very visible to a spy — and the arity is deliberate in at least one caller,
 * `useThumbnails`' lookup, which omits the generation it does not know "rather
 * than a fourth argument spelling out its ignorance". A decorator may not
 * rewrite the call it forwards.
 */
class LocalFramingClient implements ApiClient {
  constructor(
    private readonly inner: ApiClient,
    private readonly report: () => FeatureReport | null,
    private readonly storage: FramingStorage | undefined,
    private readonly libraryId: () => string | null,
  ) {}

  /**
   * The lookup still happens — the pixels and the status are the server's
   * business — and this browser's orientation is laid over the answer. A `miss`
   * with a local camera is still a `miss`.
   */
  async getThumb(...args: Parameters<ApiClient['getThumb']>): Promise<ThumbResult> {
    const answer = await this.inner.getThumb(...args)
    if (!keepsFramingsLocally(this.report())) return answer
    const local = readLocalFraming(args[0], this.storage, this.libraryId)
    if (local === undefined) return answer
    return {
      ...answer,
      camera: local.camera ?? answer.camera,
      axis: local.axis ?? answer.axis,
    }
  }

  /**
   * Kept here, sent nowhere.
   *
   * The pixels are dropped — the deployment's baked image is the one to show —
   * and the three labels that describe pixels go with them, for the reason
   * `withoutUnusableRender` drops them: `lighting`, `rig` and `posed` without a
   * render would relabel a render that is not this one. `ifGen` is irrelevant
   * to a store no other writer can reach.
   *
   * `dropped` and no `gen`, which is how `webp-thumbnails` already says "the
   * orientation landed, the pixels did not": `renderEntryThumbnail` turns that
   * into `skipped`, so a generate job on a refusing deployment reports work not
   * done rather than a cache that filled. A write carrying neither orientation
   * nor pixels is the same answer — nothing was written either way.
   *
   * **And where the route refuses what the report did not.** The gate above is
   * unchanged — with the report on, or unknown, the write still goes to the
   * server first, which is what *An unknown report does not move a user's
   * orientations* requires. But a refusal that actually **arrives** is acted
   * on: a route saying `refused: 'thumbWrites'` is at least as authoritative as
   * the report, and it is the only word available when the report is in flight
   * or its read failed. Without this the orientation is stored nowhere — App's
   * orbit-release `persist` swallows the throw as best-effort, and the tile
   * paths turn it into an errored tile or a failure toast. Any other failure,
   * a refusal of any other field included, rethrows exactly as before.
   */
  async putThumb(save: ThumbSave): Promise<ThumbPutResult> {
    // TEMPORARY — `file-frame-spindle` D7: while the compare pill exists no
    // framing or pixels reach the wire or `localStorage` from a PUT, on either
    // side of the pill — a local framing written under the legacy side would
    // be a scene axis stamped as a file one, and the bake has no cache-key
    // dimension to keep the two conventions' pixels apart.
    // Deleted by task 5.2 with `bakeToggle.ts`.
    if (BAKE_PILL_PRESENT) return { dropped: true }
    if (keepsFramingsLocally(this.report())) {
      writeLocalFraming(save.path, save, this.storage, this.libraryId)
      return { dropped: true }
    }
    try {
      return await this.inner.putThumb(save)
    } catch (err) {
      if (!(err instanceof HttpError) || err.refused !== 'thumbWrites') throw err
      writeLocalFraming(save.path, save, this.storage, this.libraryId)
      return { dropped: true }
    }
  }

  listDir(...args: Parameters<ApiClient['listDir']>): Promise<DirListing> {
    return this.inner.listDir(...args)
  }
  models(...args: Parameters<ApiClient['models']>): Promise<ModelsListing> {
    return this.inner.models(...args)
  }
  complete(...args: Parameters<ApiClient['complete']>): Promise<string[]> {
    return this.inner.complete(...args)
  }
  peek(...args: Parameters<ApiClient['peek']>): Promise<DirEntry[]> {
    return this.inner.peek(...args)
  }
  fetchModel(...args: Parameters<ApiClient['fetchModel']>): Promise<ArrayBuffer> {
    return this.inner.fetchModel(...args)
  }
  overrides(...args: Parameters<ApiClient['overrides']>): Promise<ResolvedOverrides> {
    return this.inner.overrides(...args)
  }
  indexAvailability(...args: Parameters<ApiClient['indexAvailability']>): Promise<IndexAvailability> {
    return this.inner.indexAvailability(...args)
  }
  semanticPoses(...args: Parameters<ApiClient['semanticPoses']>): Promise<PosesResponse> {
    return this.inner.semanticPoses(...args)
  }
  semanticPosesFor(...args: Parameters<ApiClient['semanticPosesFor']>): Promise<PosesResponse> {
    return this.inner.semanticPosesFor(...args)
  }
  library(...args: Parameters<ApiClient['library']>): Promise<LibraryState> {
    return this.inner.library(...args)
  }
  semanticSearch(...args: Parameters<ApiClient['semanticSearch']>): Promise<SemanticListing> {
    return this.inner.semanticSearch(...args)
  }
  similar(...args: Parameters<ApiClient['similar']>): Promise<SimilarListing> {
    return this.inner.similar(...args)
  }
  thumbImageUrl(...args: Parameters<ApiClient['thumbImageUrl']>): string {
    return this.inner.thumbImageUrl(...args)
  }
  apps(...args: Parameters<ApiClient['apps']>): Promise<AppsReport> {
    return this.inner.apps(...args)
  }
  features(...args: Parameters<ApiClient['features']>): Promise<FeatureReport> {
    return this.inner.features(...args)
  }
  open(...args: Parameters<ApiClient['open']>): Promise<void> {
    return this.inner.open(...args)
  }
  openWith(...args: Parameters<ApiClient['openWith']>): Promise<void> {
    return this.inner.openWith(...args)
  }
}

/**
 * Wrap `inner` so thumbnail writes are kept in this browser wherever a known
 * report declares them off. The report is read through a getter, per call, so
 * one client identity survives the report resolving — `App` builds this once
 * and every consumer holds the same object. The library id arrives the same
 * way and for the same reason: it is unknown when this is built and known a
 * round trip later, and it decides the key (`framingKey`).
 */
export function withLocalFramings(
  inner: ApiClient,
  features: () => FeatureReport | null,
  storage?: FramingStorage,
  libraryId: () => string | null = NO_LIBRARY,
): ApiClient {
  return new LocalFramingClient(inner, features, storage, libraryId)
}
