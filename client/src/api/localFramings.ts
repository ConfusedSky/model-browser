/**
 * A visitor's own framings, kept in their browser where the deployment refuses
 * thumbnail writes (`public-deployment` D6). One store holding one precedence —
 * this browser, then the server, then an orientation source, then the default —
 * for the decorator below and `useThumbnails`' seed alike.
 *
 * **Nothing here may throw.** `localStorage` is absent in some environments and
 * refused in others, and a framing is a convenience: what cannot be read is
 * "nothing stored" and what cannot be written is dropped.
 */

import type {
  AppsReport,
  CameraState,
  CreditedKit,
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
} from "../../../shared/types";
import { HttpError } from "./client";
import type {
  ApiClient,
  ThumbPutResult,
  ThumbResult,
  ThumbSave,
} from "./client";

/** So a test can pass a plain object. */
export type FramingStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/** Never both-absent — that is `undefined`. */
export interface LocalFraming {
  camera?: CameraState;
  axis?: OrbitAxis;
}

export const PREFIX = "mb:framing:";

/** **Off** until issue #28: with no client-side pixel cache, a stored framing
 *  turns the lightbox and its tile into a visible split rather than a gesture
 *  kept. Re-enabling is this flag, the sweep below, and that cache. */
const FRAMINGS_KEPT_LOCALLY = false;

/** Module-level because an inline `() => null` is a fresh function per call,
 *  and this lands in a hook's dependency array. */
export const NO_LIBRARY = (): string | null => null;

/**
 * `mb:framing:<id>:<path>`. The id is in front because this store stands in for
 * a cache keyed by it: an installation repointed between two libraries sharing
 * relative paths would otherwise read one's framings onto the other's.
 *
 * An unknown library has **no key at all** — a window that cannot hold a
 * gesture, since every path route 503s until the library is ready.
 */
function framingKey(path: string, libraryId: string | null): string | null {
  return libraryId === null ? null : `${PREFIX}${libraryId}:${path}`;
}

const AXES: readonly string[] = ["x", "-x", "y", "-y", "z", "-z"];

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // The property access itself throws where site data is blocked.
    return null;
  }
}

function isCamera(value: unknown): value is CameraState {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.az === "number" &&
    typeof c.el === "number" &&
    typeof c.distR === "number" &&
    Array.isArray(c.target) &&
    c.target.length === 3 &&
    c.target.every((n) => typeof n === "number")
  );
}

function isAxis(value: unknown): value is OrbitAxis {
  return typeof value === "string" && AXES.includes(value);
}

/** Only a **known** report declaring writes off: not knowing must never
 *  relocate where a user's data is stored (`public-deployment` D6). */
export function keepsFramingsLocally(report: FeatureReport | null): boolean {
  return report !== null && report.thumbWrites === false;
}

/** A malformed or hand-edited value reads as nothing stored, and a record
 *  holding neither half is `undefined`, so callers test one absence. */
export function readLocalFraming(
  path: string,
  storage: FramingStorage | null = browserStorage(),
  libraryId: () => string | null = NO_LIBRARY,
): LocalFraming | undefined {
  if (!FRAMINGS_KEPT_LOCALLY) return undefined;
  if (storage === null) return undefined;
  const key = framingKey(path, libraryId());
  if (key === null) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { camera, axis } = parsed as { camera?: unknown; axis?: unknown };
  const held: LocalFraming = {
    camera: isCamera(camera) ? camera : undefined,
    axis: isAxis(axis) ? axis : undefined,
  };
  if (held.camera === undefined && held.axis === undefined) return undefined;
  return held;
}

/**
 * `ThumbSave`'s three states. The deletion is the half that matters: a discard
 * that survived as a local override would stick the model at an orientation the
 * user abandoned, where no later server value could reach it.
 */
export function writeLocalFraming(
  path: string,
  save: Pick<ThumbSave, "camera" | "axis">,
  storage: FramingStorage | null = browserStorage(),
  libraryId: () => string | null = NO_LIBRARY,
): void {
  if (!FRAMINGS_KEPT_LOCALLY) return;
  if (storage === null) return;
  const key = framingKey(path, libraryId());
  if (key === null) return;
  // Pixels alone reach here on a refusing deployment, and none of them is
  // ours to keep.
  if (save.camera === undefined && save.axis === undefined) return;
  const held = readLocalFraming(path, storage, libraryId);
  const next: LocalFraming = {
    camera:
      save.camera === undefined ? held?.camera : (save.camera ?? undefined),
    axis: save.axis === undefined ? held?.axis : (save.axis ?? undefined),
  };
  try {
    if (next.camera === undefined && next.axis === undefined)
      storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage refused the write — the framing is simply not kept.
  }
}

export type ListableStorage = Pick<Storage, "length" | "key" | "removeItem">;

/**
 * Every framing, every library, once at startup while the flag above is off —
 * so the disable does not become a cache of stale framings waiting for it to
 * flip back. By prefix, since the id is unknown at startup.
 *
 * Names are collected before any is removed: `Storage` is index-addressed and
 * renumbers as it shrinks, so removing inside the walk skips a neighbour.
 */
export function sweepLocalFramings(
  storage: ListableStorage | null = browserStorage(),
): void {
  if (FRAMINGS_KEPT_LOCALLY || storage === null) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(PREFIX)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Storage refused — there is nothing held to sweep.
  }
}

/**
 * `ApiClient` with the thumbnail read and write routed through this browser
 * where the deployment refuses writes (D6).
 *
 * **Explicit delegates**, so a method added to `ApiClient` later fails to
 * compile here rather than being forwarded unconsidered — and each takes
 * `...args: Parameters<…>`, because naming an optional parameter re-emits it as
 * an explicit `undefined` and a three-argument call arrives as four.
 */
class LocalFramingClient implements ApiClient {
  constructor(
    private readonly inner: ApiClient,
    private readonly report: () => FeatureReport | null,
    private readonly storage: FramingStorage | undefined,
    private readonly libraryId: () => string | null,
  ) {}

  /** The lookup still happens; only the orientation is overlaid. A `miss` with
   *  a local camera is still a `miss`. */
  async getThumb(
    ...args: Parameters<ApiClient["getThumb"]>
  ): Promise<ThumbResult> {
    const answer = await this.inner.getThumb(...args);
    if (!keepsFramingsLocally(this.report())) return answer;
    const local = readLocalFraming(args[0], this.storage, this.libraryId);
    if (local === undefined) return answer;
    return {
      ...answer,
      camera: local.camera ?? answer.camera,
      axis: local.axis ?? answer.axis,
    };
  }

  /**
   * Kept here, sent nowhere: the pixels are dropped, and the labels describing
   * pixels with them, for `withoutUnusableRender`'s reason. `dropped` and no
   * `gen` is how a generate job reports work not done.
   *
   * An unknown report still writes to the server first — not knowing must not
   * move a user's orientations — but an arriving `refused: 'thumbWrites'` is
   * acted on, being the only word available while the report is in flight.
   */
  async putThumb(save: ThumbSave): Promise<ThumbPutResult> {
    if (keepsFramingsLocally(this.report())) {
      writeLocalFraming(save.path, save, this.storage, this.libraryId);
      return { dropped: true };
    }
    try {
      return await this.inner.putThumb(save);
    } catch (err) {
      if (!(err instanceof HttpError) || err.refused !== "thumbWrites")
        throw err;
      writeLocalFraming(save.path, save, this.storage, this.libraryId);
      return { dropped: true };
    }
  }

  listDir(...args: Parameters<ApiClient["listDir"]>): Promise<DirListing> {
    return this.inner.listDir(...args);
  }
  nameMatchCount(
    ...args: Parameters<NonNullable<ApiClient["nameMatchCount"]>>
  ): Promise<number> {
    return this.inner.nameMatchCount === undefined
      ? Promise.reject(new Error("name counts unsupported"))
      : this.inner.nameMatchCount(...args);
  }
  models(...args: Parameters<ApiClient["models"]>): Promise<ModelsListing> {
    return this.inner.models(...args);
  }
  complete(...args: Parameters<ApiClient["complete"]>): Promise<string[]> {
    return this.inner.complete(...args);
  }
  peek(...args: Parameters<ApiClient["peek"]>): Promise<DirEntry[]> {
    return this.inner.peek(...args);
  }
  fetchModel(
    ...args: Parameters<ApiClient["fetchModel"]>
  ): Promise<ArrayBuffer> {
    return this.inner.fetchModel(...args);
  }
  fetchModelGlb(
    ...args: Parameters<ApiClient["fetchModelGlb"]>
  ): Promise<ArrayBuffer> {
    return this.inner.fetchModelGlb(...args);
  }
  overrides(
    ...args: Parameters<ApiClient["overrides"]>
  ): Promise<ResolvedOverrides> {
    return this.inner.overrides(...args);
  }
  credits(...args: Parameters<ApiClient["credits"]>): Promise<CreditedKit[]> {
    return this.inner.credits(...args);
  }
  indexAvailability(
    ...args: Parameters<ApiClient["indexAvailability"]>
  ): Promise<IndexAvailability> {
    return this.inner.indexAvailability(...args);
  }
  semanticPoses(
    ...args: Parameters<ApiClient["semanticPoses"]>
  ): Promise<PosesResponse> {
    return this.inner.semanticPoses(...args);
  }
  semanticPosesFor(
    ...args: Parameters<ApiClient["semanticPosesFor"]>
  ): Promise<PosesResponse> {
    return this.inner.semanticPosesFor(...args);
  }
  library(...args: Parameters<ApiClient["library"]>): Promise<LibraryState> {
    return this.inner.library(...args);
  }
  semanticSearch(
    ...args: Parameters<ApiClient["semanticSearch"]>
  ): Promise<SemanticListing> {
    return this.inner.semanticSearch(...args);
  }
  similar(...args: Parameters<ApiClient["similar"]>): Promise<SimilarListing> {
    return this.inner.similar(...args);
  }
  thumbImageUrl(...args: Parameters<ApiClient["thumbImageUrl"]>): string {
    return this.inner.thumbImageUrl(...args);
  }
  apps(...args: Parameters<ApiClient["apps"]>): Promise<AppsReport> {
    return this.inner.apps(...args);
  }
  features(...args: Parameters<ApiClient["features"]>): Promise<FeatureReport> {
    return this.inner.features(...args);
  }
  open(...args: Parameters<ApiClient["open"]>): Promise<void> {
    return this.inner.open(...args);
  }
  openWith(...args: Parameters<ApiClient["openWith"]>): Promise<void> {
    return this.inner.openWith(...args);
  }
}

/** The report and the library id are getters, read per call, so one client
 *  identity survives them resolving a round trip after this is built. */
export function withLocalFramings(
  inner: ApiClient,
  features: () => FeatureReport | null,
  storage?: FramingStorage,
  libraryId: () => string | null = NO_LIBRARY,
): ApiClient {
  return new LocalFramingClient(inner, features, storage, libraryId);
}
