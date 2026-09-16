import { realpath, stat } from "node:fs/promises";
import { basename, posix, resolve, sep } from "node:path";
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  IndexState,
  SemanticTuning,
} from "../../shared/types";
import { POSES_MAX } from "../../shared/types";
export { POSES_MAX };
import { type Library, LibraryError } from "./library";
import { listDir, modelFormat } from "./listing";

/**
 * Client for the semantic index, a separate service started by hand. Only this
 * server talks to it (D1): the hit→tile join needs listing data from here.
 */
const DEFAULT_BASE = "http://127.0.0.1:8077";
const PROBE_TIMEOUT_MS = 2000;
const QUERY_TIMEOUT_MS = 30_000;

/**
 * Not `QUERY_TIMEOUT_MS`: a query is waited on, a pose rides behind a listing
 * already on screen. Upstream it is a cache lookup with no GPU, so an index that
 * has not answered within the probe's budget is not busy, it is not answering.
 */
const POSES_TIMEOUT_MS = 2000;

/** Past this, a load has plainly gone wrong: warming becomes wedged (D4). */
const WEDGED_AFTER_S = 180;

function baseUrl(): string | null {
  const raw = process.env.MODEL_BROWSER_INDEX;
  if (raw === undefined) return DEFAULT_BASE;
  return raw.trim() === "" ? null : raw.trim(); // cleared = feature off
}

/**
 * Each read from the wire rather than guessed (D4). `absent` is the only one
 * `/status` cannot report; `wedged` is `warming` gone on too long, apart so the
 * UI can stop implying that waiting will help.
 */
export type { IndexState };

/**
 * `res.json()` succeeding is not an answer arriving: `null` and a bare number are
 * valid JSON, and the next property read throws outside every `IndexError` catch.
 * Arrays answer `undefined` instead, which `probe` would report as `warming`.
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Arity is half the check: the client indexes these positionally. */
function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number")
  );
}

/**
 * The client orients a model by whatever it finds here, so one validator at the
 * boundary, wherever a pose enters: malformed is "no pose", never an error (D2).
 * An absent `front` is fine; a present one must be the shape it claims.
 */
export function isIndexPose(v: unknown): v is IndexPose {
  if (!isObject(v)) return false;
  if (!isVec3(v.up) || !isVec3(v.azimuth_zero)) return false;
  if (typeof v.source !== "string" || typeof v.confidence !== "number")
    return false;
  const front = v.front;
  if (front === null || front === undefined) return true;
  if (!isObject(front)) return false;
  return (
    typeof front.view === "number" &&
    typeof front.azimuth_deg === "number" &&
    typeof front.elevation_deg === "number"
  );
}

interface RawStatus {
  // Typed as the wire is: the index spells "not there" as JSON null, so every
  // field admits it and the compiler catches the next one forwarded raw.
  ready?: boolean | null;
  elapsed?: number | null;
  collection_root?: string | null;
  covers?: string[] | null;
  /** One shape for every reason a load did not complete — a dict, not a string. */
  failure?: { reason?: string; hint?: string | null; kind?: string } | null;
  volume?: {
    present?: boolean | null;
    root?: string | null;
    missing?: string | null;
  } | null;
}

let cached: { status: IndexAvailability; at: number } | null = null;

/** How long a state is trusted before re-probing (D4). */
const TTL_MS: Record<IndexState, number> = {
  ready: 30_000,
  warming: 2000,
  wedged: 30_000,
  "volume-gone": 10_000,
  absent: 10_000,
};

async function probe(base: string): Promise<IndexAvailability> {
  let parsed: unknown;
  try {
    const res = await fetch(`${base}/status`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { state: "absent" };
    parsed = await res.json();
  } catch {
    // Refused, unreachable, or too slow to be useful: nobody started it.
    return { state: "absent" };
  }
  // An index that answered something other than an object has not said what state
  // it is in, which is the same as not answering.
  if (!isObject(parsed)) return { state: "absent" };
  const raw = parsed as RawStatus;
  const common = {
    // A null crossing into `string | undefined` land passes every `=== undefined`
    // guard and reaches `libPathOf(null)`.
    collectionRoot: raw.collection_root ?? undefined,
    covers: raw.covers ?? undefined,
    elapsed: raw.elapsed ?? undefined,
    // The index's own words (D4), joined so a caller renders one string.
    detail:
      [raw.failure?.reason, raw.failure?.hint]
        .filter((t) => typeof t === "string")
        .join(" — ") || undefined,
  };
  // Volume before ready: an unplugged drive reports both, and checking `ready`
  // first calls the one failure a user fixes in seconds "starting up".
  if (raw.volume?.present === false) return { state: "volume-gone", ...common };
  if (raw.ready !== true) {
    // Any load error means it is not going to finish on its own.
    const wedged =
      (raw.elapsed ?? 0) > WEDGED_AFTER_S || (raw.failure ?? null) !== null;
    return { state: wedged ? "wedged" : "warming", ...common };
  }
  return { state: "ready", ...common };
}

/**
 * The cache is written only when a probe *resolves*, so a folder grid reading the
 * state once per tile would otherwise open a connection per tile. Cleared on
 * settle, so the TTL alone decides the next look.
 */
let inFlight: Promise<IndexAvailability> | null = null;

/**
 * Bumped by anything that invalidates a look already on the wire. Without it the
 * cache is written in *settle* order, so an older probe overwrites what a retry
 * just learned and a reset is refilled with the answer it forgot.
 */
let generation = 0;

/**
 * `at` is when the look was *decided on*, where the TTL is measured from. A
 * superseded answer is still returned to its awaiter, just not remembered.
 */
function look(base: string, at: number): Promise<IndexAvailability> {
  const born = generation;
  return probe(base).then((status) => {
    if (born === generation) cached = { status, at };
    return status;
  });
}

/**
 * `collectionRoot` still absolute: the path the index names is the one it must be
 * asked about (D6). Cached per state (D4), except the client's retry, whose point
 * is a look taken after the user asked.
 */
async function rawStatus(opts: {
  fresh?: boolean;
}): Promise<IndexAvailability> {
  const base = baseUrl();
  if (base === null) return { state: "absent" };
  const now = Date.now();
  if (opts.fresh === true) {
    // A new era: every look already on the wire was started before the user asked.
    generation++;
    return look(base, now);
  }
  if (cached !== null && now - cached.at < TTL_MS[cached.status.state]) {
    return cached.status;
  }
  if (inFlight !== null) return inFlight;
  const started = look(base, now);
  inFlight = started;
  // Identity-guarded: a reset mid-probe may already have replaced this memo.
  const clear = (): void => {
    if (inFlight === started) inFlight = null;
  };
  started.then(clear, clear);
  return started;
}

/** What the UI says when the index covers a tree this library does not hold. */
const OUTSIDE_LIBRARY = "the index covers a location outside the library";

/**
 * Mapped through the library, so the wire carries a path the user can navigate to
 * (D6); one outside it is absence with a reason. Per call rather than cached with
 * the probe, a library that becomes ready later needing a newer mapping.
 */
async function mapCollectionRoot(
  library: Library,
  raw: IndexAvailability,
): Promise<IndexAvailability> {
  const abs = raw.collectionRoot;
  if (abs === undefined) return raw;
  const { collectionRoot: _abs, ...rest } = raw;
  // Nothing to map through yet, and the library's own state says so already.
  if ((await library.state()).state !== "ready") return rest;
  const real = await realpath(abs).catch(() => abs);
  try {
    return { ...rest, collectionRoot: library.libPathOf(real) };
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err;
    return { ...rest, detail: OUTSIDE_LIBRARY };
  }
}

/** Both halves from one probe, so a route cannot pair two reads a TTL apart. */
export async function probeStatus(
  library: Library,
  opts: { fresh?: boolean } = {},
): Promise<{
  status: IndexAvailability;
  collectionRootFs: string | undefined;
}> {
  const raw = await rawStatus(opts);
  return {
    status: await mapCollectionRoot(library, raw),
    collectionRootFs: raw.collectionRoot,
  };
}

/**
 * What the memo holds, **never a probe of its own**: emission-time filling (§6.9)
 * must cost a listing nothing. A **state** gate, not a freshness one — a TTL here
 * would switch the feature off in a browse-only session, where nothing probes.
 */
export function memoisedStatus():
  | { status: IndexAvailability; collectionRootFs: string | undefined }
  | undefined {
  if (cached === null) return undefined;
  return {
    status: cached.status,
    collectionRootFs: cached.status.collectionRoot,
  };
}

/** Availability for the status route: the wire half of `probeStatus`. */
export async function indexStatus(
  library: Library,
  opts: { fresh?: boolean } = {},
): Promise<IndexAvailability> {
  return (await probeStatus(library, opts)).status;
}

/**
 * Forget what we know. The generation bump is what makes it stick: the probe the
 * memo referred to is still running and would write its pre-reset answer.
 * **`askIndex`'s call of this is the fill's wedge-limiter** (§6.9) — do not tidy
 * it out of `notAnswering` without moving that limit first.
 */
export function resetIndexStatus(): void {
  generation++;
  cached = null;
  inFlight = null;
}

export class IndexError extends Error {
  constructor(
    readonly state: IndexState,
    message: string,
    /** Carried only when the index was up and refused: its absence marks the rest. */
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }
}

/**
 * Library path in, real path out — the one place that translation happens (D6).
 * `null` rather than an error for a virtual path (D7) or one the library refuses:
 * out of scope withholds an affordance. Compared resolved, since remounts move
 * the mount point (D4).
 */
export async function scopeWithin(
  library: Library,
  libPath: string,
  collectionRoot: string,
): Promise<string | null> {
  return (await scopeDetail(library, libPath, collectionRoot)).real;
}

/**
 * The other direction. The index echoes the filesystem path it was handed, and
 * putting that on the wire would name the host to every viewer
 * (`feature-report`). `null` for anything with no library path (D2).
 */
export async function scopeLibPath(
  library: Library,
  path: unknown,
): Promise<string | null> {
  if (typeof path !== "string") return null;
  const real = await realpath(path).catch(() => path);
  try {
    return library.libPathOf(real);
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err;
    return null;
  }
}

/**
 * For the one caller that must tell the two apart (`posesAsked`, §6.9):
 * **`structural`** is settled, so a negative may be recorded, while
 * **`transient`** is this server failing to look and teaches nothing.
 */
type ScopeMiss = "structural" | "transient";

async function scopeDetail(
  library: Library,
  libPath: string,
  collectionRoot: string,
): Promise<{ real: string | null; miss?: ScopeMiss }> {
  if (libPath.includes("!/")) return { real: null, miss: "structural" };
  let fsPath: string;
  try {
    fsPath = (await library.resolve(libPath)).fsPath;
  } catch (err) {
    if (err instanceof LibraryError) return { real: null, miss: "transient" };
    throw err;
  }
  const [real, root] = await Promise.all([
    realpath(fsPath).catch(() => null),
    realpath(collectionRoot).catch(() => collectionRoot),
  ]);
  if (real === null) return { real: null, miss: "transient" };
  if (real !== root && !real.startsWith(`${root}/`))
    return { real: null, miss: "structural" };
  return { real };
}

export interface Hit {
  id: string;
  path: string;
  rel_path: string;
  name: string;
  score: number;
  z: number;
  /** `unknown` because it is another process's JSON; `isIndexPose` makes it a pose. */
  pose: unknown;
}

export interface Scope {
  path: string | null;
  status: "indexed" | "partial" | "unindexed";
  n_indexed: number;
  n_scanned: number;
  covers: string[];
}

export interface QueryResult {
  scope: Scope;
  weak: boolean;
  /** The index's own cap bit — it returned fewer than was asked for (D2). */
  truncated?: boolean;
  /** Optional: an older index does not send it (floor-and-count-compose D9). */
  matched?: number;
  results: Hit[];
}

/**
 * A floor under this server's own requests, not the UI's default: the index does
 * not default `top`, so a request naming no bound is bounded only by its cap.
 */
export const TOP = 60;

/** What shapes a query beyond the phrase and the scope — the wire shape. */
export type Tuning = SemanticTuning;

/**
 * Every way the index can fail to *say* something. One constructor because the
 * pairing is the contract: the status is forgotten alongside the error.
 */
function notAnswering(): IndexError {
  resetIndexStatus();
  return new IndexError("absent", "the semantic index is not answering");
}

/**
 * One copy of the error contract: `app.ts`'s mapping keys off `upstreamStatus`,
 * and two routes must not classify one status differently. The wait is the
 * caller's, being the one thing the routes do not share.
 */
async function askIndex(
  route: string,
  body: unknown,
  timeoutMs: number = QUERY_TIMEOUT_MS,
): Promise<unknown> {
  const base = baseUrl();
  if (base === null)
    throw new IndexError("absent", "semantic index is not configured");
  let res: Response;
  try {
    res = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // A timeout aborts the fetch, so it lands in the catch below with every
      // other way the index can fail to answer.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw notAnswering();
  }
  if (res.status === 503) {
    // Raced the probe while SigLIP loads — the warming state, not a failure.
    resetIndexStatus();
    throw new IndexError("warming", "the semantic index is still loading");
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      detail?: unknown;
    } | null;
    const message =
      typeof detail?.detail === "string"
        ? detail.detail
        : `index error ${res.status}`;
    // The index answered, so it is up: a refused request, not an unavailable
    // service, and its status travels with the error.
    throw new IndexError("ready", message, res.status);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    // A *second* `try`, the headers arriving not being the answer. Neither a
    // `SyntaxError` nor an `AbortError` is an `IndexError`, and escaping here one
    // would 500 a peek: an index that cannot finish is not answering.
    throw notAnswering();
  }
  // Parsing is not answering: literal `null` parses and then throws on the next
  // property read, outside every `IndexError` catch. Here rather than per caller,
  // so the routes cannot disagree about it.
  if (!isObject(parsed)) throw notAnswering();
  return parsed;
}

export async function query(
  text: string,
  scope: string | null,
  tuning: Tuning = {},
): Promise<QueryResult> {
  const raw = (await askIndex("/query", {
    text,
    path: scope ?? undefined,
    // Each forwarded on its own presence: the two compose upstream, and this app
    // reports which the user set rather than choosing between them.
    ...(tuning.minScore !== undefined ? { min_score: tuning.minScore } : {}),
    ...(tuning.top !== undefined ? { top: tuning.top } : {}),
    ...(tuning.minScore === undefined && tuning.top === undefined
      ? { top: TOP }
      : {}),
    ...(tuning.raw === true ? { raw: true } : {}),
    ...(tuning.pool !== undefined ? { pool: tuning.pool } : {}),
  })) as Partial<QueryResult>;
  // An object body is not yet this route's answer: a body missing either field
  // throws in the route handler, outside every `IndexError` catch. The fields
  // *inside* a present scope stay unchecked — they serialize oddly, not fatally.
  if (!Array.isArray(raw.results) || !isObject(raw.scope)) throw notAnswering();
  return raw as QueryResult;
}

/** No `weak` or `truncated`: the index publishes neither for neighbours (D4/4.7). */
export interface SimilarResult {
  results: Hit[];
}

/**
 * Nearest neighbours, with **no `scope` deliberately** (D4/4.1a): "more like this
 * one" is not a question about a place, and scoped to the model's folder it would
 * return the kit already on screen. A 404 is a fact about the model, not about
 * availability, and travels as an `IndexError` carrying that status.
 */
export async function similar(
  path: string,
  k?: number,
  pool?: Tuning["pool"],
): Promise<SimilarResult> {
  const raw = (await askIndex("/similar", {
    path,
    ...(k !== undefined ? { k } : {}),
    ...(pool !== undefined ? { pool } : {}),
  })) as Partial<SimilarResult>;
  // `query`'s reason: without it the throw happens in `hitsToEntries`.
  if (!Array.isArray(raw.results)) throw notAnswering();
  return raw as SimilarResult;
}

/**
 * From *this* server's stat, never the index's description of the file (D3).
 * Containment is the **caller's**: re-testing a prefix here would reject a
 * legitimate anchor under a symlinked collection root.
 */
export async function modelEntryAt(
  full: string,
  libPath: string,
  name: string,
): Promise<DirEntry | null> {
  // Format first: the client's `formatOfEntry` throws on a model entry it cannot
  // classify (file-frame-spindle D2), and an unclassifiable one could not be
  // thumbnailed or posed anyway.
  const format = modelFormat(full);
  if (format === undefined) return null;
  const s = await stat(full).catch(() => null);
  if (s === null || !s.isFile()) return null;
  return {
    name,
    path: libPath,
    kind: "model" as const,
    format,
    size: s.size,
    mtime: s.mtimeMs,
  };
}

/**
 * Hits to tiles, one `stat` and one `realpath` each, so a query's filesystem work
 * is bounded by the hits and never by the tree. Three maps keyed alike by
 * **library path**, so "no entry" and "no score" are one fact
 * (confidence-scores-on-tiles D1). The containment prefix is **normalised**: an
 * index started with a trailing slash would empty every answered search silently.
 */
export async function hitsToEntries(
  library: Library,
  hits: Hit[],
  collectionRoot: string,
): Promise<{
  entries: DirEntry[];
  poses: Record<string, IndexPose>;
  scores: Record<string, IndexScore>;
}> {
  const poses: Record<string, IndexPose> = {};
  const scores: Record<string, IndexScore> = {};
  const realTop = library.realTop();
  // The one spelling of the root everything below is measured against.
  const root = resolve(collectionRoot);
  let collectionLibPath: string;
  try {
    collectionLibPath = library.libPathOf(
      await realpath(root).catch(() => root),
    );
  } catch (err) {
    if (!(err instanceof LibraryError)) throw err;
    return { entries: [], poses, scores };
  }
  const settled = await Promise.all(
    hits.map(async (h): Promise<DirEntry | null> => {
      // The array was gated at the cast; its elements are still foreign JSON, and
      // one without a string `rel_path` has no join key.
      if (!isObject(h) || typeof h.rel_path !== "string") return null;
      // `resolve` normalising `..` is what stops a hit naming a file outside the
      // collection. The index's absolute `path` is ignored: trusting its mount
      // point would undo D4's remount reasoning.
      const full = resolve(root, h.rel_path);
      if (full !== root && !full.startsWith(root + sep)) return null;
      // Inside the collection is not yet inside the library: the index followed
      // symlinks when it embedded. Confined as every other route is (D3), so no
      // hit is scored on a surface where `/api/file` refuses the same path.
      const real = await realpath(full).catch(() => null);
      if (real === null) return null;
      if (real !== realTop && !real.startsWith(realTop + sep)) return null;
      // One hit, two addresses, from one string.
      const libPath = posix.join(collectionLibPath, h.rel_path);
      const entry = await modelEntryAt(full, libPath, h.rel_path);
      if (entry === null) return null;
      // Validated, not merely non-null: the pose rides straight to the client.
      if (isIndexPose(h.pose)) poses[libPath] = h.pose;
      scores[libPath] = { score: h.score, z: h.z };
      return entry;
    }),
  );
  return { entries: settled.filter((e) => e !== null), poses, scores };
}

/** `null` is the index's spelling for "holds the model, has no orientation". */
interface PosesAnswer {
  poses?: Record<string, unknown> | null;
}

/**
 * **Chunk by chunk, and partially tolerant**: rejecting as a whole would discard
 * what earlier chunks already answered, leaving every model un-posed rather than
 * one chunk's share. Throws **only when every chunk failed**.
 */
async function askPoses(
  paths: readonly string[],
): Promise<Record<string, IndexPose | null>> {
  const out: Record<string, IndexPose | null> = {};
  let chunks = 0;
  let failed = 0;
  let first: IndexError | null = null;
  for (let i = 0; i < paths.length; i += POSES_MAX) {
    chunks++;
    let answer: PosesAnswer;
    try {
      answer = (await askIndex(
        "/poses",
        { paths: paths.slice(i, i + POSES_MAX) },
        POSES_TIMEOUT_MS,
      )) as PosesAnswer;
    } catch (err) {
      if (!(err instanceof IndexError)) throw err;
      failed++;
      first ??= err;
      continue;
    }
    // Counted, not inferred from the output: an index with nothing to say also
    // contributes nothing, and must not read as "everything failed".
    for (const [path, pose] of Object.entries(answer.poses ?? {})) {
      out[path] = isIndexPose(pose) ? pose : null;
    }
  }
  if (chunks > 0 && failed === chunks && first !== null) throw first;
  return out;
}

/**
 * Orientations keyed by **library path** (D2), confined per path so one bad one
 * costs the others nothing. The join is real path → every library path that named
 * it, an aliased file being one file to the index. Every `IndexError` becomes an
 * empty answer: asking for poses may never fail a surface.
 */
export async function posesForPaths(
  library: Library,
  libPaths: readonly string[],
  collectionRoot: string,
): Promise<Record<string, IndexPose>> {
  return (await posesAsked(library, libPaths, collectionRoot)).poses;
}

/**
 * `posesForPaths`, plus **whether the index actually answered** (§6.9) — an empty
 * map conflates that with "it holds nothing", and the fill records the second as
 * a negative. True also when there was nothing to ask *and nothing went wrong
 * asking*, which is what `scopeDetail`'s two kinds are for.
 */
export async function posesAsked(
  library: Library,
  libPaths: readonly string[],
  collectionRoot: string,
): Promise<{ poses: Record<string, IndexPose>; answered: boolean }> {
  const poses: Record<string, IndexPose> = {};
  if (libPaths.length === 0) return { poses, answered: true };
  // Joined in the caller's order: the wire must not depend on which `realpath`
  // finished first.
  const reals = await Promise.all(
    libPaths.map((p) => scopeDetail(library, p, collectionRoot)),
  );
  const byReal = new Map<string, string[]>();
  let transient = 0;
  libPaths.forEach((libPath, i) => {
    const detail = reals[i];
    if (detail === undefined || detail.real === null) {
      if (detail?.miss === "transient") transient++;
      return;
    }
    const named = byReal.get(detail.real);
    if (named === undefined) byReal.set(detail.real, [libPath]);
    else named.push(libPath);
  });
  // An answer when every exclusion was structural, a non-answer otherwise.
  if (byReal.size === 0) return { poses, answered: transient === 0 };
  let answered: Record<string, IndexPose | null>;
  try {
    answered = await askPoses([...byReal.keys()]);
  } catch (err) {
    if (err instanceof IndexError) return { poses, answered: false };
    throw err;
  }
  for (const [real, named] of byReal) {
    const pose = answered[real];
    // Left out rather than set to null, or "has a pose" is two tests everywhere.
    if (pose === undefined || pose === null) continue;
    for (const libPath of named) poses[libPath] = pose;
  }
  return { poses, answered: true };
}

/**
 * What both pose routes answer on, the availability gate living here so the two
 * cannot disagree. Coverage is *not* tested here but per path, so one listing may
 * span folders the collection does and does not reach.
 */
export async function posesForListing(
  library: Library,
  libPaths: readonly string[],
  opts: { fresh?: boolean } = {},
): Promise<Record<string, IndexPose>> {
  return (await posesListingAsked(library, libPaths, opts)).poses;
}

/**
 * For the pose wave's route, which records a model the index did not name as a
 * negative: stamping those on an *unusable* index would silence poses for a whole
 * horizon, so one that is not `ready` answers `false` rather than `{}`.
 */
export async function posesListingAsked(
  library: Library,
  libPaths: readonly string[],
  opts: { fresh?: boolean } = {},
): Promise<{ poses: Record<string, IndexPose>; answered: boolean }> {
  const { status, collectionRootFs } = await probeStatus(library, opts);
  if (status.state !== "ready" || collectionRootFs === undefined) {
    return { poses: {}, answered: false };
  }
  return posesAsked(library, libPaths, collectionRootFs);
}

/**
 * Through `listDir`, so the models asked about are the ones on screen, and
 * **before** the index is consulted — a missing path must 404 either way.
 */
export async function posesForDir(
  library: Library,
  dirPath: string,
  opts: { fresh?: boolean } = {},
): Promise<Record<string, IndexPose>> {
  const listing = await listDir(library, dirPath);
  return posesForListing(
    library,
    listing.entries.filter((e) => e.kind === "model").map((e) => e.path),
    opts,
  );
}

/**
 * The most one `/under` answer may carry (D5) — far more than a sheet's cells,
 * the index answering in path order rather than posed first, so this is how deep
 * a posed model may sit and still be seen. Nothing pages: the alternative to a
 * truncated answer is the walk, whose budget is smaller.
 */
export const UNDER_LIMIT = 256;

/**
 * `/under` rides behind a folder tile as `/poses` does, so it takes that budget
 * rather than a second number to drift from it; the peek can always walk.
 */
const UNDER_TIMEOUT_MS = POSES_TIMEOUT_MS;

/** One indexed model under a prefix: the path the index walked, and whatever
 *  orientation it holds for it. */
export interface UnderModel {
  path: string;
  pose: IndexPose | null;
}

/**
 * Typed as the wire is, not as the contract reads: a missing field must narrow to
 * "the index said nothing useful" here rather than crash a peek later.
 */
interface RawUnder {
  status?: string | null;
  /** Even the list-ness is checked rather than declared: `models: 5` crashes `flatMap`. */
  models?: unknown;
  matched?: number | null;
  truncated?: boolean | null;
}

/**
 * The peek's alternative to walking (D5). `null` means **use the walk** — one
 * value for unindexed, unreachable and too slow alike — while an `"ok"` answer
 * holding no models is a real one. The path in is a **real filesystem path** (D6).
 */
export async function modelsUnder(
  dirRealPath: string,
  limit: number = UNDER_LIMIT,
): Promise<UnderModel[] | null> {
  let raw: RawUnder;
  try {
    raw = (await askIndex(
      "/under",
      { path: dirRealPath, limit },
      UNDER_TIMEOUT_MS,
    )) as RawUnder;
  } catch (err) {
    // A preview may never be made to fail by the index, and a walk answers here.
    if (err instanceof IndexError) return null;
    throw err;
  }
  // `unindexed`, and equally a status this server has never heard of.
  if (raw.status !== "ok") return null;
  // Not a list reads as an empty one: still a real answer, filled from the walk.
  const models: readonly unknown[] = Array.isArray(raw.models)
    ? raw.models
    : [];
  // A malformed pose still fills a cell, in the unposed half of the partition; a
  // malformed model does not, there being no cell without a path.
  return models.flatMap((m) =>
    isObject(m) && typeof m.path === "string"
      ? [{ path: m.path, pose: isIndexPose(m.pose) ? m.pose : null }]
      : [],
  );
}

/**
 * Index answers → contact-sheet cells, under `hitsToEntries`' rules with the
 * peeked directory standing where the collection root stands there.
 *
 * Confined on each candidate's **realpath**, never the spelling it arrived in: an
 * index invoked through a symlinked root answers for a tree this server calls
 * something else, and a lexical test would confine nothing in, silently making D5
 * the walk again. That one test is the whole confinement, on a premise — the
 * peeked directory being inside the library — checked up front.
 *
 * Ranked posed-first as a **stable partition**, so the sheet is a function of the
 * answer alone. **`poses` is its second half**, this being the only place that
 * can key it by library path; `null` there is a negative, not a gap.
 */
export async function entriesUnder(
  library: Library,
  models: readonly UnderModel[],
  dirReal: string,
  dirLibPath: string,
  n: number,
): Promise<{ entries: DirEntry[]; poses: Record<string, IndexPose | null> }> {
  const posed = models.filter((m) => m.pose !== null);
  const unposed = models.filter((m) => m.pose === null);
  const out: DirEntry[] = [];
  const poses: Record<string, IndexPose | null> = {};
  // Resolved once, so the test cannot depend on how the caller spelled it.
  const dirTop = await realpath(dirReal).catch(() => dirReal);
  // The premise the per-candidate test rests on, checked rather than assumed.
  const realTop = library.realTop();
  if (dirTop !== realTop && !dirTop.startsWith(realTop + sep))
    return { entries: out, poses };
  const seen = new Set<string>();
  for (const m of [...posed, ...unposed]) {
    if (out.length >= n) break;
    // `resolve` normalises `..`, as in `hitsToEntries`: this is foreign data.
    const full = resolve(m.path);
    // The realpath is the one spelling this server and the index can agree on, the
    // index having followed symlinks and reached the tree its own way. One that
    // leaves the peeked directory is a wrong answer, dropped (D3).
    const real = await realpath(full).catch(() => null);
    if (real === null) continue;
    if (!real.startsWith(dirTop + sep)) continue;
    // Off the *real* path, so an alias lands on the cell the walk would name.
    const rel = real.slice(dirTop.length + 1);
    const libPath = posix.join(dirLibPath, rel);
    if (seen.has(libPath)) continue;
    // `basename`, not `rel`: a sheet must not read half in names, half in paths.
    const entry = await modelEntryAt(real, libPath, basename(rel));
    if (entry === null) continue;
    seen.add(libPath);
    out.push(entry);
    // Against the cell, not the candidate: `libPath` is the key both sides use.
    poses[libPath] = m.pose;
  }
  return { entries: out, poses };
}
