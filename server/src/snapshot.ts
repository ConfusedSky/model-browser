/**
 * The listing cache's durable store (`listing-tree-cache` §2–§3, D2): one file
 * per walked root plus one `archives.json`, under `<cache>/<id>/snapshots/`.
 *
 * A **subdirectory** because `ThumbCache.maintain()` reads every `*.json` at its
 * own level as a thumbnail sidecar, and its own size cap because sharing the
 * thumbnail pool would let pixel churn evict a cold walk's protection.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { envPositiveInt } from "./env";
import { type Library, LibraryError } from "./library";
import { VPathError } from "./vpath";
import type { ArchiveId, ZipDirCache, ZipEntry } from "./zip";

/**
 * Bump on any change to what a stored file *means*: writes are atomic, so what
 * this covers is a whole file from another build whose fields still parse.
 */
export const SNAPSHOT_VERSION = 1;

export const SNAPSHOT_DIR = "snapshots";

export const ARCHIVES_FILE = "archives.json";

/** Default bound for the whole store: 64 MB of metadata, per design D2. */
const DEFAULT_CAP = 64 * 1024 ** 2;

/**
 * How old a `.tmp` must be before the sweep reaps it: a temp lives for one write,
 * and the startup sweep runs beside the pass's own saves, so younger is live.
 */
const TMP_REAP_MS = 60_000;

/**
 * Deliberately **not** `DirEntry`: that carries `displayName`, which
 * `applyDisplayNames` sets in place and never clears, so persisting it would
 * write one request's override names into every later answer.
 */
export interface SnapshotEntry {
  name: string;
  /** Library path — never a filesystem path, so a remount changes nothing. */
  path: string;
  kind: "dir" | "zip" | "model";
  /** Model format, present when kind === 'model'. */
  format?: "stl" | "3mf" | "obj";
  size: number;
  /** mtime (ms). For zip entries this is the containing archive's mtime. */
  mtime: number;
}

/**
 * Per-directory freshness state (D4). A record, not a bare number, so D4's
 * fallback fingerprint can be added without a format bump.
 */
export interface SnapshotDir {
  /** Library path of the directory. */
  path: string;
  /** Its `mtimeMs` when the walk read it. */
  mtime: number;
}

/** A complete walk of one root, as it is served and revalidated. */
export interface TreeSnapshot {
  /** The walked root's library path — the second half of the key. */
  root: string;
  /** When the walk that produced this completed (ms since epoch). */
  walkedAt: number;
  entries: SnapshotEntry[];
  dirs: SnapshotDir[];
}

/** A tree snapshot as it sits on disk. */
interface TreeFile extends TreeSnapshot {
  version: number;
  /** Redundant with the directory, so a file restored into the wrong one is caught. */
  library: string;
}

/** One archive's cached central directory, against the identity it was read at. */
interface ArchiveRecord extends ArchiveId {
  entries: ZipEntry[];
}

/** The archive layer as it sits on disk. */
interface ArchivesFile {
  version: number;
  library: string;
  /** Keyed by the archive's library path (never its filesystem path). */
  archives: Record<string, ArchiveRecord>;
}

/** The size cap from the environment, through `env.ts`'s one validated parser. */
function envCap(): number {
  return envPositiveInt("MODEL_BROWSER_SNAPSHOT_CAP", DEFAULT_CAP);
}

/**
 * Temp file, fsync, rename — `overrides.ts`'s `writeOverrides` procedure, so a
 * reader sees the old file or the new one. The directory fsync is what makes the
 * *rename* durable, and is best-effort: exFAT does not support it.
 */
async function writeAtomic(
  dir: string,
  name: string,
  text: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  // pid + ms collide within one tick; the random suffix is what does not.
  const temp = join(
    dir,
    `.${name}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (err) {
    await unlink(temp).catch(() => undefined);
    throw err;
  }
  const dirHandle = await open(dir, "r").catch(() => null);
  if (dirHandle !== null) {
    await dirHandle.sync().catch(() => undefined);
    await dirHandle.close().catch(() => undefined);
  }
}

/**
 * Constructed like `ThumbCache`, so a test never touches the real cache.
 * Omitting the library is test-only: no identity is then checked.
 */
export class SnapshotStore {
  /** The archive layer, loaded once per process and flushed on demand. */
  private archives: Map<string, ArchiveRecord> | undefined;
  private archivesDirty = false;
  private loadingArchives: Promise<Map<string, ArchiveRecord>> | undefined;
  /** The tail of the flush chain — see `flush`. Never rejects. */
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    readonly dir: string = process.env.MODEL_BROWSER_CACHE ??
      join(homedir(), ".cache", "model-browser"),
    readonly sizeCap: number = envCap(),
    private readonly library?: Library,
  ) {}

  /** Awaited because `id()` throws until the library has been evaluated once. */
  private async storeDir(): Promise<string> {
    if (this.library === undefined) return join(this.dir, SNAPSHOT_DIR);
    await this.library.state();
    return join(this.dir, this.library.id(), SNAPSHOT_DIR);
  }

  /** The library's identity, or `''` for a library-less (test) store. */
  private async libraryId(): Promise<string> {
    if (this.library === undefined) return "";
    await this.library.state();
    return this.library.id();
  }

  /** Hashed because a library path is not a file name. */
  private treeFile(root: string): string {
    return `tree-${createHash("sha256").update(root).digest("hex")}.json`;
  }

  /**
   * The snapshot for `root`, or null. Reading is **pure** — a rejected file is
   * left where it is, so a read cannot destroy what a newer build could use.
   */
  async load(root: string): Promise<TreeSnapshot | null> {
    const dir = await this.storeDir();
    const file = join(dir, this.treeFile(root));
    const parsed = await readJson<TreeFile>(file);
    if (parsed === null) return null;
    if (parsed.version !== SNAPSHOT_VERSION) return null;
    if (parsed.library !== (await this.libraryId())) return null;
    // A hash collision would serve another directory's tree.
    if (parsed.root !== root) return null;
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.dirs))
      return null;
    // The LRU clock is the file's mtime, bumped via `utimes` rather than by
    // rewriting, which the sweep could catch mid-write.
    const now = new Date();
    await utimes(file, now, now).catch(() => undefined);
    return {
      root: parsed.root,
      walkedAt: parsed.walkedAt,
      entries: parsed.entries,
      dirs: parsed.dirs,
    };
  }

  /**
   * Every root this library has a snapshot for — the files are the only census,
   * since the key is a hash. Deliberately does **not** bump the LRU clock:
   * counting a root is not listing it.
   */
  async roots(): Promise<string[]> {
    const dir = await this.storeDir();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const id = await this.libraryId();
    const out: string[] = [];
    for (const name of names) {
      if (!name.startsWith("tree-") || !name.endsWith(".json")) continue;
      const parsed = await readJson<TreeFile>(join(dir, name));
      if (
        parsed === null ||
        parsed.version !== SNAPSHOT_VERSION ||
        parsed.library !== id
      )
        continue;
      if (typeof parsed.root === "string") out.push(parsed.root);
    }
    return out;
  }

  /**
   * The caller owns the rule this store cannot check: **only a completed
   * traversal may be saved** (D1/§4.1a), which only `budgetExhausted` knows.
   * Flushes the archive layer, so both halves of a walk land together.
   */
  async save(snapshot: TreeSnapshot): Promise<void> {
    const dir = await this.storeDir();
    const file: TreeFile = {
      version: SNAPSHOT_VERSION,
      library: await this.libraryId(),
      root: snapshot.root,
      walkedAt: snapshot.walkedAt,
      entries: snapshot.entries,
      dirs: snapshot.dirs,
    };
    await writeAtomic(dir, this.treeFile(snapshot.root), JSON.stringify(file));
    await this.flush();
  }

  /** What revalidation calls on a contradiction (D6). Absent is success. */
  async invalidate(root: string): Promise<void> {
    const dir = await this.storeDir();
    await rm(join(dir, this.treeFile(root)), { force: true });
  }

  /** The blunt instrument behind an explicit reload (D9). */
  async invalidateAll(): Promise<void> {
    const dir = await this.storeDir();
    this.archives = new Map();
    this.archivesDirty = false;
    await rm(dir, { recursive: true, force: true });
  }

  // ---- archive directories (D3) ----

  /**
   * Held in memory across a walk and written once, by `flush` or `save`:
   * persisting per `set` rewrites the whole layer once per archive.
   */
  archiveCache(): ZipDirCache {
    return {
      get: async (zipPath, id) => {
        const key = await this.archiveKey(zipPath);
        const held = (await this.loadArchives()).get(key);
        if (held === undefined) return undefined;
        // D3's soundness: a rewritten archive rewrites its tail.
        if (held.mtime !== id.mtime || held.size !== id.size) return undefined;
        return held.entries;
      },
      set: async (zipPath, id, entries) => {
        const key = await this.archiveKey(zipPath);
        (await this.loadArchives()).set(key, {
          mtime: id.mtime,
          size: id.size,
          entries,
        });
        this.archivesDirty = true;
      },
    };
  }

  /**
   * The **library path**, so the layer survives a remount; `zip.ts` speaks
   * filesystem paths, so the translation happens here. A path the library
   * refuses falls back to the filesystem one — mount-specific, but not wrong.
   */
  private async archiveKey(zipPath: string): Promise<string> {
    if (this.library === undefined) return zipPath;
    try {
      await this.library.state();
      return this.library.libPathOf(zipPath);
    } catch (err) {
      if (err instanceof LibraryError || err instanceof VPathError)
        return zipPath;
      throw err;
    }
  }

  /** Single-flighted: a walk fires many `get`s before the first has resolved. */
  private async loadArchives(): Promise<Map<string, ArchiveRecord>> {
    if (this.archives !== undefined) return this.archives;
    return (this.loadingArchives ??= this.readArchives().finally(() => {
      this.loadingArchives = undefined;
    }));
  }

  private async readArchives(): Promise<Map<string, ArchiveRecord>> {
    const dir = await this.storeDir();
    const parsed = await readJson<ArchivesFile>(join(dir, ARCHIVES_FILE));
    const map = new Map<string, ArchiveRecord>();
    if (
      parsed !== null &&
      parsed.version === SNAPSHOT_VERSION &&
      parsed.library === (await this.libraryId()) &&
      typeof parsed.archives === "object" &&
      parsed.archives !== null
    ) {
      for (const [key, record] of Object.entries(parsed.archives)) {
        if (
          record !== null &&
          typeof record === "object" &&
          Array.isArray(record.entries)
        ) {
          map.set(key, record);
        }
      }
    }
    this.archives = map;
    return map;
  }

  /**
   * A process that never calls this (nor `save`) keeps what it learned in memory
   * only, which is right for a walk that must persist nothing.
   */
  async flush(): Promise<void> {
    // **One flush at a time, per store.** Atomicity makes each write whole and
    // says nothing about which whole write wins: two flushes could interleave
    // inside `writeAtomic` and commit their `rename`s in either order, the older
    // serialization landing last. Chained rather than locked, because each flush
    // re-reads `archives` on its turn; the `catch` keeps a failure from wedging
    // the chain, and `run` still rejects for this caller.
    const run = this.flushing.then(() => this.flushLocked());
    this.flushing = run.catch(() => undefined);
    return await run;
  }

  private async flushLocked(): Promise<void> {
    if (!this.archivesDirty || this.archives === undefined) return;
    const dir = await this.storeDir();
    const file: ArchivesFile = {
      version: SNAPSHOT_VERSION,
      library: await this.libraryId(),
      archives: Object.fromEntries(this.archives),
    };
    const text = JSON.stringify(file);
    // **Clean before the await, against the serialised copy above**: clearing it
    // afterwards would clear a flag a `set` raised mid-write, losing that
    // archive's directory. This way it re-dirties and the next flush carries it.
    this.archivesDirty = false;
    try {
      await writeAtomic(dir, ARCHIVES_FILE, text);
    } catch (err) {
      this.archivesDirty = true;
      throw err;
    }
  }

  // ---- maintenance ----

  /**
   * Reap what this build cannot use, then evict oldest-read-first under the cap.
   * Its own bound, separate from `ThumbCache.maintain()` (D2).
   */
  async maintain(): Promise<void> {
    const dir = await this.storeDir();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    const files: {
      path: string;
      size: number;
      lastRead: number;
      evictable: boolean;
    }[] = [];
    for (const name of names) {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile()) continue;
      // **Only once it is stale**: reaping on sight unlinks a live temp out from
      // under the `rename` about to commit it.
      if (name.endsWith(".tmp")) {
        if (Date.now() - info.mtimeMs > TMP_REAP_MS)
          await rm(path, { force: true });
        continue;
      }
      // Reaped here rather than on read, which stays pure.
      if (!(await this.usable(name, path))) {
        await rm(path, { force: true });
        // Or the next flush writes the file this sweep just deleted back.
        if (name === ARCHIVES_FILE) {
          this.archives = new Map();
          this.archivesDirty = false;
        }
        continue;
      }
      // `archives.json` counts against the cap but is never *evicted*: it is one
      // small file holding every zip tail in the library, so evicting it frees
      // nothing much and costs the next walk all of those seeks.
      files.push({
        path,
        size: info.size,
        lastRead: info.mtimeMs,
        evictable: name !== ARCHIVES_FILE,
      });
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= this.sizeCap) return;
    files.sort((a, b) => a.lastRead - b.lastRead);
    for (const f of files) {
      if (total <= this.sizeCap) break;
      if (!f.evictable) continue;
      await rm(f.path, { force: true });
      total -= f.size;
    }
  }

  private async usable(name: string, path: string): Promise<boolean> {
    if (name !== ARCHIVES_FILE && !name.startsWith("tree-")) return false;
    const parsed = await readJson<{ version?: unknown; library?: unknown }>(
      path,
    );
    if (parsed === null) return false;
    return (
      parsed.version === SNAPSHOT_VERSION &&
      parsed.library === (await this.libraryId())
    );
  }
}

/** Parse a JSON file, or null for absent, unreadable, torn or not-an-object. */
async function readJson<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;
  return parsed as T;
}
