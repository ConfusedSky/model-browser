/**
 * The derived-GLB store (server-glb-cache D5): one `.glb` per model, under
 * `<cache>/<id>/mesh/`, in the pattern of `snapshot.ts`. A **subdirectory**,
 * because `ThumbCache.maintain` reads every `*.json` at the id level as a
 * sidecar and ignores subdirectories, so `mesh/` sits beside `snapshots/` and
 * `bake/` untouched.
 *
 * No LRU: the cache holds at most one GLB per model, overwritten in place when
 * stale, so it is bounded by the library at ~0.24x its STL bytes. Staleness is
 * the source's mtime, carried onto the cache file with `utimes` — a hit is the
 * cache file's mtime matching the source's.
 */

import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Library } from "./library";

export const MESH_DIR = "mesh";

/** `utimes` from a `Date` stores integer-millisecond precision, and a source's
 *  `mtimeMs` can be fractional, so a hit tolerates sub-millisecond drift rather
 *  than demanding exact float equality that the write can never reproduce. */
const MTIME_TOLERANCE_MS = 1;

export class MeshCache {
  constructor(
    readonly dir: string = process.env.MODEL_BROWSER_CACHE ??
      join(homedir(), ".cache", "model-browser"),
    /** Omitting it is test-only: entries then live flat, no identity checked. */
    private readonly library?: Library,
  ) {}

  private async meshDir(): Promise<string> {
    if (this.library === undefined) return join(this.dir, MESH_DIR);
    await this.library.state();
    return join(this.dir, this.library.id(), MESH_DIR);
  }

  /** Hashed because a library path is not a file name. */
  private file(dir: string, libPath: string): string {
    const key = createHash("sha256").update(libPath).digest("hex");
    return join(dir, `${key}.glb`);
  }

  /** The cached GLB for `libPath` if one exists and matches `sourceMtimeMs`,
   *  else null (a miss or a stale entry). */
  async read(libPath: string, sourceMtimeMs: number): Promise<Buffer | null> {
    const file = this.file(await this.meshDir(), libPath);
    const s = await stat(file).catch(() => null);
    if (s === null || Math.abs(s.mtimeMs - sourceMtimeMs) >= MTIME_TOLERANCE_MS)
      return null;
    return readFile(file);
  }

  /** Write `bytes` for `libPath` and stamp it with the source's mtime. Writes to
   *  a temporary sibling and renames, so a concurrent reader never sees a torn
   *  file; two concurrent misses both convert and the second rename wins
   *  harmlessly. Throws on a read-only cache dir — the caller serves anyway. */
  async write(
    libPath: string,
    bytes: ArrayBuffer,
    sourceMtimeMs: number,
  ): Promise<void> {
    const dir = await this.meshDir();
    await mkdir(dir, { recursive: true });
    const target = this.file(dir, libPath);
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`;
    try {
      const handle = await open(temp, "w");
      try {
        await handle.writeFile(new Uint8Array(bytes));
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } catch (err) {
      await unlink(temp).catch(() => undefined);
      throw err;
    }
    const when = new Date(sourceMtimeMs);
    await utimes(target, when, when);
  }
}
