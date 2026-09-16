/**
 * The library: one marked tree, and the only translator between a request's path
 * and a filesystem path (library-root D1–D4). Node APIs only (global D1).
 *
 * A library is a tree whose top carries `.model-browser/library.json`. The
 * configured *root* is only where the app opens inside it: the library is found
 * by walking **up** to the mount boundary until a marker appears (D1), and where
 * that finds nothing a bounded probe *down* refuses a root that would enclose an
 * existing library (R1). Every path the app handles is relative to the top (D2).
 */

import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import type { DeploymentConfig, LibraryState } from "../../shared/types";
import { joinVPath, parseVPath } from "./vpath";

/**
 * The message never names a filesystem detail: a refusal that described what it
 * found would be a probe of the volume it just refused.
 */
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

/** The one refusal `resolve` gives for anything outside the tree. */
const OUTSIDE = "path outside the library";

/**
 * Tested before any filesystem call: `resolve`'s nearest-ancestor loop costs one
 * `realpath` per missing component, and the requester chooses that depth.
 */
const MAX_PATH_BYTES = 4096;
const MAX_COMPONENTS = 256;

/** The refusal for a path built to be expensive rather than to name a file. */
const TOO_LONG = "path too long";

function tooLong(libPath: string): boolean {
  return (
    Buffer.byteLength(libPath) > MAX_PATH_BYTES ||
    libPath.split("/").length - 1 > MAX_COMPONENTS
  );
}

/**
 * The one spelling of a library path — the split-then-normalise `resolve`
 * performs, pure, so a route can key a cache by it; without it each spelling is
 * its own key. Only the filesystem half is normalised, the entry half being an
 * opaque archive name (D3).
 */
export function canonicalLibPath(libPath: string): string {
  if (!libPath.startsWith("/"))
    throw new LibraryError("path must be a library path", 400);
  if (tooLong(libPath)) throw new LibraryError(TOO_LONG, 400);
  const { fsPath, entry } = parseVPath(libPath);
  let normalized = posix.normalize(fsPath);
  if (normalized.length > 1 && normalized.endsWith("/"))
    normalized = normalized.slice(0, -1);
  return entry === undefined ? normalized : joinVPath(normalized, entry);
}

export interface Resolved {
  /** Filesystem path — the file, or the containing zip for a virtual path. */
  fsPath: string;
  /** Entry inside the zip, verbatim from the request. Undefined for plain paths. */
  entry?: string;
}

export interface Library {
  /**
   * A not-ready state is re-evaluated per call, so a volume mounted after start
   * needs no restart — except `nested`, which costs a walk and stands for
   * `NESTED_RECHECK_MS`. A ready library keeps its identity and stats its top per
   * call (D4), re-reading the marker on one transition only: present again after
   * an absence. Single-flighted, deciding as it does across `await`s.
   */
  state(): Promise<LibraryState>;
  /**
   * Re-evaluate from scratch, dropping the settled library, the pending
   * return-transition and the `nested` memo (D4). Does **not** re-read the
   * configuration file, parsed once at start (public-deployment D2).
   */
  refresh(): Promise<LibraryState>;
  /** The library top's resolved filesystem path. Throws unless `ready`. */
  realTop(): string;
  /** The library's identity. Throws unless `ready`. */
  id(): string;
  /** D3: the only way a request's path becomes a filesystem path. */
  resolve(libPath: string): Promise<Resolved>;
  /** The reverse: an already-resolved real path under the top → its library path. */
  libPathOf(real: string): string;
}

/** The marker's directory name — the home of every file this app keeps in a library. */
export const MARKER_DIR = ".model-browser";
const MARKER_FILE = "library.json";

/**
 * `top` is optional on the wire, a deployment being able to withhold the host
 * (D11), but a ready library always knows its own. Narrowed once, here.
 */
type Ready = Extract<LibraryState, { state: "ready" }> & { top: string };

/**
 * The environment's root, else the configuration's (D4). **Pure, and it opens no
 * file**: `evaluate` re-runs to re-ask the *filesystem*, so a read here would be
 * paid per request (public-deployment D2).
 */
function configuredRoot(
  env: NodeJS.ProcessEnv,
  config: DeploymentConfig,
): string | undefined {
  const fromEnv = env.MODEL_BROWSER_ROOT;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return config.root !== undefined && config.root !== ""
    ? config.root
    : undefined;
}

/**
 * A JSON object with a non-empty string `id`, unknown fields ignored so a later
 * version may add them. Anything else is passed over rather than adopted.
 */
async function markerIdAt(dir: string): Promise<string | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(join(dir, MARKER_DIR, MARKER_FILE), "utf8"),
    );
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const id = (parsed as Record<string, unknown>).id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** The device of a directory — what bounds the upward walk at a mount. */
async function deviceOf(dir: string): Promise<number> {
  return (await stat(dir)).dev;
}

/**
 * The first marker at or above `start`, stopping at the mount it sits on: a
 * marker on another filesystem is never adopted (D1), or a stray one in `$HOME`
 * re-bases every path and widens confinement to that tree. A start that cannot
 * be stat'd **throws** rather than answering "no marker", the caller having to
 * not settle an identity on a volume that went away.
 *
 * @internal exported for tests
 */
export async function findMarker(
  start: string,
  devOf: (dir: string) => Promise<number> = deviceOf,
): Promise<{ top: string; id: string } | undefined> {
  let dir = start;
  let startDev: number;
  try {
    startDev = await devOf(start);
  } catch {
    // "Cannot see the start" is not "no marker here", and the second gets settled
    // on: the caller hashes the root's path for an identity and keeps it for the
    // process's life.
    throw new Error("the library root cannot be read");
  }
  for (;;) {
    const id = await markerIdAt(dir);
    if (id !== undefined) return { top: dir, id };
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    let parentDev: number;
    try {
      parentDev = await devOf(parent);
    } catch {
      return undefined;
    }
    if (parentDev !== startDev) return undefined;
    dir = parent;
  }
}

/**
 * Bounds on the downward probe below a root with no marker above it (R1). One
 * constant bounds the `readdir`s, the marker opens and the memory alike, all of
 * them paid per request while the state is not ready. Running out is "not
 * found", and the root becomes a library.
 *
 * Past `PROBE_MAX_VISITS` direct children, and at depth ≥ 2, which directories
 * are examined depends on `readdir` order, which differs between Node and Bun —
 * so no test may assume it.
 */
const PROBE_MAX_DEPTH = 4;
const PROBE_MAX_VISITS = 2000;

/** Breadth-first: the shallower is the one the root would enclose most of. */
async function findNestedLibrary(start: string): Promise<string | undefined> {
  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
  let visited = 0;
  // Appended to while it is walked, which an array iterator follows — that
  // ordering *is* the breadth-first guarantee. Nothing is shifted off, so
  // `queue.length` is the number ever pushed, which the push guard tests.
  for (const { dir, depth } of queue) {
    if (visited >= PROBE_MAX_VISITS) break;
    visited++;
    // `start` itself has already been tested by the upward walk.
    if (depth > 0 && (await markerIdAt(dir)) !== undefined) return dir;
    if (depth === PROBE_MAX_DEPTH) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable is not a library; the rest of the level still gets its turn.
      continue;
    }
    for (const e of entries) {
      // The marker is opened by name, never enumerated, and a symlink's dirent is
      // not `isDirectory()`, so the probe never descends out of the tree.
      if (e.name.startsWith(".") || !e.isDirectory()) continue;
      // Memory only: nothing past the `PROBE_MAX_VISITS`th entry is ever dequeued,
      // so truncating the pushes cannot change which directories are examined.
      if (queue.length >= PROBE_MAX_VISITS) break;
      queue.push({ dir: join(dir, e.name), depth: depth + 1 });
    }
  }
  return undefined;
}

/** Writes a fresh marker at `top`, or reports that the volume would not take one. */
async function writeMarker(top: string): Promise<string | undefined> {
  const id = randomUUID();
  try {
    await mkdir(join(top, MARKER_DIR), { recursive: true });
    await writeFile(
      join(top, MARKER_DIR, MARKER_FILE),
      `${JSON.stringify({ id, version: 1 })}\n`,
    );
  } catch {
    return undefined;
  }
  return id;
}

function hashedId(realTop: string): string {
  return createHash("sha256").update(realTop).digest("hex");
}

/** A real path under `realTop` as a library path; `/` for the top itself. */
function toLibPath(realTop: string, real: string): string | undefined {
  if (real === realTop) return "/";
  if (!real.startsWith(realTop + sep)) return undefined;
  return `/${relative(realTop, real).split(sep).join(posix.sep)}`;
}

/**
 * How long a `nested` answer stands before the probe is paid again — the one
 * not-ready answer costing a tree walk rather than a `stat`. Self-correcting:
 * the next window sees a repointed root.
 */
const NESTED_RECHECK_MS = 5000;

/**
 * @param env  the process environment; a parameter so a test points the chain at
 *             a temp tree without mutating the process.
 * @param config  the deployment's configuration, **already parsed** (`config.ts`,
 *                read once at start).
 */
export function createLibrary(
  env: NodeJS.ProcessEnv = process.env,
  config: DeploymentConfig = {},
): Library {
  /**
   * The root is kept verbatim because a later `missing` has to name it: the
   * configured spelling is the only thing the user can act on.
   */
  let settled: { ready: Ready; root: string } | undefined;

  /**
   * The *transition* is what is caught, and only one a request observed: an
   * unplug and replug between two requests is still inherited.
   */
  let wasMissing = false;

  /** A cost memo, not an identity — nothing serves under `nested`. */
  let nestedMemo: { state: LibraryState; until: number } | undefined;

  async function evaluate(): Promise<LibraryState> {
    if (nestedMemo !== undefined) {
      if (Date.now() < nestedMemo.until) return nestedMemo.state;
      nestedMemo = undefined;
    }
    const root = configuredRoot(env, config);
    if (root === undefined) return { state: "unconfigured" };
    try {
      if (!(await stat(root)).isDirectory()) return { state: "missing", root };
    } catch {
      // Not present at all — the usual shape of an unmounted volume.
      return { state: "missing", root };
    }
    // The volume can go away between the `stat` above and this walk, and both calls
    // below fail in that window. Neither may be read as "nothing found": that branch
    // *settles*, hashing the root's path for an identity it keeps for the process's
    // life. `realpath` shares the catch, sitting in the identical window.
    let realRoot: string;
    let found: { top: string; id: string } | undefined;
    try {
      realRoot = await realpath(root);
      found = await findMarker(realRoot);
    } catch {
      return { state: "missing", root };
    }
    if (found !== undefined) {
      // The root is a viewpoint inside the marked tree, not the tree.
      settled = {
        ready: {
          state: "ready",
          id: found.id,
          top: found.top,
          root: toLibPath(found.top, realRoot) ?? "/",
        },
        root,
      };
      return settled.ready;
    }
    // Nothing above it — so look *below* before claiming the root, or a root chosen
    // above an existing library writes a marker over it and orphans its cache (R1).
    // Bounded, and only on this branch.
    const nested = await findNestedLibrary(realRoot);
    if (nested !== undefined) {
      const state: LibraryState = { state: "nested", root, library: nested };
      nestedMemo = { state, until: Date.now() + NESTED_RECHECK_MS };
      return state;
    }
    // No library either way: the root becomes one, if the volume will say so.
    const written = await writeMarker(realRoot);
    settled = {
      ready:
        written === undefined
          ? {
              state: "ready",
              id: hashedId(realRoot),
              top: realRoot,
              root: "/",
              unmarked: true,
            }
          : { state: "ready", id: written, top: realRoot, root: "/" },
      root,
    };
    return settled.ready;
  }

  function requireReady(): Ready {
    if (settled === undefined) throw new Error("the library is not ready");
    return settled.ready;
  }

  /**
   * Everything `state()` does crosses `await`s over `settled` and `wasMissing`, so
   * unserialised, concurrent first calls each write a marker and hand out an
   * identity apiece — and a burst is the normal case at boot.
   */
  let pending: Promise<LibraryState> | undefined;

  async function compute(): Promise<LibraryState> {
    const current = settled;
    // Every not-ready state is a question about the filesystem right now.
    if (current === undefined) return evaluate();
    // Settled, but the tree can still go away under a running server. One `stat` per
    // request buys the difference between "not present" and a 404 on every path in
    // it, and is free beside the `realpath` the request already pays (D3).
    const top = await stat(current.ready.top).catch(() => null);
    if (top === null || !top.isDirectory()) {
      // The cached `ready` is deliberately kept: the same tree returning at the same
      // place is the same library, and `ThumbCache.maintain` reads `realTop()`/`id()`
      // to decide it must not sweep.
      wasMissing = true;
      return { state: "missing", root: current.root };
    }
    // Present again after an absence — the one moment a *different* tree can have
    // arrived at the same path, whose unknown paths `maintain` would then sweep. The
    // test is "the marker says what it said", not "there is a marker": exempting an
    // `unmarked` library lets a marked drive at that path be served under the hash.
    if (wasMissing) {
      const id = await markerIdAt(current.ready.top);
      const expected =
        current.ready.unmarked === true ? undefined : current.ready.id;
      // Cleared only once the read is done.
      wasMissing = false;
      if (id !== expected) {
        settled = undefined;
        return evaluate();
      }
    }
    return current.ready;
  }

  return {
    state() {
      return (pending ??= compute().finally(() => {
        pending = undefined;
      }));
    },

    async refresh() {
      // Let an in-flight evaluation finish rather than clearing `settled` under it.
      if (pending !== undefined) await pending.catch(() => undefined);
      settled = undefined;
      wasMissing = false;
      nestedMemo = undefined;
      return (pending ??= evaluate().finally(() => {
        pending = undefined;
      }));
    },

    realTop: () => requireReady().top,
    id: () => requireReady().id,

    async resolve(libPath) {
      const realTop = requireReady().top;
      if (!libPath.startsWith("/"))
        throw new LibraryError("path must be a library path", 400);
      // Before any filesystem call: the loop below pays per missing component.
      if (tooLong(libPath)) throw new LibraryError(TOO_LONG, 400);
      // The virtual path splits **first**: the entry half is an opaque archive name,
      // and normalising it would rewrite a cache key that is the string itself.
      const { fsPath, entry } = parseVPath(libPath);
      const normalized = posix.normalize(fsPath);
      // A hidden component is unreachable, not merely unlisted: a listing that hides a
      // trash directory still leaves it browsable to anyone who spells the name,
      // `.model-browser` included. Answered as a path that is not there rather than as
      // the "outside" refusal, a distinct status being an oracle. Only the filesystem
      // half is tested.
      if (normalized.split("/").some((part) => part.startsWith("."))) {
        throw new LibraryError(`no such path: ${libPath}`, 404);
      }
      const candidate = join(realTop, normalized);

      // Confinement is decided on the nearest ancestor that exists, so a merely absent
      // path is the route's ordinary 404 rather than a refusal or an escaping ENOENT.
      let anchor = candidate;
      const missing: string[] = [];
      let anchorReal: string;
      for (;;) {
        try {
          anchorReal = await realpath(anchor);
          break;
        } catch {
          // Every `realpath` failure reads as "this component is not there", EACCES and
          // ELOOP alike: the confinement test still runs against the nearest ancestor that
          // did resolve, so an untraversable component cannot widen the answer, and
          // opening the file needs exactly the rights `realpath` was refused.
          const parent = dirname(anchor);
          // The filesystem root always resolves, so this terminates.
          if (parent === anchor) throw new LibraryError(OUTSIDE, 400);
          missing.unshift(basename(anchor));
          anchor = parent;
        }
      }
      if (anchorReal !== realTop && !anchorReal.startsWith(realTop + sep)) {
        throw new LibraryError(OUTSIDE, 400);
      }
      return {
        fsPath:
          missing.length === 0 ? anchorReal : join(anchorReal, ...missing),
        entry,
      };
    },

    libPathOf(real) {
      const libPath = toLibPath(requireReady().top, real);
      if (libPath === undefined) throw new LibraryError(OUTSIDE, 400);
      return libPath;
    },
  };
}
