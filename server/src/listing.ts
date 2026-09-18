import { constants as fsConstants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { baseName } from "../../shared/names";
import type { DirEntry, DirListing, ModelFormat } from "../../shared/types";
import { envPositiveInt } from "./env";
import type { Library } from "./library";
import type { SnapshotEntry, SnapshotStore, TreeSnapshot } from "./snapshot";
import { isZipName, joinVPath, parseVPath, VPathError } from "./vpath";
import { ZipError, type ZipDirCache, listZipEntries } from "./zip";

export class ListingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A revalidation pass that cannot complete against a root that is *there* (§4.3,
 * D6). Its own class because `walkFsLevel` skips an unreadable subdirectory and
 * revalidation must not: the filesystem wins against the snapshot.
 */
export class RevalidationError extends Error {}

const MODEL_EXT = /\.(stl|3mf|obj)$/i;

/** The format a name — or a whole path — ends in, undefined when it is not a model. */
export function modelFormat(name: string): ModelFormat | undefined {
  const m = MODEL_EXT.exec(name);
  return m ? (m[1]!.toLowerCase() as ModelFormat) : undefined;
}

/**
 * Emitted paths are **logical** while the walk descends filesystem ones
 * (library-root D3): re-resolving inside the walk would collapse an in-library
 * alias onto its target. `wire` strips `fsPath` at the boundary.
 */
interface FsEntry extends DirEntry {
  fsPath: string;
}

/** The library's own confinement test, applied to an already-resolved real path. */
function within(realTop: string, real: string): boolean {
  return real === realTop || real.startsWith(realTop + sep);
}

/** Drop the internal filesystem path: only the logical path leaves this module. */
function wire(entries: readonly DirEntry[]): DirEntry[] {
  return entries.map((e) => {
    const out: DirEntry = {
      name: e.name,
      path: e.path,
      kind: e.kind,
      size: e.size,
      mtime: e.mtime,
    };
    if (e.format !== undefined) out.format = e.format;
    return out;
  });
}

interface FlatWalk {
  /** Every directory entry examined costs 1; seeded per request (D5). */
  budget: number;
  /** Realpaths of directories already entered — cycle guard and alias dedup. */
  visited: Set<string>;
  models: DirEntry[];
  /**
   * Containers *below* the root level (D2); the root's own are `listFlat`'s, or
   * one folder gets two tiles. Collected unconditionally — a walk whose output
   * depended on the query would break the snapshot keyed by root alone.
   */
  dirs: DirEntry[];
  /**
   * The walk stopped against its budget, so what it holds is a *prefix* of the
   * tree. Split from `capped` because §4.1a persists only a complete traversal,
   * and a response cap says nothing about whether the tree was fully seen.
   */
  budgetExhausted: boolean;
  /** A cap cut what the walk found: the answer is short, the tree was not. */
  capped: boolean;
  /**
   * Every directory this walk *read*, against the mtime it had then — D4's
   * freshness signal. A skipped directory is absent, because revalidation must
   * make the decisions this walk made and never opening one was such a decision.
   */
  dirMtimes: Map<string, number>;
  /** Revalidation only (§4.2): an unmoved mtime is answered from here, not read. */
  reuse?: Map<string, ReusedLevel>;
  /** The archive layer (D3), so an unchanged archive is never opened. */
  zips?: ZipDirCache;
}

/** One directory as a snapshot recorded it: when it was read, and what it held. */
interface ReusedLevel {
  mtime: number;
  /** Its **direct** children only, in the order the snapshot stored them. */
  children: SnapshotEntry[];
}

/** Spend one walk step; refusing (budget exhausted) stops the walk. */
function takeStep(walk: FlatWalk): boolean {
  if (walk.budget <= 0) {
    walk.budgetExhausted = true;
    return false;
  }
  walk.budget--;
  return true;
}

/** Failures name the library path: naming the volume would be a probe of it. */
async function listFsDir(
  fsDir: string,
  browseLibPath: string,
  realTop: string,
  walk?: FlatWalk,
): Promise<FsEntry[]> {
  let names;
  try {
    names = await readdir(fsDir, { withFileTypes: true });
  } catch {
    throw new ListingError(404, `cannot read directory: ${browseLibPath}`);
  }
  // Code-point order, so a bounded walk cuts the same level on every machine
  // (D2): `readdir` order differs between runtimes and volumes, and ICU
  // collation differs between locales. Display order is `sortEntries`', below.
  names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const entries: FsEntry[] = [];
  for (const d of names) {
    if (d.name.startsWith(".")) continue;
    // Charged per entry examined, not per entry kept: the stat below is the cost.
    if (walk !== undefined && !takeStep(walk)) break;
    const full = join(fsDir, d.name);
    // Only symlinks are confined here: a plain entry can leave the library only
    // through an ancestor the descent already confined, and a full search walk
    // cannot afford an lstat chain per entry.
    if (d.isSymbolicLink()) {
      const real = await realpath(full).catch(() => null);
      if (real === null || !within(realTop, real)) continue;
    }
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    const path = posix.join(browseLibPath, d.name);
    // stat (not the dirent) so symlinked directories are followed and listed.
    if (s.isDirectory()) {
      entries.push({
        name: d.name,
        path,
        fsPath: full,
        kind: "dir",
        size: 0,
        mtime: s.mtimeMs,
      });
    } else if (isZipName(d.name)) {
      entries.push({
        name: d.name,
        path,
        fsPath: full,
        kind: "zip",
        size: s.size,
        mtime: s.mtimeMs,
      });
    } else {
      const format = modelFormat(d.name);
      if (format) {
        entries.push({
          name: d.name,
          path,
          fsPath: full,
          kind: "model",
          format,
          size: s.size,
          mtime: s.mtimeMs,
        });
      }
    }
  }
  return sortEntries(entries);
}

/**
 * `listFsDir` plus what the tree cache needs: the mtime taken *before* the read,
 * and reuse of a level whose mtime has not moved (D4) — stat'd fresh there, the
 * caller's copy having come from the snapshot.
 */
async function levelFor(
  fsDir: string,
  libPath: string,
  realTop: string,
  walk: FlatWalk,
  mtime: number,
  charge: boolean,
): Promise<FsEntry[]> {
  // The root level is the request's baseline work, so it is not charged.
  const charged = charge ? walk : undefined;
  if (walk.reuse === undefined) {
    const level = await listFsDir(fsDir, libPath, realTop, charged);
    walk.dirMtimes.set(libPath, mtime);
    return level;
  }
  const held = walk.reuse.get(libPath);
  const s = await stat(fsDir).catch(() => null);
  if (s === null) {
    // Normally unreachable, removing a directory moving its parent's mtime — but
    // reachable inside one granule of that mtime's resolution.
    if (held !== undefined)
      throw new RevalidationError(`directory is gone: ${libPath}`);
    throw new ListingError(404, `cannot read directory: ${libPath}`);
  }
  if (held !== undefined && held.mtime === s.mtimeMs) {
    // **`chmod` moves no mtime**, so nothing above sees a directory still stamped
    // the same and no longer readable, and reuse would serve its children
    // forever. **Only when the recorded level is non-empty**, or this cannot
    // converge: the walk records an unreadable folder as empty, so invalidating
    // on that forces a cold walk at every cadence.
    if (held.children.length > 0) {
      const reachable = await access(
        fsDir,
        fsConstants.R_OK | fsConstants.X_OK,
      ).then(
        () => true,
        () => false,
      );
      if (!reachable)
        throw new RevalidationError(`cannot read directory: ${libPath}`);
    }
    walk.dirMtimes.set(libPath, s.mtimeMs);
    return reusedLevel(held, fsDir);
  }
  let level;
  try {
    level = await listFsDir(fsDir, libPath, realTop, charged);
  } catch (err) {
    if (held !== undefined)
      throw new RevalidationError(`cannot read directory: ${libPath}`);
    throw err;
  }
  walk.dirMtimes.set(libPath, s.mtimeMs);
  return level;
}

/**
 * As `listFsDir` would have returned it: fresh objects, sorted the same, with the
 * filesystem path rebuilt under the directory being read now, so a remount is
 * followed rather than remembered.
 */
function reusedLevel(held: ReusedLevel, fsDir: string): FsEntry[] {
  return sortEntries(
    held.children.map((e) => {
      const name = posix.basename(e.path);
      const out: FsEntry = {
        name,
        path: e.path,
        fsPath: join(fsDir, name),
        kind: e.kind,
        size: e.size,
        mtime: e.mtime,
      };
      if (e.format !== undefined) out.format = e.format;
      return out;
    }),
  );
}

async function listZipDir(
  zipFsPath: string,
  zipLibPath: string,
  prefix: string,
  zips?: ZipDirCache,
): Promise<DirEntry[]> {
  let zipStat, zipEntries;
  try {
    zipStat = await stat(zipFsPath);
    // Inside the `try`: `stat` succeeds on a mode-000 archive, so the failure
    // lands here and an untyped escape is a 500 naming the operator's filesystem.
    // Through the archive layer (`archive-interior-sheets` D3), because a listing
    // reaches an archive first and so should warm it for the peeks that follow.
    zipEntries = await listZipEntries(zipFsPath, zips);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ListingError(404, `cannot read zip: ${zipLibPath}`);
  }
  const norm =
    prefix === "" ? "" : prefix.endsWith("/") ? prefix : `${prefix}/`;

  // A prefix that is a *file* entry is not a directory; a zip one is nesting.
  const exactFile =
    norm === ""
      ? undefined
      : zipEntries.find((e) => e.name === norm.slice(0, -1));
  if (exactFile !== undefined) {
    if (isZipName(exactFile.name))
      throw new VPathError("nested zips are unsupported");
    throw new ListingError(400, `not a directory: ${exactFile.name}`);
  }

  const dirs = new Set<string>();
  const entries: DirEntry[] = [];
  for (const e of zipEntries) {
    if (!e.name.startsWith(norm)) continue;
    const rest = e.name.slice(norm.length);
    if (rest === "") continue;
    const slash = rest.indexOf("/");
    if (slash !== -1) {
      dirs.add(rest.slice(0, slash));
      continue;
    }
    if (isZipName(rest)) {
      entries.push({
        name: rest,
        path: joinVPath(zipLibPath, e.name),
        kind: "zip",
        size: e.size,
        mtime: zipStat.mtimeMs,
      });
      continue;
    }
    const format = modelFormat(rest);
    if (format) {
      entries.push({
        name: rest,
        path: joinVPath(zipLibPath, e.name),
        kind: "model",
        format,
        size: e.size,
        mtime: zipStat.mtimeMs,
      });
    }
  }
  for (const d of dirs) {
    entries.push({
      name: d,
      path: joinVPath(zipLibPath, `${norm}${d}`),
      kind: "dir",
      size: 0,
      mtime: zipStat.mtimeMs,
    });
  }
  return sortEntries(entries);
}

/**
 * Matches anywhere in the path below the root (D1), and on the same string the
 * client's live filter uses, so typing and submitting mean the same thing.
 */
function matchesQuery(name: string, q: string): boolean {
  return name.toLowerCase().includes(q);
}

/**
 * A container matches on its **own** name (D2): a folder inside a matching folder
 * is not itself a tile, or one hit would return a subtree of them.
 */
function matchesOwnName(name: string, q: string): boolean {
  return baseName(name).toLowerCase().includes(q);
}

const KIND_RANK: Record<string, number> = { dir: 0, zip: 1, model: 2 };

function kindRank(kind: DirEntry["kind"]): number {
  return KIND_RANK[kind] ?? 9;
}

function sortEntries<T extends DirEntry>(entries: T[]): T[] {
  return entries.sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name),
  );
}

/** Canonicalised as the resolver does, so an emitted path is a route again. */
function libHalfOf(libPath: string): string {
  return posix.normalize(parseVPath(libPath).fsPath);
}

/**
 * An entry half means nothing unless the filesystem half is an archive: read as
 * one, a directory raises `EISDIR` and a 500 naming the operator's filesystem. A
 * path that does not stat is left to the zip readers' 404.
 */
async function requireArchive(fsPath: string, libPath: string): Promise<void> {
  const s = await stat(fsPath).catch(() => null);
  if (s === null) return;
  if (!s.isFile() || !isZipName(fsPath)) {
    throw new ListingError(400, `not an archive: ${libPath}`);
  }
}

export async function listDir(
  library: Library,
  libPath: string,
  zips?: ZipDirCache,
): Promise<DirListing> {
  const { fsPath, entry } = await library.resolve(libPath);
  const realTop = library.realTop();
  const libHalf = libHalfOf(libPath);
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null);
    if (s === null) throw new ListingError(404, `no such path: ${libPath}`);
    if (s.isDirectory()) {
      return {
        path: libPath,
        entries: wire(await listFsDir(fsPath, libHalf, realTop)),
      };
    }
    if (isZipName(fsPath)) {
      return {
        path: libPath,
        entries: await listZipDir(fsPath, libHalf, "", zips),
      };
    }
    throw new ListingError(400, `not a directory or zip: ${libPath}`);
  }
  await requireArchive(fsPath, libPath);
  return {
    path: libPath,
    entries: await listZipDir(fsPath, libHalf, entry, zips),
  };
}

/** A constant, not a knob (D2): two machines must draw the same contact sheet. */
const PEEK_BUDGET = 64;

/**
 * Every model kept cost a step, so the entry bound caps the finds too. Exported
 * because the pose-ranked peek asks for exactly this many, which is how "walk to
 * the entry bound" is said without a second stop rule (`pose-for-every-model` D4).
 */
export const PEEK_MAX_FINDS = PEEK_BUDGET;

/**
 * This level's models first, then its subdirectories — not `walkFsLevel`, whose
 * kind order reaches a subfolder's first, so its guards are repeated here. The
 * depth needs no cap: every level is a dirent charged to `PEEK_BUDGET`.
 */
async function peekLevel(
  level: FsEntry[],
  realTop: string,
  walk: FlatWalk,
  found: FsEntry[],
  n: number,
): Promise<void> {
  for (const e of level) {
    if (found.length >= n) return;
    if (e.kind === "model") found.push(e);
  }
  for (const e of level) {
    if (found.length >= n || walk.budgetExhausted) return;
    // Never entered: a preview must not pay a central-directory read per tile.
    if (e.kind !== "dir") continue;
    const real = await realpath(e.fsPath).catch(() => null);
    if (real === null || !within(realTop, real)) continue;
    if (walk.visited.has(real)) continue;
    walk.visited.add(real);
    let sub;
    try {
      sub = await listFsDir(e.fsPath, e.path, realTop, walk);
    } catch {
      continue; // unreadable subdirectory: skipped, only an unreadable root fails
    }
    await peekLevel(sub, realTop, walk, found, n);
  }
}

/**
 * One level of an archive interior (`archive-interior-sheets` D2). **Collected,
 * then sorted, then charged**, by code point: charging while scanning cuts at
 * whatever order the zip was written in. One step per distinct child (D4). Dot
 * names are skipped though a listing shows them, and nothing is confined — an
 * entry name is data inside an already-confined file (D5).
 */
function peekArchiveLevel(
  names: readonly { name: string; size: number }[],
  zipLibPath: string,
  zipMtime: number,
  prefix: string,
  budget: { left: number },
  found: DirEntry[],
  n: number,
): void {
  const norm =
    prefix === "" ? "" : prefix.endsWith("/") ? prefix : `${prefix}/`;
  /**
   * A name that is both a file entry and a directory prefix — only a malformed
   * archive holds one — is taken as the directory: a sheet must pick, and
   * descending finds models where treating it as a leaf shows a folder.
   */
  const children = new Map<string, { dir: boolean; size: number }>();
  for (const e of names) {
    if (!e.name.startsWith(norm)) continue;
    const rest = e.name.slice(norm.length);
    if (rest === "") continue;
    const slash = rest.indexOf("/");
    const child = slash === -1 ? rest : rest.slice(0, slash);
    if (child.startsWith(".")) continue;
    const held = children.get(child);
    if (held === undefined)
      children.set(child, { dir: slash !== -1, size: e.size });
    else if (slash !== -1) held.dir = true;
  }
  const models: { name: string; size: number }[] = [];
  const dirs: string[] = [];
  for (const child of [...children.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    // Charged per distinct child, in the order the bound is defined to cut,
    // whether it turns out to be a model, a subdirectory or something ignored —
    // a dirent costs a step on the filesystem side before anything is known
    // about it either.
    if (budget.left <= 0) break;
    budget.left--;
    const held = children.get(child)!;
    if (held.dir) {
      dirs.push(child);
      continue;
    }
    // Nested archives fall out with everything that is not a model (D6).
    if (modelFormat(child) !== undefined)
      models.push({ name: child, size: held.size });
  }
  for (const m of models) {
    if (found.length >= n) return;
    found.push({
      name: m.name,
      path: joinVPath(zipLibPath, `${norm}${m.name}`),
      kind: "model",
      format: modelFormat(m.name),
      size: m.size,
      // The containing archive's mtime (D11): thumbnails are keyed path+mtime, so
      // another value caches a second image beside the model tile's.
      mtime: zipMtime,
    });
  }
  for (const d of dirs) {
    if (found.length >= n || budget.left <= 0) return;
    peekArchiveLevel(
      names,
      zipLibPath,
      zipMtime,
      `${norm}${d}`,
      budget,
      found,
      n,
    );
  }
}

/**
 * What a peek learned that its answer cannot carry. The layer records
 * `archiveMtime` beside the cells so an **empty** interior sheet, having no cell
 * to disagree with the archive, can still be told from a live one (D9).
 */
export interface PeekOut {
  archiveMtime?: number;
}

/**
 * The interior branch of `peek`. The refusals are the **listing's**, not a bare
 * empty answer (D10), and in `requireArchive`'s own words — one `stat` rather
 * than two, the interior needing the archive's `mtimeMs` anyway.
 */
async function peekInArchive(
  fsPath: string,
  libPath: string,
  entry: string,
  n: number,
  zips?: ZipDirCache,
  out?: PeekOut,
): Promise<DirEntry[]> {
  const zipLibPath = libHalfOf(libPath);
  const s = await stat(fsPath).catch(() => null);
  // Left to the 404 below: "not found" and "not an archive" are different answers.
  if (s !== null && (!s.isFile() || !isZipName(fsPath))) {
    throw new ListingError(400, `not an archive: ${libPath}`);
  }
  // Before the empty-entry-half case below: `/nope.zip` already 404s, and two
  // spellings of one tile must not give two answers.
  if (s === null) throw new ListingError(404, `cannot read zip: ${zipLibPath}`);
  // The archive's own tile by another spelling, which answers `[]`. Falling
  // through would preview the whole archive, which that tile refuses to do.
  if (entry === "") return [];
  let zipEntries;
  try {
    zipEntries = await listZipEntries(fsPath, zips);
  } catch (err) {
    // A corrupt archive says so, as it does through every other reader. Anything
    // else is this library entry failing to open and is named by its **library**
    // path: a raw errno escaping is a 500 naming the operator's filesystem.
    if (err instanceof ZipError) throw err;
    throw new ListingError(404, `cannot read zip: ${zipLibPath}`);
  }
  const norm = entry.endsWith("/") ? entry.slice(0, -1) : entry;
  // `listZipDir`'s taxonomy, so a peek and a listing refuse alike.
  const exactFile = zipEntries.find((e) => e.name === norm);
  if (exactFile !== undefined) {
    if (isZipName(exactFile.name))
      throw new VPathError("nested zips are unsupported");
    throw new ListingError(400, `not a directory: ${exactFile.name}`);
  }
  const zipMtime = s.mtimeMs;
  if (out !== undefined) out.archiveMtime = zipMtime;
  const found: DirEntry[] = [];
  peekArchiveLevel(
    zipEntries,
    zipLibPath,
    zipMtime,
    norm,
    { left: PEEK_BUDGET },
    found,
    n,
  );
  return found;
}

/**
 * The contact sheet a folder tile draws (D2), as its own request: a listing that
 * computed previews would pay one per subdirectory on the cold path (D1). Brief
 * enough to carry **no cancellation token**, and threaded a `walk` for `takeStep`
 * alone, or a wide folder stats its whole level before the bound.
 */
export async function peek(
  library: Library,
  libPath: string,
  n: number,
  zips?: ZipDirCache,
  out?: PeekOut,
): Promise<DirEntry[]> {
  const { fsPath, entry } = await library.resolve(libPath);
  // An archive's own tile is not previewed — that is the branch below, after the
  // `stat` — but a directory *inside* one is (`archive-interior-sheets` D1): by
  // the time an interior tile exists, the request that emitted it has already
  // read this archive's entries.
  if (entry !== undefined)
    return await peekInArchive(fsPath, libPath, entry, n, zips, out);
  const realTop = library.realTop();
  const s = await stat(fsPath).catch(() => null);
  if (s === null) throw new ListingError(404, `no such path: ${libPath}`);
  if (!s.isDirectory()) {
    // Stat'd first, so a *directory* named `x.zip` is walked like any other.
    if (isZipName(fsPath)) return [];
    // 400, not 404: the path is there, it simply has no inside.
    throw new ListingError(400, `not a directory: ${libPath}`);
  }
  const walk: FlatWalk = {
    budget: PEEK_BUDGET,
    visited: new Set(),
    models: [],
    dirs: [],
    budgetExhausted: false,
    capped: false,
    // Never read or written: a peek goes through `listFsDir`, not `levelFor`.
    dirMtimes: new Map(),
  };
  // Or a symlink pointing back at the root re-enters the level it started from.
  walk.visited.add(await realpath(fsPath).catch(() => fsPath));
  const found: FsEntry[] = [];
  // Uncaught, unlike the recursion's: an unreadable *root* is a 404.
  const level = await listFsDir(fsPath, libHalfOf(libPath), realTop, walk);
  await peekLevel(level, realTop, walk, found, n);
  return wire(found);
}

async function walkFsLevel(
  level: FsEntry[],
  rel: string,
  walk: FlatWalk,
  realTop: string,
): Promise<void> {
  for (const e of level) {
    if (walk.budgetExhausted) return;
    if (e.kind === "model") {
      walk.models.push({ ...e, name: `${rel}${e.name}` });
    } else if (e.kind === "dir") {
      // **Before** the unguarded push below, or a subdirectory leaving the library
      // would still be emitted as a tile the next request refuses. A real path
      // that cannot be read is a confinement that cannot be established.
      const real = await realpath(e.fsPath).catch(() => null);
      if (real === null || !within(realTop, real)) {
        // §4.3/D6: a recorded directory whose real path cannot be established is
        // the pass failing against a present root. Catches what `levelFor`'s
        // `access` probe cannot, and vice versa.
        if (real === null && walk.reuse?.has(e.path) === true) {
          throw new RevalidationError(`cannot reach directory: ${e.path}`);
        }
        continue;
      }
      // Pushed before the visited check: a directory reached through an alias is
      // still a directory whose name matches, and the visited set exists to bound
      // the traversal, not to decide which names exist. `rel !== ''` because the
      // root's own level is `listFlat`'s containers.
      const pushed = rel !== "" ? { ...e, name: `${rel}${e.name}` } : undefined;
      if (pushed !== undefined) walk.dirs.push(pushed);
      if (walk.visited.has(real)) continue;
      walk.visited.add(real);
      let sub;
      try {
        sub = await levelFor(e.fsPath, e.path, realTop, walk, e.mtime, true);
      } catch (err) {
        // The one failure this catch must not swallow (§4.3): a recorded directory
        // becoming unreadable contradicts the cache.
        if (err instanceof RevalidationError) throw err;
        continue; // unreadable subdirectory: skipped, only an unreadable root fails
      }
      // This entry carries the snapshot's mtime while the pass has just found
      // another, and the two are the same fact. Mutated in place, which is what
      // carries the correction into `gatherFlat`'s `containers`.
      const fresh = walk.dirMtimes.get(e.path);
      if (fresh !== undefined && fresh !== e.mtime) {
        e.mtime = fresh;
        if (pushed !== undefined) pushed.mtime = fresh;
      }
      await walkFsLevel(sub, `${rel}${e.name}/`, walk, realTop);
    } else {
      // Confined when `listFsDir` emitted it; names inside need no test.
      if (rel !== "") walk.dirs.push({ ...e, name: `${rel}${e.name}` });
      await walkZip(e.fsPath, e.path, "", `${rel}${e.name}!/`, walk);
    }
  }
}

/**
 * Every model under `prefix` at any depth plus that level's directory names, from
 * one central-directory read (D5). `root` selects the error contract: rooted
 * here, failures are `listDir`'s; met partway through a walk, the zip is skipped.
 */
async function walkZip(
  zipFsPath: string,
  zipLibPath: string,
  prefix: string,
  namePrefix: string,
  walk: FlatWalk,
  root = false,
): Promise<DirEntry[]> {
  let zipStat, zipEntries;
  try {
    zipStat = await stat(zipFsPath);
    // The archive layer (D3): an unmoved `{mtime, size}` is answered unopened.
    zipEntries = await listZipEntries(zipFsPath, walk.zips);
  } catch (err) {
    if (!root) return []; // unreadable/corrupt zip: skipped like an unreadable subdirectory
    if (err instanceof ZipError) throw err;
    throw new ListingError(404, `cannot read zip: ${zipLibPath}`);
  }
  const norm =
    prefix === "" ? "" : prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (root && norm !== "") {
    // A prefix that is itself a file entry is not a directory, and if that
    // file is a zip this is the nested-zip case — same taxonomy as listZipDir.
    const exactFile = zipEntries.find((e) => e.name === norm.slice(0, -1));
    if (exactFile !== undefined) {
      if (isZipName(exactFile.name))
        throw new VPathError("nested zips are unsupported");
      throw new ListingError(400, `not a directory: ${exactFile.name}`);
    }
  }
  const dirs = new Set<string>();
  // Every directory *path* below `norm`, so a folder deep in an archive matches
  // like one deep in the tree (D2); `dirs` stays the immediate level, which is
  // what the container tiles are.
  const interior = new Set<string>();
  for (const e of zipEntries) {
    if (walk.budgetExhausted) break;
    if (!e.name.startsWith(norm)) continue;
    const rest = e.name.slice(norm.length);
    if (rest === "") continue;
    if (!takeStep(walk)) break;
    const slash = rest.indexOf("/");
    if (slash !== -1) dirs.add(rest.slice(0, slash));
    for (let i = slash; i !== -1; i = rest.indexOf("/", i + 1)) {
      const d = rest.slice(0, i);
      // A root walk's immediate children are the containers path's job.
      if (!root || d.includes("/")) interior.add(d);
    }
    // Nested zip entries fall out here; models under a directory named *.zip stay.
    const format = modelFormat(rest);
    if (format === undefined) continue;
    walk.models.push({
      name: `${namePrefix}${rest}`,
      path: joinVPath(zipLibPath, e.name),
      kind: "model",
      format,
      size: e.size,
      mtime: zipStat.mtimeMs,
    });
  }
  for (const d of interior) {
    walk.dirs.push({
      name: `${namePrefix}${d}`,
      path: joinVPath(zipLibPath, `${norm}${d}`),
      kind: "dir",
      size: 0,
      mtime: zipStat.mtimeMs,
    });
  }
  return sortEntries(
    [...dirs].map((d) => ({
      name: d,
      path: joinVPath(zipLibPath, `${norm}${d}`),
      kind: "dir" as const,
      size: 0,
      mtime: zipStat.mtimeMs,
    })),
  );
}

/**
 * A landmark as well as a helper: `flat.test.ts` slices this source between
 * `async function walkFsLevel` and the text `function envLimit`, so renaming or
 * inlining this means moving that delimiter too.
 */
function envLimit(name: string, fallback: number): number {
  return envPositiveInt(name, fallback);
}

/**
 * The root's containers as tiles, then every model beneath it, by file name — or
 * by relative path under a query, keeping a folder's contents contiguous (D3). A
 * query narrows models on their whole path (D1) and containers on their own names
 * (D2), before the separate caps (D4). A truncated response with *no* entries
 * therefore always means budget exhaustion, which the client's message relies on.
 */
export async function listFlat(
  library: Library,
  libPath: string,
  query?: string,
  opts: { folderMatching?: boolean } = {},
  store?: SnapshotStore,
): Promise<DirListing> {
  return (await walkFlat(library, libPath, query, opts, store)).listing;
}

/**
 * What one traversal gathered, before any filter or cap — and exactly what a
 * snapshot stores, which is why the query is not in the cache key (D1).
 */
interface Gathered {
  /** The root's own immediate dir/zip entries, bare-named and pre-ranked. */
  containers: DirEntry[];
  /** Every container *below* the root level, named by root-relative path. */
  dirs: DirEntry[];
  /** Every model under the root, named by root-relative path. */
  models: DirEntry[];
  /** Directory library path → its `mtimeMs` when this walk read it (D4). */
  dirMtimes: Map<string, number>;
  budgetExhausted: boolean;
}

/** The traversal itself, with no query, no cap and no snapshot in sight. */
async function gatherFlat(
  library: Library,
  libPath: string,
  budget: number,
  zips?: ZipDirCache,
  reuse?: Map<string, ReusedLevel>,
): Promise<Gathered> {
  const { fsPath, entry } = await library.resolve(libPath);
  const realTop = library.realTop();
  const libHalf = libHalfOf(libPath);
  const walk: FlatWalk = {
    budget,
    visited: new Set(),
    models: [],
    dirs: [],
    budgetExhausted: false,
    capped: false,
    dirMtimes: new Map(),
    reuse,
    zips,
  };
  let containers: DirEntry[];
  if (entry === undefined) {
    const s = await stat(fsPath).catch(() => null);
    if (s === null) throw new ListingError(404, `no such path: ${libPath}`);
    if (s.isDirectory()) {
      const level = await levelFor(
        fsPath,
        libHalf,
        realTop,
        walk,
        s.mtimeMs,
        false,
      );
      containers = level.filter((e) => e.kind !== "model");
      walk.visited.add(await realpath(fsPath).catch(() => fsPath));
      await walkFsLevel(level, "", walk, realTop);
    } else if (isZipName(fsPath)) {
      // An archive root keeps no directory state: its `{mtime, size}` is the
      // signal, and `walkZip` checks it on every pass.
      containers = await walkZip(fsPath, libHalf, "", "", walk, true);
    } else {
      throw new ListingError(400, `not a directory or zip: ${libPath}`);
    }
  } else {
    // Directories only: a nested zip is not enterable, so a tile for one would be
    // a link that 400s on click.
    await requireArchive(fsPath, libPath);
    containers = await walkZip(fsPath, libHalf, entry, "", walk, true);
  }
  return {
    containers,
    dirs: walk.dirs,
    models: walk.models,
    dirMtimes: walk.dirMtimes,
    budgetExhausted: walk.budgetExhausted,
  };
}

/**
 * One flat array in the walk's **own emission order**, re-sorted neither way, so
 * a cached answer and a walked one are entry-for-entry identical. Sorting here
 * would also be untestable: `readdir` order differs between Bun and Node.
 */
function snapshotEntries(
  g: Pick<Gathered, "containers" | "dirs" | "models">,
): SnapshotEntry[] {
  return [...g.containers, ...g.dirs, ...g.models].map((e) => {
    const out: SnapshotEntry = {
      name: e.name,
      path: e.path,
      kind: e.kind,
      size: e.size,
      mtime: e.mtime,
    };
    if (e.format !== undefined) out.format = e.format;
    return out;
  });
}

/**
 * The inverse, as **fresh** objects: `applyDisplayNames` mutates emitted entries
 * in place and never clears them. The partition is by kind and by whether the
 * stored name carries a `/`, which only a below-root one does.
 */
function partition(
  entries: readonly SnapshotEntry[],
): Pick<Gathered, "containers" | "dirs" | "models"> {
  const containers: DirEntry[] = [];
  const dirs: DirEntry[] = [];
  const models: DirEntry[] = [];
  for (const e of entries) {
    const out: DirEntry = {
      name: e.name,
      path: e.path,
      kind: e.kind,
      size: e.size,
      mtime: e.mtime,
    };
    if (e.format !== undefined) out.format = e.format;
    if (e.kind === "model") models.push(out);
    else if (e.name.includes("/")) dirs.push(out);
    else containers.push(out);
  }
  return { containers, dirs, models };
}

/** A snapshot's `dirs`, indexed for `levelFor`'s reuse check. */
function levelIndex(snapshot: TreeSnapshot): Map<string, ReusedLevel> {
  const byDir = new Map<string, SnapshotEntry[]>();
  for (const e of snapshot.entries) {
    const parent = posix.dirname(e.path);
    const held = byDir.get(parent);
    if (held === undefined) byDir.set(parent, [e]);
    else held.push(e);
  }
  const out = new Map<string, ReusedLevel>();
  // Driven from `dirs`, so only a directory the walk *read* can be reused: an
  // archive's interior groups under keys no `readdir` produced, and archives are
  // revalidated by their own identity through the D3 layer.
  for (const d of snapshot.dirs) {
    out.set(d.path, { mtime: d.mtime, children: byDir.get(d.path) ?? [] });
  }
  return out;
}

function dirRecords(dirMtimes: Map<string, number>): TreeSnapshot["dirs"] {
  return [...dirMtimes].map(([path, mtime]) => ({ path, mtime }));
}

/** Entry-for-entry equality, in order — what "the tree moved" means (§4.2). */
function sameEntries(
  a: readonly SnapshotEntry[],
  b: readonly SnapshotEntry[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.name === y.name &&
      x.path === y.path &&
      x.kind === y.kind &&
      x.format === y.format &&
      x.size === y.size &&
      x.mtime === y.mtime
    );
  });
}

/**
 * The incremental pass (§4.2, D4): one `stat` per recorded directory, a `readdir`
 * only where the mtime moved, and **never a background re-walk**. Reports which
 * directories moved (§6.1); one it did not reach is absent and needs to be, since
 * removing a directory moves its parent's mtime. Raises `RevalidationError` when
 * it cannot complete against a root that is present, and the caller invalidates
 * rather than serving contradicted entries (§4.3, D6).
 */
export async function revalidateTree(
  library: Library,
  root: string,
  store: SnapshotStore,
): Promise<{ changed: boolean; changedDirs: string[] }> {
  const snapshot = await store.load(root);
  if (snapshot === null) return { changed: false, changedDirs: [] };
  const g = await gatherFlat(
    library,
    root,
    // Not the browse budget: a tree a *search* could reach must stay
    // revalidatable whatever kind of listing last cached it.
    envLimit("MODEL_BROWSER_SEARCH_BUDGET", 200_000),
    store.archiveCache(),
    levelIndex(snapshot),
  );
  if (g.budgetExhausted)
    throw new RevalidationError(`revalidation did not finish: ${root}`);
  const entries = snapshotEntries(g);
  const changed = !sameEntries(snapshot.entries, entries);
  // Including one never recorded, which is a folder that has just appeared.
  const before = new Map(snapshot.dirs.map((d) => [d.path, d.mtime]));
  const changedDirs = [...g.dirMtimes]
    .filter(([path, mtime]) => before.get(path) !== mtime)
    .map(([path]) => path);
  await store.save({
    root,
    walkedAt: Date.now(),
    entries,
    dirs: dirRecords(g.dirMtimes),
  });
  return { changed, changedDirs };
}

/**
 * Every model beneath a library path, with no response cap (§6.7, D7). **Uncapped
 * is not unbounded**: the *listing* cap would silently make this a different
 * scope, and the caller is about to act on every model in it, while the walk's
 * step budget still bounds the work. Answered from an exact snapshot, from an
 * ancestor's (re-named relative to the path asked about), or by walking.
 */
export async function enumerateModels(
  library: Library,
  libPath: string,
  store?: SnapshotStore,
  /**
   * Called with the root about to answer, before anything is read out of it —
   * `ListingCache.enumerate`'s validation lifecycle. It **may invalidate** that
   * root: everything below re-loads, so a dropped one falls through to the walk.
   */
  validate?: (root: string) => Promise<unknown>,
): Promise<{ models: DirEntry[]; complete: boolean; fromSnapshot: boolean }> {
  if (store !== undefined) {
    if (validate !== undefined) {
      const covering = await coveringRoot(store, libPath);
      if (covering !== null) await validate(covering);
    }
    const exact = await store.load(libPath);
    if (exact !== null) {
      return {
        models: modelsUnder(partition(exact.entries).models, libPath),
        complete: true,
        fromSnapshot: true,
      };
    }
    // Longest first: every enclosing root holds this subtree identically, and the
    // nearest holds the fewest entries to filter.
    const roots = (await store.roots())
      .filter((root) => encloses(root, libPath))
      .sort((a, b) => b.length - a.length);
    // **Resolved before an ancestor's tree answers for it**: a path merely
    // *spelled* under a cached root filters to an empty set, which would be a 200
    // about a folder that does not exist. The exact branch needs no such stat.
    if (roots.length > 0) await requireEnumerable(library, libPath);
    for (const root of roots) {
      const snapshot = await store.load(root);
      if (snapshot === null) continue;
      return {
        models: modelsUnder(partition(snapshot.entries).models, libPath),
        complete: true,
        fromSnapshot: true,
      };
    }
  }
  const g = await gatherFlat(
    library,
    libPath,
    // The search budget: the browse one is sized for the tiles on one screen.
    envLimit("MODEL_BROWSER_SEARCH_BUDGET", 200_000),
    store?.archiveCache(),
  );
  const complete = !g.budgetExhausted;
  if (store !== undefined && complete) {
    // **Best-effort, as `walkFlat`'s request-path save is**: the answer is already
    // produced, so a full disk must not turn it into a 500 naming the cache's
    // path. `revalidateTree`'s save still rejects, its failure taxonomy needing
    // to tell an unwritable store from a contradicted cache.
    await store
      .save({
        root: libPath,
        walkedAt: Date.now(),
        entries: snapshotEntries(g),
        dirs: dirRecords(g.dirMtimes),
      })
      .catch(() => undefined);
  }
  // Through the same filter as the cached paths, though a fresh walk needs none
  // of it, so the three answers cannot differ in naming or in what they share.
  return {
    models: modelsUnder(g.models, libPath),
    complete,
    fromSnapshot: false,
  };
}

/** Is `root` at or above `libPath`? Segment-wise, so `/kit` never encloses `/kit2`. */
function encloses(root: string, libPath: string): boolean {
  return (
    root === libPath || libPath.startsWith(root === "/" ? "/" : `${root}/`)
  );
}

/**
 * The root that would answer an enumeration of `libPath`: the longest enclosing
 * one. Loads nothing — it is asked before the answer is read.
 */
async function coveringRoot(
  store: SnapshotStore,
  libPath: string,
): Promise<string | null> {
  const covering = (await store.roots())
    .filter((root) => encloses(root, libPath))
    .sort((a, b) => b.length - a.length);
  return covering[0] ?? null;
}

/**
 * `gatherFlat`'s own up-front checks, extracted so a cached enumeration refuses
 * what a walk would refuse, in the same words. Otherwise one question has two
 * answers, differing by whether an ancestor happened to be cached.
 */
async function requireEnumerable(
  library: Library,
  libPath: string,
): Promise<void> {
  const { fsPath, entry } = await library.resolve(libPath);
  // The archive is what must be one; a prefix naming no entry is an empty answer.
  if (entry !== undefined) return await requireArchive(fsPath, libPath);
  const s = await stat(fsPath).catch(() => null);
  if (s === null) throw new ListingError(404, `no such path: ${libPath}`);
  if (!s.isDirectory() && !isZipName(fsPath)) {
    throw new ListingError(400, `not a directory or zip: ${libPath}`);
  }
}

/**
 * Named as a walk rooted *there* would name them. An ancestor's snapshot names
 * them one level too high, and deriving from the path is exact — it is how the
 * walk builds the name on both the filesystem and the archive side.
 */
function modelsUnder(models: readonly DirEntry[], libPath: string): DirEntry[] {
  // Two separators, because a root can be an archive: a `/` prefix matches
  // nothing inside `/kit/box.zip`, and that enumeration would come back empty.
  const prefixes = libPath === "/" ? ["/"] : [`${libPath}/`, `${libPath}!/`];
  const out: DirEntry[] = [];
  for (const m of models) {
    if (m.kind !== "model") continue;
    const prefix = prefixes.find((p) => m.path.startsWith(p));
    if (prefix === undefined) continue;
    // Fresh, never the stored object: emission annotates entries in place.
    const copy: DirEntry = {
      name: m.path.slice(prefix.length),
      path: m.path,
      kind: m.kind,
      size: m.size,
      mtime: m.mtime,
    };
    if (m.format !== undefined) copy.format = m.format;
    out.push(copy);
  }
  return out;
}

/**
 * `listFlat`, plus the two facts the wire folds into one `truncated`:
 * `budgetExhausted` is about the **traversal**, `capped` about the **answer**.
 * Exported because §4.1a persists only a complete traversal, which `truncated`
 * cannot answer — please do not inline it as an unused indirection. With a
 * `store` it is also §4.1's serving seam, keyed by the root alone, so one cached
 * tree serves every query and both folder-matching settings (D1).
 */
export async function walkFlat(
  library: Library,
  libPath: string,
  query?: string,
  opts: { folderMatching?: boolean } = {},
  store?: SnapshotStore,
): Promise<{
  listing: DirListing;
  budgetExhausted: boolean;
  capped: boolean;
  fromSnapshot: boolean;
}> {
  const q = query?.trim().toLowerCase();
  const hasQuery = q !== undefined && q !== "";
  // Default on, so an old client and a hand-written URL get the shipped predicate.
  const folderMatching = opts.folderMatching !== false;
  // Confinement was settled when the snapshot was written — only a walk that
  // resolved through the library can have made one — so serving it touches
  // nothing, which is the requirement.
  const snapshot = store === undefined ? null : await store.load(libPath);
  const fromSnapshot = snapshot !== null;
  let gathered: Pick<Gathered, "containers" | "dirs" | "models">;
  let budgetExhausted = false;
  if (snapshot !== null) {
    gathered = partition(snapshot.entries);
  } else {
    const g = await gatherFlat(
      library,
      libPath,
      // A search affords a far larger walk (D5): the flat view renders everything
      // it walks, while a search discards non-matches, so its budget buys reach.
      hasQuery
        ? envLimit("MODEL_BROWSER_SEARCH_BUDGET", 200_000)
        : envLimit("MODEL_BROWSER_FLAT_BUDGET", 20000),
      store?.archiveCache(),
    );
    gathered = g;
    budgetExhausted = g.budgetExhausted;
    // §4.1a: **only a complete traversal is persisted**, tested on
    // `budgetExhausted` and never on the wire's `truncated`, which a response cap
    // also sets. A walk that threw never reaches this line at all.
    if (store !== undefined && !budgetExhausted) {
      // **Best-effort**: the listing is already produced, so a full disk must not
      // turn it into a 500 naming the cache's path. `revalidateTree`'s save still
      // rejects, its taxonomy needing to tell an unwritable store from a
      // contradicted cache.
      await store
        .save({
          root: libPath,
          walkedAt: Date.now(),
          entries: snapshotEntries(g),
          dirs: dirRecords(g.dirMtimes),
        })
        .catch(() => undefined);
    }
  }
  let containers = gathered.containers;
  let models = gathered.models;
  let capped = false;

  const cap = envLimit("MODEL_BROWSER_FLAT_CAP", 500);
  // Filter before sorting: a sorted subset equals the sorted set filtered, and
  // the comparator below is `localeCompare` over everything a search walked.
  if (hasQuery) {
    containers = containers.filter((e) => matchesOwnName(e.name, q));
    // The option narrows the *model* predicate only; containers are unaffected.
    const modelMatches = folderMatching ? matchesQuery : matchesOwnName;
    models = models.filter((m) => modelMatches(m.name, q));
    containers = [
      ...containers,
      ...gathered.dirs.filter((d) => matchesOwnName(d.name, q)),
    ];
    // Containers arrive pre-ranked and are not re-sorted, but appending deeper
    // matches breaks that, so a queried listing sorts the block. The tiebreak is
    // the root-relative path, which a bare name already is (D3).
    containers.sort(
      (a, b) =>
        kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name),
    );
    // Their own bound, so a fragment matching many folders cannot spend the
    // models' (D4).
    const folderCap = envLimit("MODEL_BROWSER_FOLDER_CAP", 50);
    if (containers.length > folderCap) {
      capped = true;
      containers.length = folderCap;
    }
  }
  // Not `sortEntries`, which orders models by their whole relative path: flat
  // ordering is by file name, so same-named parts sit together (D2), while a
  // queried listing does order by path, keeping each matching folder's contents
  // contiguous (D3). On a copy, the array being the store's on a cached answer.
  models = [...models].sort(
    hasQuery
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) =>
          baseName(a.name).localeCompare(baseName(b.name)) ||
          a.name.localeCompare(b.name),
  );
  if (models.length > cap) {
    capped = true;
    models.length = cap;
  }
  const listing: DirListing = {
    path: libPath,
    entries: wire([...containers, ...models]),
  };
  // The wire's `truncated` is the OR: "some models were dropped", whichever
  // bound dropped them.
  if (budgetExhausted || capped) listing.truncated = true;
  return { listing, budgetExhausted, capped, fromSnapshot };
}

/**
 * Path-bar autocomplete. Anything unresolvable completes to nothing rather than
 * refusing: a path bar is typed one character at a time.
 */
export async function complete(
  library: Library,
  prefix: string,
): Promise<string[]> {
  if (!prefix.startsWith("/")) return [];
  const dirLibPath = prefix.endsWith("/") ? prefix : posix.dirname(prefix);
  const base = prefix.endsWith("/") ? "" : posix.basename(prefix);
  let fsDir;
  try {
    fsDir = (await library.resolve(dirLibPath)).fsPath;
  } catch {
    return [];
  }
  let names;
  try {
    names = await readdir(fsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter(
      (d) =>
        d.isDirectory() &&
        // `resolve` refuses a hidden component, so offering one would offer a path
        // the next request cannot fetch.
        !d.name.startsWith(".") &&
        d.name.startsWith(base),
    )
    .map((d) => `${posix.join(dirLibPath, d.name)}/`)
    .sort()
    .slice(0, 20);
}
