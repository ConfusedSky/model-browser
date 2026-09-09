/**
 * What a central-directory read costs, and what the archive layer saves.
 *
 * The measurement `archive-interior-sheets` rests on, kept runnable rather than
 * quoted: `folder-contact-sheets` justified never previewing zip tiles with
 * 6.7 s of archive-tail seeks across the library, and that figure did not
 * reproduce here. Rather than argue with it, re-run this.
 *
 *   bun scripts/zip-tail-cost.ts <library root>
 *
 * Reads every `*.zip` under the root three times: cold (page cache dropped per
 * file with `POSIX_FADV_DONTNEED`, which needs no root), then through an
 * in-memory layer of the shape `SnapshotStore.archiveCache()` returns, then
 * with no layer against a now-warm page cache. The three rows are the whole
 * argument — the layer's value is the gap between the first and the second, and
 * the third is how much of that the kernel was already doing for free.
 *
 * Run under **Bun**, against the real module: the server is Bun and the reader
 * is the one it uses.
 *
 * Recorded on 2026-09-09, /run/media/masa/STLLibrary (139 GB, WD SN740 NVMe
 * behind a USB bridge, ext4):
 *
 *   453 archives, 13,168 entries, 1 refused (zip64)
 *   cold, no layer      246 ms   (median 0.48, p90 0.77, p99 1.51, max 2.0 ms)
 *   with the layer        7 ms
 *   no layer, warm       67 ms
 *
 * Run to run the cold row moves a few percent and the warm row rather more;
 * what is stable is the shape — cold is ~4x warm, and the layer is ~10x warm
 * again.
 *
 * A spindle is the case that figure is missing: 453 tail seeks at ~10 ms is
 * ~4.5 s, which is where 6.7 s plausibly came from. Re-run there before
 * concluding anything about hardware this was not measured on.
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type ZipDirCache, listZipEntries } from '../server/src/zip'

const root = process.argv[2]
if (root === undefined) {
  console.error('usage: bun scripts/zip-tail-cost.ts <library root>')
  process.exit(2)
}

/** Every `*.zip` under `dir`, depth-first, skipping what cannot be read. */
async function archives(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const path = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await archives(path)))
    else if (e.isFile() && /\.zip$/i.test(e.name)) out.push(path)
  }
  return out
}

/**
 * Drop each file's clean pages, so the next read is a real one.
 *
 * `POSIX_FADV_DONTNEED` rather than `/proc/sys/vm/drop_caches`: it needs no
 * root, and it drops exactly these files instead of the whole system's cache.
 * Verify with `fincore <file>` — zero resident pages is what makes the cold row
 * cold.
 */
async function dropCache(paths: readonly string[]): Promise<void> {
  // Neither Node nor Bun exposes `posix_fadvise`, so this borrows Python's —
  // the same call, in the one runtime on hand that binds it. Without it the
  // "cold" row is whatever the page cache happened to be holding, and the pass
  // says so rather than quietly reporting a warm number as cold.
  const script = [
    'import os,sys',
    'for p in sys.stdin.read().split("\\n"):',
    '    if not p: continue',
    '    try:',
    '        fd=os.open(p, os.O_RDONLY)',
    '        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)',
    '        os.close(fd)',
    '    except OSError: pass',
  ].join('\n')
  try {
    const proc = Bun.spawn(['python3', '-c', script], { stdin: 'pipe', stderr: 'ignore' })
    proc.stdin.write(paths.join('\n'))
    await proc.stdin.end()
    if ((await proc.exited) !== 0) throw new Error('fadvise helper failed')
  } catch {
    console.warn('note: could not drop the page cache — the "cold" row is not cold')
  }
}

const inMemoryLayer = (): ZipDirCache => {
  const held = new Map<string, { mtime: number; size: number; entries: unknown }>()
  return {
    get: async (p, id) => {
      const rec = held.get(p)
      if (rec === undefined || rec.mtime !== id.mtime || rec.size !== id.size) return undefined
      return rec.entries as never
    },
    set: async (p, id, entries) => {
      held.set(p, { mtime: id.mtime, size: id.size, entries })
    },
  }
}

async function pass(
  label: string,
  paths: readonly string[],
  cache?: ZipDirCache,
): Promise<{ ms: number; each: number[] }> {
  let ok = 0
  let refused = 0
  let entries = 0
  const each: number[] = []
  const t0 = performance.now()
  for (const p of paths) {
    const s = performance.now()
    try {
      const e = await listZipEntries(p, cache)
      each.push(performance.now() - s)
      ok++
      entries += e.length
    } catch {
      refused++
    }
  }
  const ms = performance.now() - t0
  console.log(
    `${label.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms   ok=${ok} refused=${refused} entries=${entries}`,
  )
  return { ms, each }
}

const paths = await archives(root)
console.log(`${paths.length} archives under ${root}\n`)

await dropCache(paths)
const cold = await pass('cold, no layer', paths)

const layer = inMemoryLayer()
await pass('warming the layer', paths, layer)
await pass('with the layer', paths, layer)
await pass('no layer, warm', paths)

const sorted = [...cold.each].sort((a, b) => a - b)
const q = (f: number): string => (sorted[Math.floor(sorted.length * f)] ?? 0).toFixed(2)
console.log(
  `\ncold per archive: median ${q(0.5)} ms  p90 ${q(0.9)} ms  p99 ${q(0.99)} ms  max ${(sorted.at(-1) ?? 0).toFixed(1)} ms`,
)
