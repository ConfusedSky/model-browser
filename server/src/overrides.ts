/**
 * The library's override store: per-entry display names, credits and poses,
 * kept in one file beside the library marker (D1).
 *
 * `<library>/.model-browser/overrides.json`, keyed by canonical library path.
 * Directory keys cover their subtree by longest prefix, merged **per field**,
 * so a kit's credits reach every model under it while a file key carrying only
 * a pose keeps them (D2). `name` is the one field that does not inherit.
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1). The only writer
 * in the tree today is `scripts/gen-overrides.ts`, which uses `writeOverrides`
 * from here so there is exactly one atomic-write implementation (D5).
 */

import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirEntry, OverrideEntry, ResolvedOverrides } from '../../shared/types'
import { MARKER_DIR, type Library, canonicalLibPath } from './library'
import { joinVPath, parseVPath } from './vpath'

/** The store's file name, inside `MARKER_DIR` beside `library.json`. */
export const STORE_FILE = 'overrides.json'

/**
 * The one format version this build reads. A file carrying anything else is
 * reported and treated as empty rather than guessed at: additive evolution
 * happens *within* version 1 (unknown fields are preserved by writers and
 * ignored by resolution), so a bump is a deliberate break, and an older reader
 * silently dropping a corpus's credits is exactly the CC-BY compliance hole the
 * report exists to close (D1).
 */
const VERSION = 1

/** The loaded store: canonical library path → the fields stored at that key. */
export type OverrideStore = ReadonlyMap<string, OverrideEntry>

/** An absent, unreadable or unusable store — the answer is "no overrides". */
const EMPTY: OverrideStore = new Map()

/** The store file as it sits on disk, unknown fields and all. */
export interface OverridesFile {
  version: number
  entries: Record<string, OverrideEntry>
  [field: string]: unknown
}

/**
 * Where a load's complaints go. Injected so a test can collect them; the
 * default prints, which is what puts a malformed-store report beside the
 * `library <id> at <top>` startup line when `index.ts` loads eagerly (D1).
 */
export type Report = (message: string) => void

const defaultReport: Report = (message) => {
  console.warn(message)
}

/**
 * The store spelling of a key read from the file, or why it has none.
 *
 * `canonicalLibPath` normalises only the filesystem half and drops its trailing
 * slash, so `/kit/` — the natural hand-edit spelling for a directory — becomes
 * `/kit` here rather than silently matching nothing (D2). The entry half is
 * opaque to it, so two archive-side spellings are handled on top:
 *
 * - a trailing slash is stripped, because zip listings commonly spell a
 *   directory entry `parts/` and an unstripped `/kit/a.zip!/parts/` would never
 *   match the walk's `/kit/a.zip!/parts`;
 * - an *empty* entry half (`…!/`) is refused outright. The archive file's own
 *   path is the one key for the archive and its interior root, so a second
 *   zip-root spelling could only ever disagree with it.
 */
function storeKey(raw: string): { key: string } | { error: string } {
  let canonical: string
  try {
    canonical = canonicalLibPath(raw)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'not a library path' }
  }
  const { fsPath, entry } = parseVPath(canonical)
  if (entry === undefined) return { key: canonical }
  const trimmed = entry.endsWith('/') ? entry.slice(0, -1) : entry
  if (trimmed === '') {
    return { error: "an empty archive-entry half (`…!/`) is not a key; use the archive's own path" }
  }
  return { key: joinVPath(fsPath, trimmed) }
}

/**
 * The store at `top`, or an empty one.
 *
 * Absent is empty and **silent** — most libraries have no store and owe none.
 * Unparseable, structurally wrong, or carrying an unknown version is empty and
 * *reported*: a broken store must not take the library down (browsing owes it
 * nothing) but must not be silent either, because its one consumer surface —
 * credits quietly absent — is where a swallowed error would hide forever (D1).
 */
export async function loadOverrides(
  top: string,
  report: Report = defaultReport,
): Promise<OverrideStore> {
  const file = join(top, MARKER_DIR, STORE_FILE)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return EMPTY
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    report(`overrides: ${file} is not valid JSON — ignored`)
    return EMPTY
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    report(`overrides: ${file} is not an object — ignored`)
    return EMPTY
  }
  const { version, entries } = parsed as Record<string, unknown>
  if (version !== VERSION) {
    report(`overrides: ${file} has unknown version ${JSON.stringify(version)} — ignored`)
    return EMPTY
  }
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    report(`overrides: ${file} has no entries object — ignored`)
    return EMPTY
  }
  const store = new Map<string, OverrideEntry>()
  for (const [raw, value] of Object.entries(entries as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      report(`overrides: ${file}: ignoring key ${JSON.stringify(raw)} — its value is not an object`)
      continue
    }
    const spelled = storeKey(raw)
    if ('error' in spelled) {
      report(`overrides: ${file}: ignoring key ${JSON.stringify(raw)} — ${spelled.error}`)
      continue
    }
    // Two spellings that canonicalise to one key are one key, and the last one
    // read wins. Deliberately unreported: nothing is lost that the file did not
    // already say twice, and a line about it would be noise on every load.
    store.set(spelled.key, value as OverrideEntry)
  }
  return store
}

/**
 * Every key that can speak for `libPath`, root first and the entry's own key
 * last — the **parse-then-walk** list (D2).
 *
 * Not `libPath.split('/')`: a virtual path splits on the first `!/` (the
 * grammar `parseVPath` implements), so splitting `/kit/a.zip!/parts/x.stl` on
 * slashes yields the segment `a.zip!` and would never produce the key
 * `/kit/a.zip` — the archive's own key, and the one a kit's credits are written
 * on. So the halves are parsed apart first: the root, then each directory of
 * the filesystem half ending at the half itself (which *is* the archive file's
 * path when there is an entry half), then each interior directory of the entry
 * half, ending at the full key.
 *
 * Boundaries are structural rather than string prefixes — the list is built by
 * joining segments — so `/kit` can never be an ancestor of `/kit2/y.stl`.
 *
 * A lookup whose entry half is empty (the `…!/` zip-root spelling) ends at the
 * archive file's path, which is what makes it resolve exactly as that path does.
 */
function ancestorKeys(libPath: string): string[] {
  const { fsPath, entry } = parseVPath(libPath)
  const keys: string[] = ['/']
  let acc = ''
  for (const segment of fsPath.split('/')) {
    if (segment === '') continue
    acc = `${acc}/${segment}`
    keys.push(acc)
  }
  if (entry === undefined || entry === '') return keys
  let inner = ''
  for (const segment of entry.split('/')) {
    if (segment === '') continue
    inner = inner === '' ? segment : `${inner}/${segment}`
    keys.push(joinVPath(fsPath, inner))
  }
  return keys
}

/**
 * An entry's effective overrides.
 *
 * `name` does not inherit (D2/D7). It resolves from the **last** ancestor key
 * rather than from `libPath` itself, and the distinction is load-bearing:
 * a zip-root lookup's last ancestor is the archive file's own path, so it
 * inherits that key's name the way the requirement's "resolves exactly as the
 * archive file's own path does" demands — while `store.get(libPath)` would find
 * nothing, since `…!/` is a key spelling the loader forbids and no key could
 * ever be written in it. A trailing-slash lookup lands on the same key its
 * directory does for the same reason.
 *
 * Inherited, a kit's name would label the kit tile *and* all thirty models
 * beneath it identically — the generator writes one `name` per kit directory.
 */
export function resolveOverrides(store: OverrideStore, libPath: string): ResolvedOverrides {
  const keys = ancestorKeys(libPath)
  const resolved: ResolvedOverrides = {}
  // The inheriting fields, assigned one by one rather than through a loop over
  // a field list: `credits` inherits because attribution genuinely covers
  // everything under the key it was written on, and `pose` so that a
  // directory-level default is expressible. Each is merged **whole**, nearest
  // key winning that field independently of the others (D2) — which is what
  // lets the generator (directory keys) and a later pose writer (file keys)
  // compose without either knowing the other exists. A field the file carries
  // that is not named here is preserved on disk by writers and ignored here;
  // that is what makes additive evolution need no version bump.
  for (const key of keys) {
    const entry = store.get(key)
    if (entry === undefined) continue
    if (entry.credits !== undefined) resolved.credits = entry.credits
    if (entry.pose !== undefined) resolved.pose = entry.pose
  }
  const exact = store.get(keys[keys.length - 1]!)
  if (exact?.name !== undefined) resolved.name = exact.name
  return resolved
}

/**
 * The stored display name for an exact library path — a Map get, no I/O and no
 * prefix walk, which is what makes it affordable per listing entry (D7).
 */
export function displayNameOf(store: OverrideStore, libPath: string): string | undefined {
  return store.get(libPath)?.name
}

/**
 * Attach stored display names to a listing, in place, at the point the listing
 * becomes wire bytes (D7).
 *
 * The seam is here rather than inside `listing.ts` because a listing leaves
 * that module by five paths and only three of them run through `wire` — the two
 * `listZipDir` branches of `listDir` return their entries directly — so one
 * pass over the emitted array is what covers browse, flat/deep search, peek and
 * archive interiors alike, without threading a lookup through three exported
 * signatures.
 *
 * **Exact key, never the prefix resolution**: a kit's name labels the kit's own
 * tile and nothing beneath it. An empty store touches nothing, so a library
 * without one emits byte-identical listings.
 */
export function applyDisplayNames(entries: DirEntry[], store: OverrideStore): void {
  if (store.size === 0) return
  for (const entry of entries) {
    const name = store.get(entry.path)?.name
    if (name !== undefined) entry.displayName = name
  }
}

/**
 * Replace the store at `top` atomically and durably: write a temp file beside
 * it, fsync it, then rename over the target. A torn write can never replace a
 * valid store with half of one — a reader sees the old file or the new one.
 *
 * The temp file is dot-prefixed and lives in `MARKER_DIR`, which is invisible
 * to listings twice over. It is removed if anything fails, so a failed write
 * leaves the directory as it found it.
 *
 * The directory fsync afterwards is what makes the *rename* durable rather than
 * just the bytes; it is best-effort because not every filesystem this library
 * can live on (exFAT, notably) supports it, and a store that survives to the
 * page cache is the same store either way.
 */
export async function writeOverrides(top: string, file: OverridesFile): Promise<void> {
  const dir = join(top, MARKER_DIR)
  await mkdir(dir, { recursive: true })
  const target = join(dir, STORE_FILE)
  const temp = join(dir, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`)
  try {
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, target)
  } catch (err) {
    await unlink(temp).catch(() => undefined)
    throw err
  }
  const dirHandle = await open(dir, 'r').catch(() => null)
  if (dirHandle !== null) {
    await dirHandle.sync().catch(() => undefined)
    await dirHandle.close().catch(() => undefined)
  }
}

/** Holds the store for whichever library is currently resolved. */
export interface OverrideHolder {
  /**
   * The store for the library as it stands right now — empty while the library
   * is not ready, loaded once per resolved library otherwise.
   */
  store(): Promise<OverrideStore>
}

/**
 * The store's lifetime: per **resolved library**, never per process (D1).
 *
 * A library can be `unconfigured` or `missing` at start and resolve `ready`
 * later, and its identity can change mid-process — so a store cached per
 * process would keep serving library A's credits for library B's paths, and
 * displayed attribution is a CC-BY license term, which makes that a compliance
 * defect rather than staleness.
 *
 * The mechanism is a **compare, not a hook**: `Library` exposes no event on
 * settling (its six members are `state`, `refresh`, `realTop`, `id`, `resolve`
 * and `libPathOf`), and adding one would mean editing `library.ts`. So the
 * holder keeps `{identity, store}` and compares it against `state()`'s ready
 * answer, reloading on mismatch. That costs one extra `stat` on a settled
 * library — ~1.7 µs warm, per `library.ts`'s own measurement — beside the one
 * the gate middleware already paid for the same request.
 *
 * Single-flighted for the reason `Library.state()` is: the client's boot hits
 * the server with a dozen requests at once, and without it each would load the
 * file and print the same complaint about it.
 *
 * Within one resolution the file is read exactly once — the same
 * restart-after-editing rule `launch.json` has, which the generator's output
 * reminds the user of.
 */
export function createOverrideHolder(
  library: Library,
  report: Report = defaultReport,
): OverrideHolder {
  let held: { id: string; top: string; store: OverrideStore } | undefined
  let pending: Promise<OverrideStore> | undefined

  async function current(): Promise<OverrideStore> {
    const state = await library.state()
    if (state.state !== 'ready') return EMPTY
    if (held !== undefined && held.id === state.id && held.top === state.top) return held.store
    const store = await loadOverrides(state.top, report)
    held = { id: state.id, top: state.top, store }
    return store
  }

  return {
    store() {
      return (pending ??= current().finally(() => {
        pending = undefined
      }))
    },
  }
}
