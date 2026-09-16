export type EntryKind = "dir" | "zip" | "model";

/** One definition for the wire, `parseModel`, `defaultAxisFor` and the server's `MODEL_EXT`. */
export type ModelFormat = "stl" | "3mf" | "obj";

export interface DirEntry {
  name: string;
  /** Virtual path: plain fs path, or `zip.zip!/inner/entry` for zip contents. */
  path: string;
  kind: EntryKind;
  /** Model format, present when kind === 'model'. */
  format?: ModelFormat;
  size: number;
  /** mtime (ms). For zip entries this is the containing zip's mtime. */
  mtime: number;
  /** The override store's name for this exact path. Display only — `name` stays the title and what search matches (library-overrides D7). */
  displayName?: string;
  /** What the server's caches already held when the listing was emitted; absent means not derived, not "none" (`listing-tree-cache`). */
  thumb?: ThumbInfo;
  /**
   * The index's orientation. Three states: a pose; `null`, a settled "the index
   * holds none", which the client must not re-ask; absent, not yet derived, and
   * the client's pose wave is the fill (`listing-tree-cache`).
   */
  pose?: IndexPose | null;
  /** Directories only: the contact sheet a peek already derived for this folder. */
  preview?: DirEntry[];
}

/**
 * One render's cached state on a listing or an enumeration
 * (`thumbnail-image-serving` D2). `state` is derived at emission from the
 * stored mtime against the entry's, never stored as a verdict; `rig` and
 * `posed` are client constants the server echoes but never interprets.
 */
export interface ThumbRenderInfo {
  state: ThumbStatus;
  lighting?: LightingMode;
  rig?: number;
  posed?: number;
  /** The orientation this render was drawn under; a posed render missing it, or carrying another, is stale. */
  poseKey?: string;
}

/**
 * An entry's thumbnail state: entry-level facts, then one block per occlusion
 * variant. It cannot vouch that the image is still on disk — eviction removes
 * pixels without asking it, so a `hit` must still tolerate a `/api/thumb`
 * answer that disagrees (`thumbnail-image-serving` D3).
 */
export interface ThumbInfo {
  /** The entry's write generation — the cache validator every read echoes. */
  gen: number;
  /** A stored orientation exists: a camera **or** an axis. */
  framed: boolean;
  camera?: CameraState;
  axis?: OrbitAxis;
  ao?: ThumbRenderInfo;
  noao?: ThumbRenderInfo;
}

/**
 * Every model beneath a library path — an **enumeration, not a listing**, so no
 * response cap applies: a scope silently cut to a cap would be a different
 * scope. `complete` is false where the traversal hit its work budget.
 */
export interface ModelsListing {
  path: string;
  entries: DirEntry[];
  complete: boolean;
}

/** What an explicit reload found: cached roots re-checked, and whether any had moved on disk. */
export interface ReloadResult {
  ok: true;
  roots: number;
  changed: boolean;
}

export interface DirListing {
  path: string;
  entries: DirEntry[];
  /** Flat listings only: models were dropped by the return cap or walk budget. */
  truncated?: boolean;
  /**
   * Served from a cached tree not yet checked against the filesystem; a
   * revalidation is already running and the client should ask again. Absent
   * means fresh-or-validated, and it is never `false`.
   */
  stale?: true;
}

/** Attribution as the override store holds it. Every field is optional — a partial credit is still a true one. */
export interface OverrideCredits {
  author?: string;
  authorUrl?: string;
  /** The license's label as the source page gives it — never normalised here. */
  license?: string;
  /** The license deed's URI, version included — the URL carries the version, never the label (`credits-completion` D3). */
  licenseUrl?: string;
  /** What was done to the served copy, drawn verbatim. **Absent means served unchanged** (`credits-completion` D2). */
  modified?: string;
  sourceUrl?: string;
}

/**
 * One key of `.model-browser/overrides.json` (library-overrides D1/D6). Unknown
 * fields are preserved by writers and ignored by resolution, so the format
 * grows additively within `version: 1`.
 */
export interface OverrideEntry {
  /** Names the thing at this exact key. Never inherited (D2/D7). */
  name?: string;
  credits?: OverrideCredits;
  /** Reserved by name only — the stored pose's shape belongs to `pose-for-every-model`, and nothing here reads it (D6). */
  pose?: unknown;
}

/**
 * An entry's effective overrides — `GET /api/overrides`, `{}` where nothing
 * resolves. Field-for-field `OverrideEntry` by construction, but named
 * separately: a stored-only or resolved-only field changes one of them.
 */
export interface ResolvedOverrides {
  name?: string;
  credits?: OverrideCredits;
  pose?: unknown;
}

/**
 * One kit as `GET /api/credits` lists it: a store key holding credits of its
 * **own** — a key that merely inherits them is not a kit (`landing-page` D8).
 * `path` is the store's key, a library path and never a host location.
 */
export interface CreditedKit {
  path: string;
  name?: string;
  credits: OverrideCredits;
}

/**
 * Orbit spindle axis: the model turns around it, camera up locked to it, sign
 * included. No default here — an un-framed model turns about its format's up
 * axis (`defaultAxisFor`).
 */
export type OrbitAxis = "x" | "-x" | "y" | "-y" | "z" | "-z";

/**
 * Bounds- and spindle-relative, never world coordinates: `az`/`el` in radians
 * within the model's spindle frame, `distR` in bounding-sphere radii, `target`
 * from the bounding-box centre in radii. An STL camera stored under the older
 * `y` default reads unchanged under `z` (file-frame-spindle D3).
 */
export interface CameraState {
  az: number;
  el: number;
  distR: number;
  target: [number, number, number];
}

/**
 * The one encoding a thumbnail is produced, stored and served in
 * (`webp-thumbnails`). Shared because `canvas.toBlob`, the upload check and the
 * image route must agree, and a disagreement is silent.
 */
export const THUMB_MIME = "image/webp";

/**
 * How far two `CameraState`s may differ per component and still be the same
 * orientation — one tolerance for all of them, since every component is
 * unit-free. A lightbox close re-captures through az/el → cartesian → az/el and
 * PUTs the result whether or not the user moved anything; under value equality
 * that would invalidate the sibling render every time. The camera round-trip
 * test asserts the headroom.
 */
export const CAMERA_EPSILON = 1e-9;

export type ThumbStatus = "hit" | "stale" | "miss";

/**
 * Every render writes `'camera'` and the server refuses a PUT saying otherwise.
 * `'axis'` is never written anew; it stays readable so a client can see those
 * pixels are stale (`remove-axis-lighting`).
 */
export type LightingMode = "axis" | "camera";

/**
 * One render of an entry — whichever `ao` named. `status`, `png` and the recipe
 * labels describe that render; `camera` and `axis` are the entry's own. `png`
 * is a wire name that outlived its format: the bytes are `THUMB_MIME`.
 */
export interface ThumbGetResponse {
  status: ThumbStatus;
  camera?: CameraState;
  /** Stored spindle axis; absent is not `'y'` but "the user has chosen none". */
  axis?: OrbitAxis;
  /** Absent on entries stored before the label existed. */
  lighting?: LightingMode;
  /** Pixel-recipe version; absent on entries stored before the label existed. */
  rig?: number;
  /**
   * Which pose recipe framed the render, absent when none did. A version, not a
   * flag: the pose is an input to the pixels that the cache key does not carry,
   * and its mapping can change, leaving a wrong render looking fresh.
   */
  posed?: number;
  /** The pose's *value* beside `posed`'s version — a posed render without it is stale (`pose-rerender` D2). */
  poseKey?: string;
  /** base64 `THUMB_MIME` bytes when status === 'hit', unless the request asked `pixels=off`. */
  png?: string;
  /**
   * The entry's write generation: moved on **every** write to the entry and
   * never regressing, so `path`+`mtime`+`ao`+`gen` fully names the response
   * bytes and a repeat read can be answered `immutable`
   * (`immutable-thumbnail-serving` D1). Entry-level, so both renders report the
   * same number; 0 for an entry that does not exist, and absence reads as 0.
   */
  gen?: number;
}

/** `gen` is the generation **after** this write, so the writer can key its next read without a round trip. */
export interface ThumbPutResponse {
  ok: true;
  gen: number;
}

/**
 * A refused conditional write: 412, nothing written (`bulk-thumbnail-jobs` D4).
 * Its own shape, so a bulk job counts it as a skip rather than confusing it
 * with the 400 a malformed field gets. `gen` is the entry's **current**
 * generation, so a retry can re-key from the refusal.
 */
export interface ThumbPutRefused {
  error: string;
  gen: number;
}

export interface ThumbPutRequest {
  path: string;
  mtime: number;
  /**
   * Three states: base64 `THUMB_MIME` pixels **replace** this render's bytes,
   * absence **keeps** them, `null` **deletes** both variants' pixels and recipe
   * labels (`bulk-thumbnail-jobs` D3). Pixels only — the stored orientation is
   * `camera`/`axis`'s business.
   */
  png?: string | null;
  /**
   * Three states: a value **sets**, absence **keeps**, `null` **discards**.
   * Silence must go on meaning keep, since every pixel write omits it, so
   * giving an orientation up needs a word of its own (entry-context-menu D7).
   */
  camera?: CameraState | null;
  /** Set / keep / discard as `camera` — discarded with it, since angles about one axis do not describe a view about another. */
  axis?: OrbitAxis | null;
  lighting?: LightingMode;
  rig?: number;
  /** Pose recipe version the render was drawn under; absent when unposed. */
  posed?: number;
  /**
   * `poseKeyOf` over the camera and axis the pose resolved to — what the pixels
   * depended on, so two opinions deriving the same view do not re-render
   * (`pose-rerender` D2). A posed render lacking it, or carrying another, is
   * stale.
   */
  poseKey?: string;
  /** `true` or absent the occluded render, `false` the unoccluded sibling — absent is occluded, all an older client could have meant. */
  ao?: boolean;
  /**
   * Makes the write **conditional**: given and no longer current, the server
   * changes nothing and answers `ThumbPutRefused`. It is a bulk job's mid-job
   * skip — the job snapshots generations up front, so an entry orbited since is
   * left alone (`bulk-thumbnail-jobs` D4). `ifGen: 0` means "only if nothing
   * was ever written here".
   */
  ifGen?: number;
}

/**
 * What a result set is beside its entries. The counts are the index's claims
 * about itself, not about the folder: `scanned` tracks it only loosely.
 */
export interface SemanticScope {
  /**
   * Where the query was judged, as a **library path** — the index's own
   * spelling is a filesystem path and never reaches a viewer. `null` where
   * there is none to give: no scope reported, or one outside the library.
   */
  path: string | null;
  status: "indexed" | "partial" | "unindexed";
  indexed: number;
  scanned: number;
  /** Extensions the index can hold at all — published by it, not assumed here. */
  covers: string[];
}

/** An orientation the index supplies: which way is up, and the angles its front view was rendered from. */
export interface IndexPose {
  up: [number, number, number];
  /** The model-space direction the index's azimuth 0 is measured from. */
  azimuth_zero: [number, number, number];
  source: string;
  confidence: number;
  front: { view: number; azimuth_deg: number; elevation_deg: number } | null;
}

/**
 * The index's two numbers, verbatim: nothing is rescaled or banded here, since
 * the index's thresholds are stated against these (confidence-scores-on-tiles
 * D2/D4). `score` is comparable only within one result set, and the two scoring
 * routes run on visibly different scales, so any surface drawing it must name
 * the scale beside it (D3).
 */
export interface IndexScore {
  /** Pooled cosine similarity, under whichever pooling the request asked for. */
  score: number;
  /** Robust z (median/MAD) over the scored set — comparable across queries. */
  z: number;
}

/** How a meaning query is shaped, beyond the phrase and the scope. */
export interface SemanticTuning {
  /** Read the phrase as written rather than through the index's templates. */
  raw?: boolean;
  /** How a model's per-view scores reduce to one. */
  pool?: "mean" | "max" | "softmax";
  /** Caps what survived `minScore`; the two compose. Absent means this bound is not in force, never "unset". */
  top?: number;
  /** Everything at or above this score, capped by `top` where one is set. */
  minScore?: number;
}

/**
 * The largest count this app will send or store — the index's `cap` *default*,
 * which is what it gets since this app never sends one. Pinned to that default
 * rather than to a ceiling, so it does not rot silently if that changes.
 */
export const MAX_RESULT_COUNT = 500;

/**
 * A coarse guard against a pasted paragraph, refused at the route. It cannot
 * restate the index's own limit, which is a **token** budget no character count
 * describes, and it is not load-bearing: an over-budget phrase gets a plain 500
 * and availability stays `ready` (ConfusedSky/mini-classify#5).
 */
export const SEARCH_TEXT_MAX = 500;

export interface SemanticListing {
  path: string;
  entries: DirEntry[];
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>;
  /**
   * Keyed by library path as `poses` is, so "no entry" and "no score" are one
   * fact (confidence-scores-on-tiles D1). Optional: an older server sends none
   * and a newer client draws no badges.
   */
  scores?: Record<string, IndexScore>;
  scope: SemanticScope;
  /** The index found nothing standing out — the set is weak, not the results. */
  weak: boolean;
  /** The index's own ceiling stopped it returning what was asked for. */
  capped: boolean;
  /**
   * How many cleared the floor *before* a count cut them, so a view can say "N
   * of M" (floor-and-count-compose D9) — distinct from `capped`, the index's
   * ceiling. Optional, and never derived client-side: what arrives has already
   * been cut.
   */
  matched?: number;
}

/**
 * A model's nearest neighbours (entry-context-menu D4). Not a `SemanticListing`
 * with fields left blank: everything one carries beyond the tiles describes a
 * *phrase's* result. The index reports no `weak` here, which is why per-tile
 * strength is carried — without it the ranking is all a reader has. Neighbour
 * cosines run on their own scale, hence `sim` rather than `k`.
 */
export interface SimilarListing {
  /** The collection the neighbours were drawn from — the whole of it (D4). */
  path: string;
  entries: DirEntry[];
  /** Orientation per tile path, where the index has one. Advisory (D5). */
  poses: Record<string, IndexPose>;
  /** Keyed as `poses` is (D1); the anchor is absent from it, since the index excludes the query model from its own ranking. */
  scores?: Record<string, IndexScore>;
  /**
   * The model the neighbours were computed from — its own field because it is
   * not one of them, so anything counting tiles counts neighbours alone. Absent
   * when the model no longer stats.
   */
  anchor?: DirEntry;
}

/**
 * The index's orientations for a whole directory's models, so a browsing client
 * orients a model the way a searching one does (`pose-for-every-model` D2).
 * Keyed by library path, three states per asked path as `DirEntry.pose` has: a
 * pose; `null`, a settled absence, so a render drawn under an orientation is
 * stale; a missing key, unsettled, so that render stands (`pose-rerender` D5).
 * Its own request, never a field on `DirListing` — a listing must cost nothing
 * when the index is down (D3).
 */
export interface PosesResponse {
  poses: Record<string, IndexPose | null>;
}

/**
 * The most paths one `/poses` batch may carry — the bound the server refuses
 * past and the size both sides chunk at, declared once so they cannot differ.
 */
export const POSES_MAX = 1024;

/**
 * The **landed entries' own paths**, for the listings that are not one
 * directory's contents: a flat listing or a name search gathers models from
 * everywhere, so `?path=<dir>` would leave most of them unposed. Library paths;
 * one this library will not resolve is dropped rather than failing the request.
 */
export interface PosesRequest {
  paths: string[];
}

/** Availability of the semantic index, read from the wire (semantic-search D4). */
export type IndexState =
  | "ready"
  | "warming"
  | "wedged"
  | "volume-gone"
  | "absent";

export interface IndexAvailability {
  state: IndexState;
  /** As a **library path**; absent where the index covers a location outside the library, which `detail` then names (library-root D6). */
  collectionRoot?: string;
  /** Extensions the index can hold — read, never assumed (semantic-search D3). */
  covers?: string[];
  elapsed?: number;
  /** The index's own words when it has them; preferred to ours (D4). */
  detail?: string;
}

export interface ApiError {
  error: string;
}

/** One launchable application, as the platform registry names it. */
export interface AppRef {
  /** Desktop-file id, suffix included (`lycheeslicer.desktop`). */
  id: string;
  /** Human-readable name from the entry itself — ids never render (app-launch L2). */
  name: string;
}

/** A model type's registry entry: the default need not appear among the associations. */
export interface TypeApps {
  default: AppRef | null;
  associated: AppRef[];
}

/** `GET /api/apps` — fetched once per session, refetched after an open-with; never probed when a menu opens (open-in-slicer L5). */
export interface AppsReport {
  /** Whether a chooser command is configured server-side — gates "Open with…". */
  chooser: boolean;
  /** Keyed by mime, only the model types the app handles (open-in-slicer L6). */
  types: Record<string, TypeApps>;
}

/**
 * `GET /api/features` — named capability fields, never a mode name, so the
 * client cannot branch on a deployment kind (feature-report D1). Built once at
 * start, answerable in every library state, and **advisory**: refusing a write
 * stays the route's own job.
 */
export interface FeatureReport {
  /** Whether `PUT /api/thumb` is accepted. */
  thumbWrites: boolean;
  /** Whether the launcher routes are offered — each runs a command on the machine the server sits on. */
  appLaunch: boolean;
  /** Whether the chat side-panel tab is offered. Default **off**: it is a placeholder with no backend (public-deployment D4). */
  chatTab: boolean;
  /**
   * Whether the server's machine is the viewer's concern: whether anything may
   * name a location on it, or offer a remedy only an operator can perform.
   * Library paths are not such locations (public-deployment D11).
   */
  hostDetails: boolean;
  /**
   * Whether maintenance against the library is offered — dropping caches,
   * resetting framings in bulk. Bulk work that *fills* the thumbnail cache is
   * `thumbWrites`' instead, since it would otherwise render and discard
   * (public-deployment D4).
   */
  maintenance: boolean;
  /**
   * Whether the visitor introduction is offered — the banner, its chips, the
   * About affordance, the meaning-mode start (`visitor-intro`). Default **off**:
   * a personal installation has no visitor. No `/api` route is gated on it; the
   * one thing the server itself withholds is `/about.html`, 404 rather than
   * served out of the build, since carrying the file is not a declaration
   * (`landing-page` D1).
   */
  intro: boolean;
}

/**
 * A capability declared off is **not a fault**: 403 with a body naming the
 * field, so a client can tell it from something going wrong (public-deployment
 * D5). Every route carrying one refuses *first*, before parsing a body or
 * resolving a path, so it reveals nothing about the library.
 */
export interface Refused {
  error: string;
  refused: keyof FeatureReport;
}

/**
 * The deployment's own `config.json` (XDG config home, overridable by
 * `MODEL_BROWSER_CONFIG`): which library it opens, which capabilities it
 * offers, which origins it answers, where it listens (public-deployment D1).
 *
 * Parsing is **strict** — an unknown key or a wrong type anywhere is a startup
 * failure, since a quietly dropped typo would leave the server under a security
 * posture nobody authored (D2). Missing keys mean the built-in defaults.
 */
export interface DeploymentConfig {
  /** Overridden by a non-empty `MODEL_BROWSER_ROOT`, which overrides *this key alone* (D2). */
  root?: string;
  /**
   * `scheme://host[:port]`, no path. A list, since one deployment may answer
   * more than one name. Loopback is allowed besides, whatever is configured
   * (D3/D8).
   */
  origins?: string[];
  /** Where the server listens. Defaults to `127.0.0.1:3177`. */
  listen?: { host?: string; port?: number };
  /** Merged over the built-in defaults. An unknown field is a parse failure: a misspelled capability would offer the surface it was written to withhold. */
  features?: Partial<FeatureReport>;
}

/**
 * `ready` is the only state in which a path route answers; the rest are states
 * the UI renders rather than faults (library-root D4).
 */
export type LibraryState =
  | {
      state: "ready";
      /** The marker's id, or a hash of the top when `unmarked`. */
      id: string;
      /**
       * The **filesystem** path of the library's top, which the client joins a
       * library path onto for copy/paste. Absent under `hostDetails`, naming a
       * machine the viewer cannot reach (public-deployment D11).
       */
      top?: string;
      /** The configured root as a **library path**: `/` at the top, `/sub/dir` inside. A viewpoint, not a namespace (D1). */
      root: string;
      /** No marker could be written, so the id is a hash of the top: a remount is a different library. */
      unmarked?: true;
    }
  | { state: "unconfigured" }
  | {
      state: "missing";
      /** The configured root, verbatim; absent under `hostDetails`, since mounting a volume is an operator's remedy (D11). */
      root?: string;
    }
  | {
      state: "nested";
      /** The configured root, verbatim; absent under `hostDetails`. */
      root?: string;
      /**
       * A library top found *beneath* the root. Claiming it would have written
       * an enclosing marker and orphaned its cache, so nothing was written and
       * the root serves nothing until repointed (D1/R1).
       */
      library?: string;
    };
