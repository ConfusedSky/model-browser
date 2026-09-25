import { THUMB_MIME } from "../../../shared/types";
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
} from "../../../shared/types";
import { thumbImageUrl } from "./thumbUrl";

/**
 * One render's answer. `camera` and `axis` are the entry's, shared by both
 * occlusion variants; the rest describe the render that was asked for, so no
 * `ao` is echoed back (`ao-as-recipe-dimension` D2).
 */
export interface ThumbResult {
  status: ThumbStatus;
  camera?: CameraState;
  axis?: OrbitAxis;
  /** Recipe labels; an absent one is stale to `useThumbnails`. */
  lighting?: LightingMode;
  rig?: number;
  posed?: number;
  poseKey?: string;
  /** Absent on a hit when the read asked for no pixels. */
  pngUrl?: string;
  /** Write generation; passing it back earns an `immutable` answer, and not
   *  knowing it costs a revalidation, never a wrong picture (D4). */
  gen?: number;
}

export interface ThumbPutResult {
  gen?: number;
  /** The pixels were dropped as unstorable (`webp-thumbnails` D6) — a caller
   *  counting renders made must not count this one. */
  dropped?: true;
}

export interface ThumbSave {
  path: string;
  mtime: number;
  /** Set / keep / discard, on every field below that spells it: a value
   *  stores, absence keeps what is stored, `null` deletes (`bulk-thumbnail-jobs`
   *  D3, entry-context-menu D7). A `null` here drops both occlusion variants. */
  png?: Blob | null;
  camera?: CameraState | null;
  axis?: OrbitAxis | null;
  lighting?: LightingMode;
  rig?: number;
  posed?: number;
  poseKey?: string;
  /** Which variant these pixels are; absent means occluded. The same value the
   *  caller rendered under, never a second reading of the preference (D4a). */
  ao?: boolean;
  /** Makes the write conditional: refused, changing nothing, once the entry has
   *  moved past this generation (`bulk-thumbnail-jobs` D4). */
  ifGen?: number;
}

import { POSES_MAX } from "../../../shared/types";
export { POSES_MAX };

/**
 * All frontend I/O goes through this interface — never raw fetch in components
 * (D1), so the Electron port can swap HTTP for IPC without touching callers.
 *
 * Only the three calls a user can supersede take an `AbortSignal`
 * (`search-cancellation`); everything else is bounded or answered from memory,
 * and a superseded answer is dropped on arrival.
 */
export interface ApiClient {
  listDir(
    path: string,
    opts?: { flat?: boolean; q?: string; folderMatching?: boolean },
    signal?: AbortSignal,
  ): Promise<DirListing>;
  /** How many entries a name search for `q` beneath `path` would show — asked
   *  beside a meaning search, so a model's name is never lost to guesses.
   *  Optional: a client without it simply never offers the names. */
  nameMatchCount?(
    path: string,
    q: string,
    folderMatching: boolean,
    signal?: AbortSignal,
  ): Promise<number>;
  /** Every model beneath `path`, with the caches' thumbnail facts
   *  (`listing-tree-cache`). An enumeration, not a listing: no response cap,
   *  and `complete` says whether the traversal ran out of budget. */
  models(path: string): Promise<ModelsListing>;
  complete(prefix: string): Promise<string[]>;
  /** The first few models inside `path`, for the folder tile's contact sheet
   *  (folder-contact-sheets D1). `n` defaults to 4 and is capped at 8 server
   *  side; a zip answers `[]` rather than an error. */
  peek(path: string, n?: number): Promise<DirEntry[]>;
  /**
   * A model's own bytes. `mtime` is the version the caller believes the source
   * is at — the listing entry's modification time, which for an entry inside a
   * zip is the archive's — and earns an answer the reader may pin. Omitting it
   * asks the version-less tier: a revalidation rather than a pin, and otherwise
   * identical, so a caller holding only a path keeps working. It is sent
   * exactly as the listing reported it, fraction included: a rounded version is
   * one the source never had, so nothing would ever pin (D2/D5).
   *
   * (One block, not several: only the last of several consecutive JSDoc
   * comments reaches a hover.)
   */
  fetchModel(path: string, mtime?: number): Promise<ArrayBuffer>;
  /**
   * An STL model's geometry as a derived GLB (server-glb-cache). The viewer
   * calls this for `stl` and keeps `fetchModel` for `obj`/`3mf`.
   *
   * `mtime` is `fetchModel`'s: the listing entry's version, the archive's for a
   * zip entry, never rounded; omitted, the request is today's version-less one
   * (D2/D5).
   */
  fetchModelGlb(path: string, mtime?: number): Promise<ArrayBuffer>;
  /** One entry's effective overrides, `{}` where nothing resolves
   *  (`library-overrides` D3). One path per call is the trade the route exists
   *  to make: a listing would resolve hundreds to serve one lightbox. */
  overrides(path: string): Promise<ResolvedOverrides>;
  /** Every credited kit the store holds — the About page's list
   *  (`landing-page` D8). */
  credits(): Promise<CreditedKit[]>;
  /** Availability of the semantic index — cheap, cached server-side (D4). */
  indexAvailability(opts?: { fresh?: boolean }): Promise<IndexAvailability>;
  /** A directory's **direct children only**, which is not what a flat listing
   *  or a name search puts on screen — **no caller under `client/src` uses
   *  this**; the wave asks by path below. Kept for a directory-shaped ask. */
  semanticPoses(dirPath: string): Promise<PosesResponse>;
  /**
   * The index's orientation for each named model, keyed by library path — a
   * listing's second wave (`pose-for-every-model` D3). A missing key is "no
   * pose", which is also what an absent, warming or uncovering index answers.
   *
   * Chunked at `POSES_MAX` and partial-tolerant: a failed chunk un-poses its
   * own slice, and it rejects only if every chunk failed.
   */
  semanticPosesFor(paths: string[]): Promise<PosesResponse>;
  /** What state the library is in (library R4) — the one route that answers
   *  while every other is 503ing. Its `top` is the only filesystem path the
   *  client holds, read by `expandLibraryPath` alone. */
  library(): Promise<LibraryState>;
  /** A meaning query. Throws HttpError(503) carrying the index's state. */
  semanticSearch(
    text: string,
    path?: string,
    tuning?: SemanticTuning,
    signal?: AbortSignal,
  ): Promise<SemanticListing>;
  /**
   * A model's nearest neighbours over the whole indexed collection — no scope
   * is sent (entry-context-menu D4). Throws `HttpError(404)` when the index has
   * never embedded it; the **status** is the contract, not the message.
   *
   * An undefined `pool` is not a fourth value: it leaves the index's own
   * default in force, so the field is dropped from the body.
   */
  similar(
    model: string,
    k: number,
    pool?: SemanticTuning["pool"],
    signal?: AbortSignal,
  ): Promise<SimilarListing>;
  /**
   * The cached thumbnail for one render of `path`. `gen` is the generation the
   * caller believes the entry is at, and earns an indefinitely cacheable answer
   * (D2); `pixels: false` skips the base64 render, which is the weight of the
   * answer and an object URL the caller would have to revoke.
   *
   * (One block, not three: only the last of several consecutive JSDoc comments
   * reaches a hover.)
   */
  getThumb(
    path: string,
    mtime: number,
    ao?: boolean,
    gen?: number,
    pixels?: boolean,
  ): Promise<ThumbResult>;
  /** The same render as `image/webp` bytes for an `<img src>`, no lookup
   *  (`thumbnail-image-serving` D1). A pure builder; same key as `getThumb`. */
  thumbImageUrl(path: string, mtime: number, ao: boolean, gen?: number): string;
  putThumb(save: ThumbSave): Promise<ThumbPutResult>;
  /** The platform registry's applications and whether a chooser is configured
   *  (open-in-slicer L5). Fetched once per session and after an open-with,
   *  which may have rewritten the registry — **never on a menu open** (D6). */
  apps(): Promise<AppsReport>;
  /** What this server accepts and offers (feature-report D2) — capability
   *  fields, never a mode name, so one client build serves every deployment. */
  features(): Promise<FeatureReport>;
  /** Open `path` in the application `appId` names — a one-shot launch, resolving
   *  when the platform's launch command succeeded (L8). */
  open(path: string, appId: string): Promise<void>;
  /** Hand `path` to the platform's chooser (L4). Unbounded on purpose — it
   *  spans a human decision, and an abort would have to mean killing the
   *  chooser, which a dismissal must not (L9). */
  openWith(path: string): Promise<void>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The failure body's `state` — the **library's** from a path route, the
     *  **index's** from an index route, and the field does not say which.
     *  Carried, not interpreted, and a bare string so no caller renders off it
     *  instead of asking `library()`. */
    readonly state?: string,
    /** The capability a `Refused` body named (feature-report). 403 is also what
     *  the origin guard answers a stranger, so this field — not the status —
     *  tells "not offered here" from "that went wrong". */
    readonly refused?: keyof FeatureReport,
  ) {
    super(message);
  }
}

/** The failure body, read once, so every call site agrees about its fields. */
async function errorOf(res: Response): Promise<HttpError> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    state?: string;
    refused?: string;
  } | null;
  // Narrowed by shape, never validated against `FeatureReport`'s keys: a server
  // naming a field this build has not heard of has still refused.
  const refused =
    typeof body?.refused === "string"
      ? (body.refused as keyof FeatureReport)
      : undefined;
  return new HttpError(
    res.status,
    body?.error ?? res.statusText,
    body?.state,
    refused,
  );
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await errorOf(res);
  return res.json() as Promise<T>;
}

async function okOrThrow(res: Response): Promise<void> {
  if (res.ok) return;
  throw await errorOf(res);
}

/**
 * `canvas.toBlob` silently answers PNG where it cannot encode WebP, and those
 * bytes must not be stored under a WebP name (`webp-thumbnails` D6). The
 * orientation in the same write still must: dropping it whole would lose the
 * user's framing and report success. So the pixels go, and the labels that
 * describe pixels with them — labelling the *stored* render as current is the
 * worse lie — and `null` where nothing but pixels was being written.
 */
function withoutUnusableRender(save: ThumbSave): ThumbSave | null {
  if (!(save.png instanceof Blob) || save.png.type === THUMB_MIME) return save;
  const {
    png: _pixels,
    lighting: _lighting,
    rig: _rig,
    posed: _posed,
    poseKey: _poseKey,
    ...rest
  } = save;
  return rest.camera === undefined && rest.axis === undefined ? null : rest;
}

function base64ToBlobUrl(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export class HttpApiClient implements ApiClient {
  constructor(private fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  async nameMatchCount(
    path: string,
    q: string,
    folderMatching: boolean,
    signal?: AbortSignal,
  ): Promise<number> {
    const listing = await this.listDir(
      path,
      { flat: true, q, folderMatching },
      signal,
    );
    return listing.entries.length;
  }

  async listDir(
    path: string,
    opts?: { flat?: boolean; q?: string; folderMatching?: boolean },
    signal?: AbortSignal,
  ): Promise<DirListing> {
    const flat = opts?.flat === true ? "&flat=true" : "";
    // Free-form user text, unlike the boolean `flat` — the URL is built by
    // concatenation, so an unescaped `&` or `#` would silently truncate it.
    const q =
      opts?.q !== undefined && opts.q.trim() !== ""
        ? `&q=${encodeURIComponent(opts.q)}`
        : "";
    // Sent only when off: the server's default is the shipped predicate, so an
    // ordinary request carries no `folders` at all.
    const folders = opts?.folderMatching === false ? "&folders=false" : "";
    const res = await this.fetchFn(
      `/api/dir?path=${encodeURIComponent(path)}${flat}${q}${folders}`,
      { signal },
    );
    return jsonOrThrow<DirListing>(res);
  }

  async models(path: string): Promise<ModelsListing> {
    const res = await this.fetchFn(
      `/api/models?path=${encodeURIComponent(path)}`,
    );
    return jsonOrThrow<ModelsListing>(res);
  }

  async indexAvailability(opts?: {
    fresh?: boolean;
  }): Promise<IndexAvailability> {
    const q = opts?.fresh === true ? "?fresh=true" : "";
    const res = await this.fetchFn(`/api/semantic/status${q}`);
    return jsonOrThrow<IndexAvailability>(res);
  }

  async semanticPoses(dirPath: string): Promise<PosesResponse> {
    const res = await this.fetchFn(
      `/api/semantic/poses?path=${encodeURIComponent(dirPath)}`,
    );
    return jsonOrThrow<PosesResponse>(res);
  }

  async semanticPosesFor(paths: string[]): Promise<PosesResponse> {
    // Sequential, not parallel: background work behind a grid already drawn,
    // so it may spend round trips rather than burst connections at a
    // single-worker index.
    const poses: PosesResponse["poses"] = {};
    // Counted, not inferred from `firstFailure`: a rejection value is whatever
    // was thrown, `null` and `undefined` included.
    let landed = 0;
    let failed = 0;
    let firstFailure: unknown = null;
    for (let i = 0; i < paths.length; i += POSES_MAX) {
      const body: PosesRequest = { paths: paths.slice(i, i + POSES_MAX) };
      try {
        const res = await this.fetchFn("/api/semantic/poses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        Object.assign(poses, (await jsonOrThrow<PosesResponse>(res)).poses);
        landed += 1;
      } catch (err) {
        if (failed === 0) firstFailure = err;
        failed += 1;
      }
    }
    if (landed === 0 && failed > 0) throw firstFailure;
    return { poses };
  }

  async library(): Promise<LibraryState> {
    const res = await this.fetchFn("/api/library");
    return jsonOrThrow<LibraryState>(res);
  }

  async semanticSearch(
    text: string,
    path?: string,
    tuning: SemanticTuning = {},
    signal?: AbortSignal,
  ): Promise<SemanticListing> {
    const res = await this.fetchFn("/api/semantic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, path, ...tuning }),
      signal,
    });
    return jsonOrThrow<SemanticListing>(res);
  }

  async similar(
    model: string,
    k: number,
    pool?: SemanticTuning["pool"],
    signal?: AbortSignal,
  ): Promise<SimilarListing> {
    const res = await this.fetchFn("/api/semantic/similar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `JSON.stringify` drops an `undefined` field, so an unset pool leaves
      // the index's own in force.
      body: JSON.stringify({ path: model, k, pool }),
      signal,
    });
    return jsonOrThrow<SimilarListing>(res);
  }

  async complete(prefix: string): Promise<string[]> {
    const res = await this.fetchFn(
      `/api/complete?prefix=${encodeURIComponent(prefix)}`,
    );
    return jsonOrThrow<string[]>(res);
  }

  async peek(path: string, n?: number): Promise<DirEntry[]> {
    // Absence already means the server's default, so an ordinary sheet's
    // request carries no `n` at all.
    const count = n !== undefined ? `&n=${n}` : "";
    const res = await this.fetchFn(
      `/api/peek?path=${encodeURIComponent(path)}${count}`,
    );
    return jsonOrThrow<DirEntry[]>(res);
  }

  async overrides(path: string): Promise<ResolvedOverrides> {
    const res = await this.fetchFn(
      `/api/overrides?path=${encodeURIComponent(path)}`,
    );
    return jsonOrThrow<ResolvedOverrides>(res);
  }

  async credits(): Promise<CreditedKit[]> {
    const res = await this.fetchFn("/api/credits");
    return jsonOrThrow<CreditedKit[]>(res);
  }

  async fetchModel(path: string, mtime?: number): Promise<ArrayBuffer> {
    // Appended only when it says something, and interpolated rather than
    // formatted: the fraction is part of the version the server compares (D5).
    const res = await this.fetchFn(
      `/api/file?path=${encodeURIComponent(path)}${mtime !== undefined ? `&mtime=${mtime}` : ""}`,
    );
    if (!res.ok) throw await errorOf(res);
    return res.arrayBuffer();
  }

  async fetchModelGlb(path: string, mtime?: number): Promise<ArrayBuffer> {
    const res = await this.fetchFn(
      `/api/model.glb?path=${encodeURIComponent(path)}${mtime !== undefined ? `&mtime=${mtime}` : ""}`,
    );
    if (!res.ok) throw await errorOf(res);
    return res.arrayBuffer();
  }

  async getThumb(
    path: string,
    mtime: number,
    ao = true,
    gen?: number,
    pixels = true,
  ): Promise<ThumbResult> {
    // Appended only when they say something, so the common request stays one
    // URL and an unknown generation rides the validator tier (D2).
    const res = await this.fetchFn(
      `/api/thumb?path=${encodeURIComponent(path)}&mtime=${mtime}${ao ? "" : "&ao=off"}${gen !== undefined ? `&gen=${gen}` : ""}${pixels ? "" : "&pixels=off"}`,
    );
    const body = await jsonOrThrow<ThumbGetResponse>(res);
    return {
      status: body.status,
      camera: body.camera,
      axis: body.axis,
      lighting: body.lighting,
      rig: body.rig,
      posed: body.posed,
      poseKey: body.poseKey,
      gen: body.gen,
      // Minted only for a caller that asked: an older server or a cache can
      // still send pixels, and a caller that did not ask revokes nothing.
      pngUrl:
        pixels && body.png !== undefined
          ? base64ToBlobUrl(body.png)
          : undefined,
    };
  }

  thumbImageUrl(
    path: string,
    mtime: number,
    ao: boolean,
    gen?: number,
  ): string {
    return thumbImageUrl(path, mtime, ao, gen);
  }

  async apps(): Promise<AppsReport> {
    const res = await this.fetchFn("/api/apps");
    return jsonOrThrow<AppsReport>(res);
  }

  async features(): Promise<FeatureReport> {
    const res = await this.fetchFn("/api/features");
    return jsonOrThrow<FeatureReport>(res);
  }

  async open(path: string, appId: string): Promise<void> {
    const res = await this.fetchFn("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, appId }),
    });
    await okOrThrow(res);
  }

  async openWith(path: string): Promise<void> {
    const res = await this.fetchFn("/api/open-with", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    await okOrThrow(res);
  }

  async putThumb(save: ThumbSave): Promise<ThumbPutResult> {
    const write = withoutUnusableRender(save);
    if (write === null) return { dropped: true };
    const res = await this.fetchFn("/api/thumb", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: write.path,
        mtime: write.mtime,
        // `JSON.stringify` drops `undefined`, which is what "absence keeps"
        // means — so the `null` deletion has to be written through by hand.
        png:
          write.png === null
            ? null
            : write.png === undefined
              ? undefined
              : await blobToBase64(write.png),
        camera: write.camera,
        axis: write.axis,
        lighting: write.lighting,
        rig: write.rig,
        posed: write.posed,
        poseKey: write.poseKey,
        ao: write.ao,
        ifGen: write.ifGen,
      }),
    });
    // A refused conditional write is a 412 `HttpError`, which a bulk job
    // branches on to count the entry skipped rather than failed (D4).
    if (!res.ok) throw await errorOf(res);
    // A missing or unparseable body is not a failed write — an older server
    // answers `{ok:true}` — so it degrades to "generation unknown".
    const body = (await res.json().catch(() => ({}))) as { gen?: number };
    // Identity is the helper's contract: the caller's own object back when the
    // render is storable, a stripped copy when it is not.
    return write === save
      ? { gen: body.gen }
      : { gen: body.gen, dropped: true };
  }
}
