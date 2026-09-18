import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve as resolvePath } from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import type {
  AppsReport,
  DirEntry,
  FeatureReport,
  IndexAvailability,
  IndexPose,
  LibraryState,
  LightingMode,
  ModelsListing,
  OrbitAxis,
  PosesResponse,
  Refused,
  ReloadResult,
  ThumbPutRefused,
  ThumbPutRequest,
} from "../../shared/types";
import { SEARCH_TEXT_MAX, THUMB_MIME } from "../../shared/types";
import { StaleWriteError, ThumbCache } from "./cache";
import { MeshCache } from "./meshCache";
import { GlbError, stlToGlb } from "../../shared/glb";
import { guard } from "./guard";
import {
  LaunchError,
  type Launcher,
  ZipTempStore,
  createLauncher,
} from "./launch";
import {
  LibraryError,
  type Library,
  canonicalLibPath,
  createLibrary,
} from "./library";
import {
  ListingError,
  PEEK_MAX_FINDS,
  type PeekOut,
  complete,
  listDir,
  modelFormat,
  peek,
} from "./listing";
import { ListingCache } from "./listingCache";
import {
  type OverrideHolder,
  type OverrideStore,
  applyDisplayNames,
  createOverrideHolder,
  listCredits,
  resolveOverrides,
} from "./overrides";
import {
  IndexError,
  POSES_MAX,
  UNDER_LIMIT,
  entriesUnder,
  hitsToEntries,
  indexStatus,
  memoisedStatus,
  modelEntryAt,
  modelsUnder,
  posesAsked,
  posesForDir,
  posesListingAsked,
  probeStatus,
  query as indexQuery,
  scopeLibPath,
  scopeWithin,
  similar as indexSimilar,
} from "./semantic";
import type { SnapshotStore } from "./snapshot";
import { VPathError } from "./vpath";
import { ZipError, type ZipDirCache, extractEntry } from "./zip";

const ORBIT_AXES: readonly OrbitAxis[] = ["x", "-x", "y", "-y", "z", "-z"];
/** The only lighting a write may carry; the other `LightingMode` is legacy. */
const PRODUCIBLE_LIGHTING: LightingMode = "camera";

/** Cells in a folder tile's contact sheet, and the most one may ever ask for (D4). */
const PEEK_DEFAULT = 4;
const PEEK_MAX = 8;

/**
 * How long a listing waits for a ready index before shipping without it (§6.9),
 * bounding the whole fill rather than each call.
 */
export const ANNOTATION_BUDGET_MS = 300;

const FILL_PREVIEW_CONCURRENCY = 4;

/**
 * The most preview derivations one listing may **start**: the budget cannot
 * un-queue what it did not wait for, and twelve is a first paint's worth (§6.9).
 */
export const FILL_PREVIEW_MAX = 12;

/**
 * How an `IndexError` reaches the client. No upstream status is availability —
 * 503 with the state, not a fault — and the message is the index's own free text,
 * which can name the host, so `hostDetails` withholds it but never the status.
 */
function indexErrorReply(
  err: IndexError,
  hostDetails: boolean,
): {
  body: { error: string; state?: string };
  status: 400 | 404 | 502 | 503;
} {
  if (err.upstreamStatus === undefined) {
    return {
      body: {
        error: hostDetails ? err.message : "index unavailable",
        state: err.state,
      },
      status: 503,
    };
  }
  const refused = hostDetails ? err.message : "the index refused the request";
  if (err.upstreamStatus === 404)
    return { body: { error: refused }, status: 404 };
  const bad = err.upstreamStatus >= 400 && err.upstreamStatus < 500;
  if (bad) return { body: { error: refused }, status: 400 };
  return {
    body: { error: hostDetails ? err.message : "the index failed" },
    status: 502,
  };
}

function archiveOf(vpath: string): string {
  const i = vpath.indexOf("!/");
  return i === -1 ? vpath : vpath.slice(0, i);
}

/**
 * A single byte range, in RFC 9110's three spellings, `end` inclusive. `null` is
 * *serve the whole file*: a malformed or multi-range header is answered, not
 * refused.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (header === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const [, from, to] = m;
  if (from === "" && to === "") return null;
  // No byte-range-spec is satisfiable against a zero-length representation (RFC
  // 9110 §14.1.1), and the suffix branch would hand `createReadStream` a
  // `{start: 0, end: -1}` it rejects outright.
  if (size === 0) return "unsatisfiable";
  if (from === "") {
    // `bytes=-0` names nothing.
    const n = Number(to);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return "unsatisfiable";
  if (to === "") return { start, end: size - 1 };
  const end = Number(to);
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}

/**
 * The walk's own answer, posed models first (`pose-for-every-model` D4).
 * Posedness cannot be known mid-walk, so the walk runs to `PEEK_MAX_FINDS` and
 * one `/poses` batch ranks the finds — one round trip, recorded via `Learned`.
 */
async function walkRanked(
  library: Library,
  libPath: string,
  collectionRootFs: string,
  /** Symmetry with `walkOnly`: no archive interior reaches here (D8). */
  zips?: ZipDirCache,
): Promise<{ entries: DirEntry[]; learned: Learned; stamp?: number }> {
  const out: PeekOut = {};
  const finds = await peek(library, libPath, PEEK_MAX_FINDS, zips, out);
  if (finds.length === 0)
    return {
      entries: finds,
      learned: NOTHING_LEARNED,
      stamp: out.archiveMtime,
    };
  const asked = finds.map((e) => e.path);
  const { poses, answered } = await posesAsked(
    library,
    asked,
    collectionRootFs,
  );
  const posed = finds.filter((e) => poses[e.path] !== undefined);
  // A stable partition, not a sort: both halves keep the walk's order.
  const unposed = finds.filter((e) => poses[e.path] === undefined);
  return {
    entries: [...posed, ...unposed],
    learned: { poses, asked: answered ? asked : [] },
    stamp: out.archiveMtime,
  };
}

/**
 * `asked` is empty when the index did not answer, which is not "the index has
 * nothing" (§6.9).
 */
interface Learned {
  poses: Record<string, IndexPose>;
  asked: readonly string[];
}

const NOTHING_LEARNED: Learned = { poses: {}, asked: [] };

function mergeLearned(a: Learned, b: Learned): Learned {
  if (a.asked.length === 0 && Object.keys(a.poses).length === 0) return b;
  if (b.asked.length === 0 && Object.keys(b.poses).length === 0) return a;
  return { poses: { ...a.poses, ...b.poses }, asked: [...a.asked, ...b.asked] };
}

/**
 * The models a contact sheet draws: the index's where it covers this folder, else
 * the walk's, whose entry budget one deep subtree can exhaust (D5). Both tests
 * precede any walk, so a silent index leaves the bare walk's first `n`.
 */
async function posedFirstPeek(
  library: Library,
  libPath: string,
  n: number,
  /**
   * The caller's already-resolved status: on a stale memo the `probeStatus` below
   * is a `/status` fetch on the browse path (§6.9).
   */
  resolved?: {
    status: IndexAvailability;
    collectionRootFs: string | undefined;
  },
  /** The archive layer, for an interior peek (`archive-interior-sheets` D3). */
  zips?: ZipDirCache,
): Promise<{
  entries: DirEntry[];
  collectionRootFs: string | undefined;
  learned: Learned;
  /** An archive interior's own mtime, for the layer to record (D9). */
  stamp?: number;
}> {
  const { status, collectionRootFs } = resolved ?? (await probeStatus(library));
  const walkOnly = async (): Promise<{
    entries: DirEntry[];
    collectionRootFs: string | undefined;
    learned: Learned;
    stamp?: number;
  }> => {
    const out: PeekOut = {};
    const entries = await peek(library, libPath, n, zips, out);
    return {
      entries,
      collectionRootFs,
      learned: NOTHING_LEARNED,
      stamp: out.archiveMtime,
    };
  };
  if (status.state !== "ready" || collectionRootFs === undefined)
    return walkOnly();
  // Asked about the folder rather than its finds; `null` is outside, refused or
  // virtual (D7).
  const dirReal = await scopeWithin(library, libPath, collectionRootFs);
  if (dirReal === null) return walkOnly();

  // `null` is "ask the walk"; an empty answer is a real one and fills the same way.
  const under = await modelsUnder(dirReal, UNDER_LIMIT);
  const answer =
    under === null
      ? null
      : await entriesUnder(library, under, dirReal, libPath, n);
  const fromIndex = answer?.entries ?? [];
  // `/under` named these models: the positives are poses, the rest negatives.
  const fromUnder: Learned =
    answer === null
      ? NOTHING_LEARNED
      : {
          poses: Object.fromEntries(
            Object.entries(answer.poses).filter(
              (e): e is [string, IndexPose] => e[1] !== null,
            ),
          ),
          asked: Object.keys(answer.poses),
        };
  if (fromIndex.length >= n)
    return { entries: fromIndex, collectionRootFs, learned: fromUnder };

  const sheet = [...fromIndex];
  const seen = new Set(sheet.map((e) => e.path));
  const walked = await walkRanked(library, libPath, collectionRootFs, zips);
  for (const entry of walked.entries) {
    if (sheet.length >= n) break;
    if (seen.has(entry.path)) continue;
    sheet.push(entry);
  }
  return {
    entries: sheet,
    collectionRootFs,
    learned: mergeLearned(fromUnder, walked.learned),
  };
}

/**
 * The maintained configuration and `createApp`'s default (public-deployment D4).
 * Not "everything on": `chatTab` is a placeholder, so all-on is nobody's posture.
 */
export const DEFAULT_FEATURES: FeatureReport = {
  thumbWrites: true,
  appLaunch: true,
  chatTab: false,
  hostDetails: true,
  maintenance: true,
  // Off like `chatTab`: a personal installation has no visitor to introduce (D1).
  intro: false,
};

/** A Buffer's exact bytes as a standalone ArrayBuffer — `.buffer` may be a
 *  shared pool slice, so copy the window `stlToGlb` should see. */
function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(
    b.byteOffset,
    b.byteOffset + b.byteLength,
  ) as ArrayBuffer;
}

export function createApp(
  cache: ThumbCache = new ThumbCache(),
  launcher: Launcher = createLauncher(),
  // Never emptied while the server runs; a launched app may be reading (L7).
  zipTemp: ZipTempStore = new ZipTempStore(),
  // The only translator from a request's path to a filesystem path (D3).
  library: Library = createLibrary(),
  // Per resolved library, not per process (library-overrides D1).
  overrides: OverrideHolder = createOverrideHolder(library),
  // What this server offers (feature-report D4). Read once: restart after editing.
  features: FeatureReport = DEFAULT_FEATURES,
  // The walked-tree cache (`listing-tree-cache` §4). Absent means walk per request.
  snapshots?: SnapshotStore,
  /**
   * Owns the per-(process, root) validation state and the derived layers (§6.1). A
   * parameter because startup revalidation must run on the instance that serves
   * (§6.5), or the first listing starts a duplicate pass behind it.
   */
  listings: ListingCache = new ListingCache(snapshots),
  /** The origins answered beside loopback (public-deployment D3). */
  origins: readonly string[] = [],
  /** The derived-GLB store (server-glb-cache D5). Shares the cache dir. */
  meshCache: MeshCache = new MeshCache(cache.dir, library),
): Hono {
  const app = new Hono();
  const layers = listings.layers;

  /**
   * Has the archive under this held sheet been rewritten (D9)? Against the recorded
   * stamp, never the cells: an empty interior records `[]`, which can never
   * disagree with its archive.
   */
  function staleInterior(dir: DirEntry): boolean {
    if (!dir.path.includes("!/")) return false;
    return layers.previewStamp(dir.path, PEEK_DEFAULT) !== dir.mtime;
  }

  /**
   * Attach what this server's caches already knew (§6.3): three Map gets and no
   * I/O, so a wedged index costs a listing nothing. Mutates in place, every entry
   * here being a fresh copy already.
   */
  function annotate(entries: DirEntry[]): void {
    for (const entry of entries) {
      const thumb = cache.annotate(entry.path, entry.mtime);
      if (thumb !== undefined) entry.thumb = thumb;
      if (entry.kind === "model") {
        // `!== undefined`, not a truth test: `null` is a recorded negative and rides
        // the wire as one, where an omitted field means "not derived" (§6.9).
        const pose = layers.poseFor(entry.path);
        if (pose !== undefined) entry.pose = pose;
      } else if (entry.kind === "dir") {
        const preview = layers.previewFor(entry.path, PEEK_DEFAULT);
        if (preview !== undefined && staleInterior(entry)) {
          layers.forgetPreview(entry.path, PEEK_DEFAULT);
        } else if (preview !== undefined) {
          // The cells are tiles too, or a revisit costs a lookup per cell the first peek
          // did not (`thumbnail-image-serving` D2). `previewFor` copies out.
          annotate(preview);
          entry.preview = preview;
        }
      }
    }
  }

  /**
   * Fill the layers with what this listing wants before `annotate` reads them
   * (§6.9), giving up after `ANNOTATION_BUDGET_MS`. The probe gate is read, never
   * taken, so an absent or wedged index costs a listing nothing (§6.1). Expiry
   * stops only what has not started. Single-flighted; failures swallowed.
   */
  const fills = new Map<string, Promise<void>>();

  async function fillAnnotations(
    key: string,
    entries: readonly DirEntry[],
  ): Promise<void> {
    const running = fills.get(key);
    if (running !== undefined) return running;
    const tracked: Promise<void> = fillOnce(entries).finally(() => {
      // Identity-guarded: a settling pass must not clear whatever replaced it.
      if (fills.get(key) === tracked) fills.delete(key);
    });
    fills.set(key, tracked);
    return tracked;
  }

  /**
   * What makes two requests the *same* listing — not the path alone, a flat listing
   * drawing different entries. `JSON.stringify`, `q` and `libPath` being text.
   */
  function fillKey(
    libPath: string,
    flat: boolean,
    q: string | undefined,
    folders: boolean,
  ): string {
    return JSON.stringify([flat, folders, q ?? "", libPath]);
  }

  async function fillOnce(entries: readonly DirEntry[]): Promise<void> {
    // Stops the *asking*: an inert layer would drop the answer on arrival.
    if (!layers.isLive) return;
    const memo = memoisedStatus();
    if (memo === undefined) return;
    const { status, collectionRootFs } = memo;
    if (status.state !== "ready" || collectionRootFs === undefined) return;

    // What the layers cannot answer *at all*, which is not `annotate`'s question: a
    // recorded negative is an answer and is not re-asked until its horizon passes.
    const unposed: string[] = [];
    const unchosen: string[] = [];
    for (const entry of entries) {
      if (entry.kind === "model") {
        if (!layers.poseKnown(entry.path)) unposed.push(entry.path);
      } else if (entry.kind === "dir") {
        // `PEEK_DEFAULT` alone: no listing reads a wider sheet. `undefined`, not
        // "empty": a folder derived to `[]` has been answered.
        if (layers.previewFor(entry.path, PEEK_DEFAULT) === undefined)
          unchosen.push(entry.path);
      }
    }
    if (unposed.length === 0 && unchosen.length === 0) return;

    // An object, not a captured boolean, so the queue workers see the write.
    const stop = { expired: false };
    const work = Promise.all([
      fillPoses(unposed, collectionRootFs),
      fillPreviews(unchosen, memo, stop),
    ]);
    // An unhandled rejection from a continuation nobody awaits kills the process.
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        stop.expired = true;
        resolve();
      }, ANNOTATION_BUDGET_MS);
      // A listing's budget is not a reason for the process to stay alive.
      timer.unref?.();
    });
    await Promise.race([
      settled.then(() => {
        if (timer !== undefined) clearTimeout(timer);
      }),
      budget,
    ]);
  }

  /**
   * Recording a root the index has since left would make `reroot` re-adopt it and
   * drop the fresh layer (§6.9).
   */
  function rootUnmoved(captured: string): boolean {
    const now = memoisedStatus()?.collectionRootFs;
    return now === undefined || now === captured;
  }

  /**
   * One `/poses` batch for what the layer cannot answer. Recorded whatever the
   * answer holds, empty included — that is the collection-root observation (§6.1) —
   * with the asked paths beside it. A failed ask records nothing at all.
   */
  async function fillPoses(
    paths: readonly string[],
    collectionRootFs: string,
  ): Promise<void> {
    if (paths.length === 0) return;
    try {
      const { poses, answered } = await posesAsked(
        library,
        paths,
        collectionRootFs,
      );
      if (!rootUnmoved(collectionRootFs)) return;
      layers.recordPoses(collectionRootFs, poses, answered ? paths : []);
    } catch {
      // The listing already shipped, or is about to. Nothing to report to.
    }
  }

  /**
   * A contact sheet for each folder on this listing that has none, by `/api/peek`'s
   * pipeline. Three bounds: concurrency, `FILL_PREVIEW_MAX` on how many ever start
   * (the budget cannot un-queue), and `stop.expired` to abandon the rest.
   */
  async function fillPreviews(
    dirs: readonly string[],
    resolved: {
      status: IndexAvailability;
      collectionRootFs: string | undefined;
    },
    stop: { expired: boolean },
  ): Promise<void> {
    if (dirs.length === 0) return;
    const wanted = dirs.slice(0, FILL_PREVIEW_MAX);
    let next = 0;
    const derive = async (): Promise<void> => {
      for (;;) {
        if (stop.expired) return;
        const i = next++;
        const dirPath = wanted[i];
        if (dirPath === undefined) return;
        try {
          // Handed down, or `posedFirstPeek` fetches `/status` on the browse path.
          const { entries, collectionRootFs, learned, stamp } =
            await posedFirstPeek(
              library,
              dirPath,
              PEEK_DEFAULT,
              resolved,
              snapshots?.archiveCache(),
            );
          if (collectionRootFs !== undefined && !rootUnmoved(collectionRootFs))
            return;
          layers.recordPreview(
            collectionRootFs,
            dirPath,
            PEEK_DEFAULT,
            entries,
            stamp,
          );
          layers.recordPoses(collectionRootFs, learned.poses, learned.asked);
        } catch {
          // A folder that cannot be peeked simply has no sheet.
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(FILL_PREVIEW_CONCURRENCY, wanted.length) },
        derive,
      ),
    );
  }

  /**
   * The root the layers record their identity against (§6.1, D7), from the probe
   * every semantic route memoises. Asked on an empty answer too: that is what a
   * repoint looks like from here.
   */
  async function collectionRoot(): Promise<string | undefined> {
    return (await probeStatus(library)).collectionRootFs;
  }

  /**
   * Every caller refuses on the handler's first line (D5), so a refused request
   * parses no body and resolves no path.
   */
  function refuse(c: Context, field: keyof FeatureReport): Response {
    const body: Refused = {
      error: "not offered by this deployment",
      refused: field,
    };
    return c.json(body, 403);
  }

  /**
   * The state as this deployment's viewer may read it (D11): locations go,
   * `ready.root` stays — a library path `bulk-thumbnail-jobs` scopes jobs on.
   */
  function viewerState(s: LibraryState): LibraryState {
    if (features.hostDetails) return s;
    if (s.state === "ready") {
      const { top: _top, ...rest } = s;
      return rest;
    }
    if (s.state === "missing") {
      const { root: _root, ...rest } = s;
      return rest;
    }
    if (s.state === "nested") {
      const { root: _root, library: _library, ...rest } = s;
      return rest;
    }
    return s;
  }

  /**
   * `detail` is the index's own free text and can name the host (D9). Withheld
   * here rather than in the client, which would leave `curl` returning it.
   */
  function viewerIndexStatus(s: IndexAvailability): IndexAvailability {
    if (features.hostDetails) return s;
    const { detail: _detail, ...rest } = s;
    return rest;
  }

  /**
   * A message this server did not compose, bound for a viewer who may not be told
   * about the host (D9/D11). Any of them may name a path on the operator's machine,
   * so the choice is made once here; the log keeps the real one.
   */
  function viewerError(c: Context, message: string, generic: string): string {
    if (features.hostDetails) return message;
    console.error(`${c.req.path}: ${message}`);
    return generic;
  }

  function indexError(c: Context, err: IndexError): Response {
    const { body, status } = indexErrorReply(err, features.hostDetails);
    return c.json(
      { ...body, error: viewerError(c, err.message, body.error) },
      status,
    );
  }

  app.use("/api/*", guard(origins));

  /**
   * The answer every path route gives while the library is not ready (D4): 503 with
   * a state envelope. Re-asked per request, so a volume mounted later needs no
   * restart.
   */
  const UNGATED = new Set([
    "/api/library",
    "/api/apps",
    "/api/features",
    "/api/semantic/status",
  ]);
  app.use("/api/*", async (c, next) => {
    if (UNGATED.has(c.req.path)) return next();
    // Through `/api/library`'s own withholding, so the two cannot disagree (D11).
    const s = viewerState(await library.state());
    if (s.state === "ready") return next();
    if (s.state === "missing") {
      return c.json(
        s.root === undefined
          ? { error: "the library is not present", state: s.state }
          : {
              error: `the library at ${s.root} is not present`,
              state: s.state,
              root: s.root,
            },
        503,
      );
    }
    if (s.state === "nested") {
      // Both paths named, the remedy being to point the root at the second (R1).
      return c.json(
        s.root === undefined || s.library === undefined
          ? { error: "the root contains a library", state: s.state }
          : {
              error: `the root ${s.root} contains a library at ${s.library}`,
              state: s.state,
              root: s.root,
              library: s.library,
            },
        503,
      );
    }
    if (s.state === "unconfigured") {
      return c.json(
        { error: "no library root is configured", state: s.state },
        503,
      );
    }
    return unreachable(s);
  });

  /** The library's state, withheld through `viewerState` (D11). */
  app.get("/api/library", async (c) =>
    c.json(viewerState(await library.state())),
  );

  /**
   * The typed branches are this codebase's own words and are unchanged by
   * `hostDetails`; the fall-through may be a host path, hence `viewerError`.
   */
  app.onError((err, c) => {
    // No route here has a cacheable error, and a 404 with no directive is
    // heuristically cacheable (RFC 9111 §4.2.2) — the hole the byte routes cannot
    // close themselves, since most of their failures never reach handler code.
    c.header("cache-control", "no-store");
    if (err instanceof LibraryError)
      return c.json({ error: err.message }, err.status);
    if (err instanceof ListingError)
      return c.json({ error: err.message }, err.status === 404 ? 404 : 400);
    if (err instanceof VPathError) return c.json({ error: err.message }, 400);
    if (err instanceof ZipError) return c.json({ error: err.message }, 422);
    return c.json(
      { error: viewerError(c, err.message, "internal error") },
      500,
    );
  });

  app.get("/api/dir", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400);
    const flat = c.req.query("flat") === "true";
    const q = c.req.query("q");
    const blankQ = q === undefined || q.trim() === "";
    if (!blankQ && !flat) return c.json({ error: "q requires flat=true" }, 400);
    // Additive and default-on: absent means the shipped predicate.
    const folderMatching = c.req.query("folders") !== "false";
    // Canonicalised once: a listing's `path` is what the client asks for next.
    const libPath = canonicalLibPath(path);
    // Names ride the listing rather than a lookup per tile (library-overrides D7).
    if (flat) {
      const listing = await listings.list(library, libPath, q, {
        folderMatching,
      });
      // Fill first, annotate second (§6.9).
      await fillAnnotations(
        fillKey(libPath, true, q, folderMatching),
        listing.entries,
      );
      // Annotate first: it attaches preview cells the naming pass must also reach.
      annotate(listing.entries);
      applyDisplayNames(listing.entries, await overrides.store());
      return c.json(listing);
    }
    const listing = await listDir(library, libPath, snapshots?.archiveCache());
    await fillAnnotations(
      fillKey(libPath, false, undefined, folderMatching),
      listing.entries,
    );
    annotate(listing.entries);
    applyDisplayNames(listing.entries, await overrides.store());
    return c.json(listing);
  });

  /**
   * Every model beneath a library path (§6.7) — a bulk job's scope
   * (`bulk-thumbnail-jobs` D8). No `MODEL_BROWSER_FLAT_CAP`: a scope cut to a cap
   * is a different scope, silently. Waits for revalidation where `/api/dir` does
   * not, a work list having no staleness marker to notice it by.
   */
  app.get("/api/models", async (c) => {
    // A maintenance route, refused on the first line like every other (D5).
    if (!features.maintenance) return refuse(c, "maintenance");
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400);
    const libPath = canonicalLibPath(path);
    const { models, complete } = await listings.enumerate(library, libPath);
    applyDisplayNames(models, await overrides.store());
    annotate(models);
    const body: ModelsListing = { path: libPath, entries: models, complete };
    return c.json(body);
  });

  /**
   * Run the incremental pass now for every cached root (§6.6, D9). `reload`, not
   * `revalidate`: joining a pass that began before the user's edit would report
   * "nothing moved" about a library that had. The layers go wholesale, having no
   * identity the server can check (D7). Sequential, to keep passes off one head.
   */
  app.post("/api/reload", async (c) => {
    // Refused before `dropAll`, so a refused reload drops nothing (D4).
    if (!features.maintenance) return refuse(c, "maintenance");
    layers.dropAll();
    const roots = snapshots === undefined ? [] : await snapshots.roots();
    let changed = false;
    for (const root of roots) {
      if (await listings.reload(library, root)) changed = true;
    }
    const body: ReloadResult = { ok: true, roots: roots.length, changed };
    return c.json(body);
  });

  /**
   * One entry's effective overrides, merged over its ancestor keys (D3). Per viewed
   * entry, not folded into `/api/dir`, which would resolve every field per tile.
   */
  app.get("/api/overrides", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400);
    const libPath = canonicalLibPath(path);
    await library.resolve(libPath);
    return c.json(resolveOverrides(await overrides.store(), libPath));
  });

  /**
   * The whole corpus's attribution, for the About page (`landing-page` D8). **No
   * capability gate**: attribution is a licence term, and `intro` gates the About
   * document rather than any `/api` route (D1). Tagged over the answer's bytes, so
   * a restart that re-reads the same file keeps a visitor's cache.
   */
  let creditsAnswer:
    | { store: OverrideStore; json: string; etag: string }
    | undefined;

  app.get("/api/credits", async (c) => {
    await library.resolve("/");
    const store = await overrides.store();
    // Once per resolved store; the holder's Map changes only with the library's id.
    if (creditsAnswer?.store !== store) {
      const json = JSON.stringify(listCredits(store));
      const digest = createHash("sha256").update(json).digest("hex");
      creditsAnswer = { store, json, etag: `"${digest.slice(0, 32)}"` };
    }
    c.header("Cache-Control", "no-cache");
    c.header("ETag", creditsAnswer.etag);
    if (c.req.header("if-none-match") === creditsAnswer.etag)
      return c.body(null, 304);
    // The held string, not `c.json`: the tag must be over these exact bytes.
    c.header("Content-Type", "application/json");
    return c.body(creditsAnswer.json);
  });

  /**
   * The models a folder tile draws (D1), per tile as it comes on screen — not a
   * field on every `DirEntry`, which would peek for folders never scrolled to.
   */
  app.get("/api/peek", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400);
    const raw = c.req.query("n");
    let n = PEEK_DEFAULT;
    if (raw !== undefined) {
      const asked = Number(raw);
      if (!Number.isInteger(asked) || asked < 1)
        return c.json({ error: `invalid n: ${raw}` }, 400);
      // Capped rather than refused: the ceiling is this server's own opinion.
      n = Math.min(asked, PEEK_MAX);
    }
    const libPath = canonicalLibPath(path);
    // `learned` is dropped here and recorded by `fillPreviews` instead: this answer
    // is pinned against the bare walk's when the index is unindexed (D5).
    const { entries, collectionRootFs, stamp } = await posedFirstPeek(
      library,
      libPath,
      n,
      undefined,
      snapshots?.archiveCache(),
    );
    // Before the naming pass: the choice is the models and their order.
    layers.recordPreview(collectionRootFs, libPath, n, entries, stamp);
    applyDisplayNames(entries, await overrides.store());
    annotate(entries);
    return c.json(entries);
  });

  app.get("/api/file", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400, NO_STORE);
    // Canonicalised like every sibling route; the spelling reaches only the 404.
    const libPath = canonicalLibPath(path);
    const { fsPath, entry } = await library.resolve(libPath);

    // octet-stream + nosniff make ORB dependably block no-cors embeds, which
    // carry no Origin and so pass the guard's origin check.
    const headers = {
      "content-type": "application/octet-stream",
      "x-content-type-options": "nosniff",
    };
    if (entry !== undefined) {
      if (/\.zip$/i.test(entry))
        return c.json({ error: "nested zips are unsupported" }, 400, NO_STORE);
      // The version is the archive's and is read *before* the bytes, so a rewrite
      // between the two can only under-claim (D5). A failed stat is version
      // unknown, never a 404 — that status stays `extractEntry`'s below.
      const archive = await stat(fsPath).catch(() => null);
      const tiers = byteTiers(c, archive?.mtimeMs ?? null, archive?.size ?? 0);
      // Before the extract: a 304 must not decompress a body it discards.
      if (tiers.notModified) return c.body(null, 304, tiers.headers);
      let bytes;
      try {
        bytes = await extractEntry(fsPath, entry);
      } catch (err) {
        // Untyped, it escapes as the host path the `open` failed on.
        if (err instanceof ZipError) throw err;
        throw new ListingError(404, `cannot read zip: ${archiveOf(libPath)}`);
      }
      return c.body(new Uint8Array(bytes), 200, {
        ...headers,
        ...tiers.headers,
      });
    }
    // Model formats only, by the predicate a listing decides with, and answered as
    // missing rather than refused: a distinct status would confirm it exists.
    if (modelFormat(libPath) === undefined) {
      return c.json({ error: `no such file: ${libPath}` }, 404, NO_STORE);
    }
    const s = await stat(fsPath).catch(() => null);
    if (s === null || !s.isFile())
      return c.json({ error: `no such file: ${libPath}` }, 404, NO_STORE);
    // Decided before the range is parsed: a not-modified check outranks `Range`
    // (RFC 9110 §13.2.2). Deciding costs nothing because it declares nothing (D8).
    const tiers = byteTiers(c, s.mtimeMs, s.size);
    if (tiers.notModified) return c.body(null, 304, tiers.headers);
    // The zip branch has the entry in memory already and ignores `Range`.
    const ranged = { ...headers, "accept-ranges": "bytes" };
    // A resumption conditioned on a tag the source no longer has gets the whole
    // representation, or the client stitches new bytes onto a stale prefix
    // (RFC 9110 §13.1.5). An `if-range` with no `range` is ignored either way.
    const staleIfRange =
      c.req.header("if-range") !== undefined &&
      c.req.header("if-range") !== tiers.etag;
    const range = staleIfRange
      ? null
      : parseRange(c.req.header("range"), s.size);
    if (range === "unsatisfiable") {
      // An answer about the source's current size, not about its bytes, and a
      // source can grow — so it is never stored and never validated (D6).
      return c.body(null, 416, {
        ...ranged,
        "content-range": `bytes */${s.size}`,
        ...NO_STORE,
      });
    }
    if (range !== null) {
      const { start, end } = range;
      const part = Readable.toWeb(
        createReadStream(fsPath, { start, end }),
      ) as ReadableStream;
      return c.body(part, 206, {
        ...ranged,
        ...tiers.headers,
        "content-range": `bytes ${start}-${end}/${s.size}`,
        "content-length": String(end - start + 1),
      });
    }
    const stream = Readable.toWeb(createReadStream(fsPath)) as ReadableStream;
    return c.body(stream, 200, {
      ...ranged,
      ...tiers.headers,
      "content-length": String(s.size),
    });
  });

  // An STL model's geometry as an indexed, position-only GLB, converted on
  // demand and cached per library (server-glb-cache). STL only — the client
  // requests this for `stl` and keeps `/api/file` for `obj`/`3mf`.
  let meshCacheWarned = false;
  app.get("/api/model.glb", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400, NO_STORE);
    const libPath = canonicalLibPath(path);
    const { fsPath, entry } = await library.resolve(libPath);
    const headers = {
      "content-type": "application/octet-stream",
      "x-content-type-options": "nosniff",
    };
    // Answered as missing rather than refused, exactly as `/api/file` is.
    if (modelFormat(libPath) !== "stl")
      return c.json({ error: `no such file: ${libPath}` }, 404, NO_STORE);

    // Staleness is the source's mtime — the archive's for a zip entry, whose
    // own mtime moves whenever an entry does.
    const s = await stat(fsPath).catch(() => null);
    if (s === null || !s.isFile())
      return c.json({ error: `no such file: ${libPath}` }, 404, NO_STORE);
    const mtime = s.mtimeMs;

    // The source STL's version, which is exactly what its GLB is keyed by, and read
    // ahead of the conversion so a revalidation never reconverts (D9).
    const tiers = byteTiers(c, mtime, s.size);
    if (tiers.notModified) return c.body(null, 304, tiers.headers);

    const cached = await meshCache.read(libPath, mtime);
    if (cached !== null)
      return c.body(new Uint8Array(cached), 200, {
        ...headers,
        ...tiers.headers,
      });

    let stl: ArrayBuffer;
    if (entry !== undefined) {
      let bytes;
      try {
        bytes = await extractEntry(fsPath, entry);
      } catch (err) {
        if (err instanceof ZipError) throw err;
        throw new ListingError(404, `cannot read zip: ${archiveOf(libPath)}`);
      }
      stl = toArrayBuffer(bytes);
    } else {
      stl = toArrayBuffer(await readFile(fsPath));
    }

    let glb: ArrayBuffer;
    try {
      glb = stlToGlb(stl);
    } catch (err) {
      // The tier is already decided above, and a failure must not hand out its tag (D8).
      if (err instanceof GlbError)
        return c.json({ error: err.message }, 422, NO_STORE);
      throw err;
    }
    // A read-only cache dir must not fail the request: serve without
    // persisting — but say so once, or every open silently reconverts.
    await meshCache.write(libPath, glb, mtime).catch((err: unknown) => {
      if (meshCacheWarned) return;
      meshCacheWarned = true;
      console.warn(
        `mesh cache not persisted (${String(err)}); converting per request`,
      );
    });
    return c.body(new Uint8Array(glb), 200, { ...headers, ...tiers.headers });
  });

  /**
   * Both launch endpoints' path pipeline: validated as `/api/file` validates, and
   * **always absolute** — a relative path resolves against the app's cwd (L5/L7).
   */
  type Resolved =
    | { ok: true; file: string }
    | { ok: false; body: { error: string }; status: 400 | 404 };

  async function resolveEntryFile(raw: string): Promise<Resolved> {
    // One spelling before the temp file is named: `fileFor` keys on this string.
    const path = canonicalLibPath(raw);
    const { fsPath, entry } = await library.resolve(path);
    if (entry !== undefined && /\.zip$/i.test(entry)) {
      return {
        ok: false,
        body: { error: "nested zips are unsupported" },
        status: 400,
      };
    }
    // `/api/file`'s model-format rule; loose files only, as there.
    if (entry === undefined && modelFormat(path) === undefined) {
      return {
        ok: false,
        body: { error: `no such file: ${path}` },
        status: 404,
      };
    }
    const s = await stat(fsPath).catch(() => null);
    if (s === null || !s.isFile()) {
      return {
        ok: false,
        body: { error: `no such file: ${path}` },
        status: 404,
      };
    }
    if (entry !== undefined) {
      try {
        return { ok: true, file: await zipTemp.fileFor(path, fsPath, entry) };
      } catch (err) {
        // Narrowed to failures on the **archive itself**: an unwritable tmpdir is the
        // server's own problem, not a library entry that could not be read.
        if (err instanceof ZipError) throw err;
        if ((err as NodeJS.ErrnoException | null)?.path === fsPath) {
          throw new ListingError(404, `cannot read zip: ${archiveOf(path)}`);
        }
        throw err;
      }
    }
    return { ok: true, file: resolvePath(fsPath) };
  }

  /** Read fresh: the chooser can rewrite the registry mid-session (L5). */
  app.get("/api/apps", async (c) => {
    // Before `report()`, not a filter over it (D5): it execs `xdg-mime` and reads
    // the machine's application entries. An empty report is a 200 — this is advisory.
    if (!features.appLaunch) {
      const empty: AppsReport = { chooser: false, types: {} };
      return c.json(empty);
    }
    return c.json(await launcher.report());
  });

  /**
   * What this server accepts and offers (feature-report D2). Its own route: that
   * answer is per-request state, this per-process configuration. Ungated, the
   * client needing it before there is a library.
   */
  app.get("/api/features", (c) => c.json(features));

  /**
   * The client sends an application id, never a command. Success means the launch
   * command succeeded and no more — `wine start` exits 0 once it hands off (L8).
   */
  app.post("/api/open", async (c) => {
    // First, before the body is read: a refused launch spawns nothing (D5).
    if (!features.appLaunch) return refuse(c, "appLaunch");
    const body = (await c.req.json().catch(() => null)) as {
      path?: unknown;
      appId?: unknown;
    } | null;
    const path = body?.path;
    if (typeof path !== "string" || path.trim() === "") {
      return c.json({ error: "path is required" }, 400);
    }
    const appId = body?.appId;
    if (typeof appId !== "string" || appId.trim() === "") {
      return c.json({ error: "appId is required" }, 400);
    }
    const target = await resolveEntryFile(path);
    if (!target.ok) return c.json(target.body, target.status);
    try {
      await launcher.launch(appId, target.file);
    } catch (err) {
      // The command's own account of its failure, so `viewerError`'s rule applies.
      if (err instanceof LaunchError) {
        return c.json(
          { error: viewerError(c, err.message, "the launch failed") },
          502,
        );
      }
      throw err;
    }
    return c.json({ ok: true });
  });

  /**
   * Unconfigured is **unavailable, not a failed launch**, and spawns nothing. No
   * timeout: a dismissed chooser and a killed one must not read the same (L9).
   */
  app.post("/api/open-with", async (c) => {
    // Before the body, and before `chooserConfigured` is consulted (D5).
    if (!features.appLaunch) return refuse(c, "appLaunch");
    const body = (await c.req.json().catch(() => null)) as {
      path?: unknown;
    } | null;
    const path = body?.path;
    if (typeof path !== "string" || path.trim() === "") {
      return c.json({ error: "path is required" }, 400);
    }
    if (!launcher.chooserConfigured) {
      return c.json(
        { error: "no chooser is configured", unavailable: true },
        503,
      );
    }
    const target = await resolveEntryFile(path);
    if (!target.ok) return c.json(target.body, target.status);
    try {
      await launcher.chooser(target.file);
    } catch (err) {
      if (err instanceof LaunchError) {
        return c.json(
          { error: viewerError(c, err.message, "the launch failed") },
          502,
        );
      }
      throw err;
    }
    return c.json({ ok: true });
  });

  /** Cached per state; `fresh=true` is the explicit retry (D4). */
  app.get("/api/semantic/status", async (c) => {
    const s = await indexStatus(library, {
      fresh: c.req.query("fresh") === "true",
    });
    return c.json(viewerIndexStatus(s));
  });

  /**
   * The index's orientations for one directory's models (D2). A **path** route,
   * gated like `/api/dir`; only the *index's* absence is silent, answering `{}`.
   */
  app.get("/api/semantic/poses", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "")
      return c.json({ error: "path is required" }, 400);
    const libPath = canonicalLibPath(path);
    const poses = await posesForDir(library, libPath);
    // **No asked-list, unlike the POST beside it**: the question is a directory,
    // enumerated inside `posesForDir`, so there is no list to stamp negatives
    // against — and the client's wave lands on the POST, not here.
    layers.recordPoses(await collectionRoot(), poses);
    const body: PosesResponse = { poses };
    return c.json(body);
  });

  /**
   * The same supply for a listing that is not one directory's contents. `POSES_MAX`
   * is the index's own bound on one call, not on what this server may assemble.
   * **Every per-path refusal means dropped**, which is why canonicalisation is a
   * loop: one bad tile must not cost a listing its poses.
   */
  app.post("/api/semantic/poses", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      paths?: unknown;
    } | null;
    const given = body?.paths;
    if (!Array.isArray(given))
      return c.json({ error: "paths is required" }, 400);
    const raw: readonly unknown[] = given;
    // One stray value is a bug the answer should name, not a pose to look up.
    const paths = raw.filter((p): p is string => typeof p === "string");
    if (paths.length !== raw.length)
      return c.json({ error: "paths is required" }, 400);
    if (paths.length > POSES_MAX) {
      return c.json(
        { error: `invalid paths: ${paths.length} (max ${POSES_MAX})` },
        400,
      );
    }
    const canonical: string[] = [];
    for (const p of paths) {
      try {
        canonical.push(canonicalLibPath(p));
      } catch (err) {
        // The two ways a string can fail to be a library path; anything else is a fault.
        if (!(err instanceof LibraryError) && !(err instanceof VPathError))
          throw err;
      }
    }
    const { poses, answered } = await posesListingAsked(library, canonical);
    // The asked-list closes the negative loop (§6.9): the client's wave lands here,
    // so "asked, none" reaches the next listing as `pose: null`. `answered` gates
    // it — an index that is down answers `{}` too.
    layers.recordPoses(
      await collectionRoot(),
      poses,
      answered ? canonical : [],
    );
    // Negatives ride the answer too (`pose-rerender` D5), but not while the index is
    // warming or the memo is cold: a warm-up must not redraw a folder at the default
    // and again posed.
    const memo = memoisedStatus()?.status.state;
    const settled =
      answered ||
      memo === "absent" ||
      memo === "wedged" ||
      memo === "volume-gone";
    const filed: Record<string, IndexPose | null> = { ...poses };
    if (settled) for (const p of canonical) filed[p] ??= null;
    const answer: PosesResponse = { poses: filed };
    return c.json(answer);
  });

  /**
   * Not folded into `/api/dir`: another corpus, and an index that is not running is
   * a state this app reports rather than an error it raises (D1).
   */
  app.post("/api/semantic", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      text?: string;
      path?: string;
      raw?: boolean;
      pool?: "mean" | "max" | "softmax";
      top?: number;
      minScore?: number;
    } | null;
    const text = body?.text;
    if (typeof text !== "string" || text.trim() === "") {
      return c.json({ error: "text is required" }, 400);
    }
    // A coarse guard; the index's own limit is a token budget, not characters.
    if (text.length > SEARCH_TEXT_MAX)
      return c.json({ error: "text is too long" }, 400);
    // The gate is the *index's* root: a collection the library does not hold covers
    // nothing here, and every scope then fails containment on its own (D6).
    const { status, collectionRootFs } = await probeStatus(library);
    if (status.state !== "ready" || collectionRootFs === undefined) {
      // A state the UI renders, not a fault.
      return c.json(
        // `detail` withheld as `/api/semantic/status` withholds it (D9).
        {
          error: "index unavailable",
          state: status.state,
          detail: viewerIndexStatus(status).detail,
        },
        503,
      );
    }
    // Virtual paths never leave this server (D7).
    const scope =
      body?.path === undefined || body.path === ""
        ? null
        : await scopeWithin(library, body.path, collectionRootFs);
    if (body?.path !== undefined && body.path !== "" && scope === null) {
      return c.json({ error: "path is outside the indexed collection" }, 400);
    }
    let result;
    try {
      result = await indexQuery(text, scope, {
        raw: body?.raw,
        pool: body?.pool,
        top: body?.top,
        minScore: body?.minScore,
      });
    } catch (err) {
      if (err instanceof IndexError) return indexError(c, err);
      throw err;
    }
    const { entries, poses, scores } = await hitsToEntries(
      library,
      result.results,
      collectionRootFs,
    );
    annotate(entries);
    const scopePath = await scopeLibPath(library, result.scope.path);
    return c.json({
      // A library path like every other (D2): the scope's, else the collection's.
      path:
        scope !== null
          ? library.libPathOf(scope)
          : (status.collectionRoot ?? "/"),
      entries,
      poses,
      scores,
      weak: result.weak,
      // The index's ceiling, not the ranking's horizon (D2).
      capped: result.truncated === true,
      // Additive both ways: an older index leaves it absent (D9).
      ...(result.matched !== undefined ? { matched: result.matched } : {}),
      scope: {
        // Never the index's own string: the real path this route handed it, echoed back.
        path: scopePath,
        status: result.scope.status,
        indexed: result.scope.n_indexed,
        scanned: result.scope.n_scanned,
        covers: result.scope.covers,
      },
    });
  });

  /**
   * **No scope is sent** (D4): neighbours come from the whole collection. The path
   * is still resolved through `scopeWithin`, a virtual path never leaving this
   * server (D7) — which keeps the 404 below meaning one thing.
   */
  app.post("/api/semantic/similar", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      path?: string;
      k?: number;
      pool?: string;
    } | null;
    const path = body?.path;
    if (typeof path !== "string" || path.trim() === "") {
      return c.json({ error: "path is required" }, 400);
    }
    // Validated, not defaulted: absent leaves the index's own (D4).
    const k = body?.k;
    if (k !== undefined && (!Number.isInteger(k) || k < 1 || k > 1000)) {
      return c.json({ error: `invalid k: ${String(k)}` }, 400);
    }
    // The same for pooling: only the three the index names are forwarded.
    const pool = body?.pool;
    if (
      pool !== undefined &&
      pool !== "mean" &&
      pool !== "max" &&
      pool !== "softmax"
    ) {
      return c.json({ error: `invalid pool: ${String(pool)}` }, 400);
    }
    const { status, collectionRootFs } = await probeStatus(library);
    if (status.state !== "ready" || collectionRootFs === undefined) {
      return c.json(
        {
          error: "index unavailable",
          state: status.state,
          detail: viewerIndexStatus(status).detail,
        },
        503,
      );
    }
    const model = await scopeWithin(library, path, collectionRootFs);
    if (model === null) {
      return c.json({ error: "path is outside the indexed collection" }, 400);
    }
    let result;
    try {
      result = await indexSimilar(model, k, pool);
    } catch (err) {
      if (err instanceof IndexError) return indexError(c, err);
      throw err;
    }
    // This server's own view of the tree, never the index's description (D3).
    const { entries, poses, scores } = await hitsToEntries(
      library,
      result.results,
      collectionRootFs,
    );
    annotate(entries);
    // The index excludes the query model from its own ranking, so this is the only
    // place the question can appear beside its answer. Its own field, never in
    // `entries`, or a client would count a model with no neighbours as having one.
    const anchor = await modelEntryAt(
      model,
      library.libPathOf(model),
      relative(collectionRootFs, model),
    );
    if (anchor !== null) annotate([anchor]);
    // Without the index's `scope` dict: its residue is about a *phrase's* result.
    return c.json({
      // The collection as a library path (D2), the library root where it has none.
      path: status.collectionRoot ?? "/",
      entries,
      poses,
      // The anchor is absent: the index scores no hit for the query model (D1).
      scores,
      ...(anchor !== null ? { anchor } : {}),
    });
  });

  app.get("/api/complete", async (c) => {
    const prefix = c.req.query("prefix") ?? "";
    return c.json(await complete(library, prefix));
  });

  /**
   * Parsed once so the JSON route and the image route cannot key differently
   * (`thumbnail-image-serving` D1). An absent `ao` is `on`, what every request meant
   * before renders were keyed by occlusion (ao-as-recipe-dimension D2).
   */
  function thumbKeyOf(
    c: Context,
  ): { libPath: string; mtime: number; ao: boolean } | Response {
    const path = c.req.query("path");
    const mtime = Number(c.req.query("mtime"));
    if (path === undefined || Number.isNaN(mtime)) {
      return c.json({ error: "path and mtime are required" }, 400);
    }
    const aoParam = c.req.query("ao");
    if (aoParam !== undefined && aoParam !== "on" && aoParam !== "off") {
      return c.json({ error: `invalid ao: ${aoParam}` }, 400);
    }
    return { libPath: canonicalLibPath(path), mtime, ao: aoParam !== "off" };
  }

  /** Every failure a byte route answers: never stored, and never validated (D3). */
  const NO_STORE = { "cache-control": "no-store" };

  /**
   * The strong validator both byte routes issue (D7). Strong because `If-Range` is
   * unusable without one, and both components come from the `stat` the version needs.
   */
  function byteEtag(version: number, size: number): string {
    return `"${version}-${size}"`;
  }

  /**
   * The tiers a model's **bytes** are served under (`byte-route-cache-headers` D3), over
   * the optional `mtime` the listing reports for the source — the archive's for a zip
   * entry; a `null` version is *unknown* and gets no tag. Unlike its sibling
   * `thumbHitTiers` this stages nothing on the context (D8): a header set here would ride
   * every failure reached after it, and since `c.header` is `Headers.set`, a later
   * `no-store` would replace the directive while the stale `ETag` survived beside it.
   */
  function byteTiers(
    c: Context,
    version: number | null,
    size: number,
  ): {
    headers: Record<string, string>;
    etag: string | null;
    notModified: boolean;
  } {
    if (version === null)
      return {
        headers: { "cache-control": "no-cache" },
        etag: null,
        notModified: false,
      };
    const etag = byteEtag(version, size);
    const notModified = c.req.header("if-none-match") === etag;
    const named = c.req.query("mtime");
    // `Number("")` is `0`, so the empty spelling needs its own arm or it names version
    // zero; a malformed hint is absent, never a refusal (D2).
    const asked = named === undefined || named === "" ? NaN : Number(named);
    if (!Number.isFinite(asked))
      return {
        headers: { "cache-control": "no-cache", etag },
        etag,
        notModified,
      };
    if (asked === version)
      return {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
          etag,
        },
        etag,
        notModified,
      };
    // A caller that named a version this source does not have is mis-keyed: no
    // validator, so it re-reads the listing rather than settling on this URL (D3).
    return { headers: { "cache-control": "no-cache" }, etag, notModified };
  }

  /**
   * The tiers a thumbnail **hit** is served under (`thumbnail-image-serving` D1). A
   * current, named generation pins the bytes indefinitely: any write moves the
   * entry to a different URL (D2). The tag is the **entry's** generation, so one AO
   * variant's write revalidates the other rather than risking stale pixels.
   */
  function thumbHitTiers(c: Context, gen: number): boolean {
    const named = c.req.query("gen");
    if (named !== undefined) {
      c.header(
        "Cache-Control",
        named === String(gen)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      return false;
    }
    const etag = `"${gen}"`;
    c.header("Cache-Control", "no-cache");
    c.header("ETag", etag);
    return c.req.header("if-none-match") === etag;
  }

  app.get("/api/thumb", async (c) => {
    const key = thumbKeyOf(c);
    if (key instanceof Response) return key;
    // Most readers want the orientation and the staleness verdict, and the base64
    // render dwarfs them. `off` is a different URL, so the two never share a cache.
    const pixelsParam = c.req.query("pixels");
    if (
      pixelsParam !== undefined &&
      pixelsParam !== "on" &&
      pixelsParam !== "off"
    ) {
      return c.json({ error: `invalid pixels: ${pixelsParam}` }, 400);
    }
    await library.resolve(key.libPath);
    const body = await cache.get(
      key.libPath,
      key.mtime,
      key.ao,
      pixelsParam !== "off",
    );

    // A cached miss outlives the render that would fill it (D3).
    if (body.status !== "hit") {
      c.header("Cache-Control", "no-store");
      return c.json(body);
    }
    if (thumbHitTiers(c, body.gen ?? 0)) return c.body(null, 304);
    return c.json(body);
  });

  /**
   * The same render as bytes, for an `<img>` (`thumbnail-image-serving` D1): same
   * key, same tiers. Anything but a hit is 404 and `no-store`; the JSON says why.
   */
  app.get("/api/thumb/image", async (c) => {
    const key = thumbKeyOf(c);
    if (key instanceof Response) return key;
    await library.resolve(key.libPath);
    const { gen, png } = await cache.image(key.libPath, key.mtime, key.ao);
    if (png === undefined) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "no cached thumbnail" }, 404);
    }
    if (thumbHitTiers(c, gen)) return c.body(null, 304);
    c.header("Content-Type", THUMB_MIME);
    c.header("X-Content-Type-Options", "nosniff");
    // An `<img src>` sends no Origin, so the guard passes it; without this header a
    // guessed URL is an existence oracle through `onload`/`onerror`.
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    // A view over the Buffer's bytes; `tsc` types `.buffer` as `ArrayBufferLike`.
    return c.body(
      new Uint8Array(png.buffer as ArrayBuffer, png.byteOffset, png.byteLength),
    );
  });

  app.put("/api/thumb", async (c) => {
    // The first line, before the body: cameras are keyed by path alone, so one
    // anonymous write re-frames the model every later visitor sees (D5).
    if (!features.thumbWrites) return refuse(c, "thumbWrites");
    const body = (await c.req.json()) as ThumbPutRequest;
    if (typeof body.path !== "string" || typeof body.mtime !== "number") {
      return c.json({ error: "path and mtime are required" }, 400);
    }
    // No write for a path this server would not serve.
    const libPath = canonicalLibPath(body.path);
    await library.resolve(libPath);
    // `null` is the discard, not a bad axis (entry-context-menu D7).
    if (
      body.axis !== undefined &&
      body.axis !== null &&
      !ORBIT_AXES.includes(body.axis)
    ) {
      return c.json({ error: `invalid axis: ${String(body.axis)}` }, 400);
    }
    if (body.lighting !== undefined && body.lighting !== PRODUCIBLE_LIGHTING) {
      return c.json(
        { error: `invalid lighting: ${String(body.lighting)}` },
        400,
      );
    }
    if (body.rig !== undefined && typeof body.rig !== "number") {
      return c.json({ error: `invalid rig: ${String(body.rig)}` }, 400);
    }
    if (body.poseKey !== undefined && typeof body.poseKey !== "string") {
      return c.json({ error: `invalid poseKey: ${String(body.poseKey)}` }, 400);
    }
    // Three states, as on the axis: absence keeps, a string replaces, `null` deletes
    // both renders (`bulk-thumbnail-jobs` D3) — validated as three, or the reading
    // below hands `Buffer.from(null)` on.
    if (
      body.png !== undefined &&
      body.png !== null &&
      typeof body.png !== "string"
    ) {
      return c.json({ error: `invalid png: ${String(body.png)}` }, 400);
    }
    // Refusing NaN and infinity keeps 412 meaning only "the entry moved" (D4).
    if (body.ifGen !== undefined && !Number.isFinite(body.ifGen)) {
      return c.json({ error: `invalid ifGen: ${String(body.ifGen)}` }, 400);
    }
    // Absent is the occluded render; anything but a boolean is a client bug.
    if (body.ao !== undefined && typeof body.ao !== "boolean") {
      return c.json({ error: `invalid ao: ${String(body.ao)}` }, 400);
    }
    let gen: number;
    try {
      gen = await cache.put(libPath, {
        mtime: body.mtime,
        // `null` reaches the cache as `null`: it is the deletion, not bytes.
        png:
          body.png === null
            ? null
            : body.png === undefined
              ? undefined
              : Buffer.from(body.png, "base64"),
        camera: body.camera,
        axis: body.axis,
        lighting: body.lighting,
        rig: body.rig,
        posed: body.posed,
        poseKey: body.poseKey,
        ao: body.ao,
        ifGen: body.ifGen,
      });
    } catch (err) {
      // 412 carries the entry's current generation, so the caller re-keys (D4).
      if (err instanceof StaleWriteError) {
        const refused: ThumbPutRefused = {
          error: "generation moved",
          gen: err.gen,
        };
        return c.json(refused, 412);
      }
      throw err;
    }
    // So the writer can key its next read without a round trip.
    return c.json({ ok: true, gen });
  });

  return app;
}
