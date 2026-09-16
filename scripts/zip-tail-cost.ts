/**
 * What a central-directory read costs, and what the archive layer saves — the
 * measurement `archive-interior-sheets` rests on, kept runnable rather than
 * quoted.
 *
 *   bun scripts/zip-tail-cost.ts <library root>
 *
 * Every `*.zip` under the root, read three times: cold, then through an
 * in-memory layer, then with no layer against a now-warm page cache. The
 * layer's value is the gap between the first two rows; the third is how much of
 * that the kernel was doing for free. Run under **Bun**, so the reader is the
 * one the server uses.
 *
 * The rows depend entirely on the hardware the library sits on — re-run on the
 * target before concluding anything from a figure measured elsewhere.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type ZipDirCache, listZipEntries } from "../server/src/zip";

const root = process.argv[2];
if (root === undefined) {
  console.error("usage: bun scripts/zip-tail-cost.ts <library root>");
  process.exit(2);
}

/** Every `*.zip` under `dir`, depth-first, skipping what cannot be read. */
async function archives(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await archives(path)));
    else if (e.isFile() && /\.zip$/i.test(e.name)) out.push(path);
  }
  return out;
}

/**
 * Drop each file's clean pages, so the next read is a real one.
 * `POSIX_FADV_DONTNEED` rather than `drop_caches`: it needs no root and drops
 * only these files. `fincore <file>` verifies it.
 */
async function dropCache(paths: readonly string[]): Promise<void> {
  // Neither Node nor Bun binds `posix_fadvise`, so this borrows Python's.
  // Without it the "cold" row is whatever the page cache held, and the pass
  // says so rather than reporting a warm number as cold.
  const script = [
    "import os,sys",
    'for p in sys.stdin.read().split("\\n"):',
    "    if not p: continue",
    "    try:",
    "        fd=os.open(p, os.O_RDONLY)",
    "        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)",
    "        os.close(fd)",
    "    except OSError: pass",
  ].join("\n");
  try {
    const proc = Bun.spawn(["python3", "-c", script], {
      stdin: "pipe",
      stderr: "ignore",
    });
    proc.stdin.write(paths.join("\n"));
    await proc.stdin.end();
    if ((await proc.exited) !== 0) throw new Error("fadvise helper failed");
  } catch {
    console.warn(
      'note: could not drop the page cache — the "cold" row is not cold',
    );
  }
}

const inMemoryLayer = (): ZipDirCache => {
  const held = new Map<
    string,
    { mtime: number; size: number; entries: unknown }
  >();
  return {
    get: async (p, id) => {
      const rec = held.get(p);
      if (rec === undefined || rec.mtime !== id.mtime || rec.size !== id.size)
        return undefined;
      return rec.entries as never;
    },
    set: async (p, id, entries) => {
      held.set(p, { mtime: id.mtime, size: id.size, entries });
    },
  };
};

async function pass(
  label: string,
  paths: readonly string[],
  cache?: ZipDirCache,
): Promise<{ ms: number; each: number[] }> {
  let ok = 0;
  let refused = 0;
  let entries = 0;
  const each: number[] = [];
  const t0 = performance.now();
  for (const p of paths) {
    const s = performance.now();
    try {
      const e = await listZipEntries(p, cache);
      each.push(performance.now() - s);
      ok++;
      entries += e.length;
    } catch {
      refused++;
    }
  }
  const ms = performance.now() - t0;
  console.log(
    `${label.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms   ok=${ok} refused=${refused} entries=${entries}`,
  );
  return { ms, each };
}

const paths = await archives(root);
console.log(`${paths.length} archives under ${root}\n`);

await dropCache(paths);
const cold = await pass("cold, no layer", paths);

const layer = inMemoryLayer();
await pass("warming the layer", paths, layer);
await pass("with the layer", paths, layer);
await pass("no layer, warm", paths);

const sorted = [...cold.each].sort((a, b) => a - b);
const q = (f: number): string =>
  (sorted[Math.floor(sorted.length * f)] ?? 0).toFixed(2);
console.log(
  `\ncold per archive: median ${q(0.5)} ms  p90 ${q(0.9)} ms  p99 ${q(0.99)} ms  max ${(sorted.at(-1) ?? 0).toFixed(1)} ms`,
);
