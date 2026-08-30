/**
 * The library: one marked tree, and the only translator between a request's
 * path and a filesystem path (library-root D1–D4).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * A library is a directory tree whose top carries
 * `.model-browser/library.json` — `{ "id": "<uuid>", "version": 1 }`. The
 * configured *root* is only where the app opens inside that tree: the library
 * is found by walking **up** from the root — as far as the mount it sits on —
 * until a marker appears, so re-picking a deeper folder is a change of
 * viewpoint and not of namespace (D1). Where that walk finds nothing, a bounded
 * probe *down* refuses a root that would enclose an existing library (R1).
 * Every path the app then handles is relative to the top, written with a
 * leading slash, so the top is `/` (D2).
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import type { LibraryState } from '../../shared/types'
import { joinVPath, parseVPath } from './vpath'
import { configHome } from './xdg'

/**
 * A request that cannot become a filesystem path. `status` is what the route
 * answers; the message never names a filesystem detail, because a refusal that
 * described what it found would be a probe of the volume it just refused.
 */
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}

/** The one refusal `resolve` gives for anything outside the tree. */
const OUTSIDE = 'path outside the library'

/**
 * Bounds on a request's path, tested before any filesystem call is made.
 *
 * `resolve`'s nearest-ancestor loop costs one `realpath` per component of a
 * path that does not exist, and the depth of that path is the requester's to
 * choose: a 4,000-component path measured ~53 ms against ~0.6 ms for an
 * ordinary one, from a request that names nothing at all. Both bounds sit far
 * above anything a real tree produces — 4096 is `PATH_MAX` on Linux, and a
 * library path is shorter than the filesystem path it becomes.
 */
const MAX_PATH_BYTES = 4096
const MAX_COMPONENTS = 256

/** The refusal for a path built to be expensive rather than to name a file. */
const TOO_LONG = 'path too long'

function tooLong(libPath: string): boolean {
  return (
    Buffer.byteLength(libPath) > MAX_PATH_BYTES ||
    libPath.split('/').length - 1 > MAX_COMPONENTS
  )
}

/**
 * The one spelling of a library path: the same split-then-normalise `resolve`
 * performs, with nothing else done to it. Pure — no filesystem is touched — so
 * a route can canonicalise once and then key a cache, name a temp file and echo
 * a listing by the string the resolver would itself have used.
 *
 * Without it each spelling of one file is its own key: `/kit/../kit/a.stl`
 * minted a second thumbnail entry beside `/kit/a.stl`, and `//kit` came back in
 * a listing's `path` verbatim, so the client's next request carried the
 * spelling forward.
 *
 * Only the filesystem half is normalised; the entry half is an opaque archive
 * name (D3). A trailing slash goes too — `/kit/` and `/kit` are one directory —
 * except at the root, whose whole spelling is that slash.
 */
export function canonicalLibPath(libPath: string): string {
  if (!libPath.startsWith('/')) throw new LibraryError('path must be a library path', 400)
  if (tooLong(libPath)) throw new LibraryError(TOO_LONG, 400)
  const { fsPath, entry } = parseVPath(libPath)
  let normalized = posix.normalize(fsPath)
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return entry === undefined ? normalized : joinVPath(normalized, entry)
}

export interface Resolved {
  /** Filesystem path — the file, or the containing zip for a virtual path. */
  fsPath: string
  /** Entry inside the zip, verbatim from the request. Undefined for plain paths. */
  entry?: string
}

export interface Library {
  /**
   * The current state. Every not-ready state is re-evaluated on each call, so a
   * volume mounted after start needs no restart. A `ready` library keeps its
   * identity — the marker is not re-read — but its top is stat'd per call, so a
   * volume unplugged *mid-session* answers `missing` rather than 404-ing every
   * path (D4).
   */
  state(): Promise<LibraryState>
  /** Re-evaluate config and marker from scratch, whatever the current state. */
  refresh(): Promise<LibraryState>
  /** The library top's resolved filesystem path. Throws unless `ready`. */
  realTop(): string
  /** The library's identity. Throws unless `ready`. */
  id(): string
  /** D3: the only way a request's path becomes a filesystem path. */
  resolve(libPath: string): Promise<Resolved>
  /** The reverse: an already-resolved real path under the top → its library path. */
  libPathOf(real: string): string
}

/** The marker's directory name — the home of every file this app keeps in a library. */
export const MARKER_DIR = '.model-browser'
const MARKER_FILE = 'library.json'

type Ready = Extract<LibraryState, { state: 'ready' }>

/** The root from the environment, else `root` in the config file (D4). */
async function configuredRoot(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const fromEnv = env.MODEL_BROWSER_ROOT
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const explicit = env.MODEL_BROWSER_CONFIG
  const file =
    explicit !== undefined && explicit !== ''
      ? explicit
      : join(configHome(env), 'model-browser', 'config.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // Absent, unreadable or malformed all mean the same thing: no root here.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const root = (parsed as Record<string, unknown>).root
  return typeof root === 'string' && root !== '' ? root : undefined
}

/**
 * The marker's id if `dir` carries one, else undefined — the one validity rule,
 * shared by the upward walk and the downward probe.
 *
 * A marker is a JSON *object* carrying a non-empty string `id`; unknown fields
 * are ignored, so a later version may add them. Anything else — unreadable,
 * malformed, an `id` that is not a string, or an empty one, which is no
 * identifier and would name a cache directory of `''` — is not a marker, and a
 * caller passes over it rather than adopting it.
 */
async function markerIdAt(dir: string): Promise<string | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(dir, MARKER_DIR, MARKER_FILE), 'utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const id = (parsed as Record<string, unknown>).id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** The device of a directory — what bounds the upward walk at a mount. */
async function deviceOf(dir: string): Promise<number> {
  return (await stat(dir)).dev
}

/**
 * The first marker at or above `start`, stopping at the mount `start` sits on.
 *
 * The walk climbs only while the parent is on the same device: a marker on
 * another filesystem is never adopted (D1). Unbounded, it made a stray
 * `.model-browser/library.json` in `$HOME` the top for any root beneath it,
 * re-basing every path and widening confinement to that whole tree. A parent
 * that cannot be stat'd ends the walk for the same reason — an ancestor this
 * process cannot see is not one it should adopt.
 *
 * `devOf` is injected so a test can place a boundary without mounting anything.
 *
 * @internal exported for tests
 */
export async function findMarker(
  start: string,
  devOf: (dir: string) => Promise<number> = deviceOf,
): Promise<{ top: string; id: string } | undefined> {
  let dir = start
  let startDev: number
  try {
    startDev = await devOf(start)
  } catch {
    // The root was stat'd as a directory a moment ago; if it cannot be stat'd
    // now there is nothing to walk from.
    return undefined
  }
  for (;;) {
    const id = await markerIdAt(dir)
    if (id !== undefined) return { top: dir, id }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    let parentDev: number
    try {
      parentDev = await devOf(parent)
    } catch {
      return undefined
    }
    if (parentDev !== startDev) return undefined
    dir = parent
  }
}

/**
 * Bounds on the downward probe below a root with no marker above it (R1).
 *
 * The depth bound is where the mistake actually lives: a root pointed one or
 * two folders above a drive's library is the case worth catching, and a library
 * buried five levels under a deliberately chosen root is not a mistake anyone
 * makes by accident. The read budget is what keeps a root pointed at a wide
 * tree from paying for a full descent — and it is paid on every `state()` call
 * while the state is not ready, not once at start. Both are best-effort by
 * design: running out is "not found", and the root becomes a library, which is
 * what happened before the probe existed.
 */
const PROBE_MAX_DEPTH = 4
const PROBE_MAX_DIRS = 500

/**
 * The shallowest library top beneath `start`, within the bounds above.
 *
 * Breadth-first, so a library at depth 1 is found before one at depth 3 — the
 * shallower is the one the root would enclose most of. Only `readdir`s count
 * against the budget: reading a marker is one open of a known name.
 */
async function findNestedLibrary(start: string): Promise<string | undefined> {
  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }]
  let read = 0
  // The queue is appended to while it is walked, which an array iterator
  // follows — it re-reads the length each step, so a directory pushed below
  // gets its turn after everything already queued. That ordering *is* the
  // breadth-first guarantee this function's callers rely on.
  for (const { dir, depth } of queue) {
    // `start` itself has already been tested by the upward walk.
    if (depth > 0 && (await markerIdAt(dir)) !== undefined) return dir
    if (depth === PROBE_MAX_DEPTH) continue
    if (read >= PROBE_MAX_DIRS) return undefined
    read++
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Unreadable is not a library; the rest of the level still gets its turn.
      continue
    }
    for (const e of entries) {
      // Dot-entries are skipped — the marker is opened by name above, never
      // enumerated — and a symlink's dirent is not `isDirectory()`, so the
      // probe never descends out of the tree it was pointed at.
      if (e.name.startsWith('.') || !e.isDirectory()) continue
      queue.push({ dir: join(dir, e.name), depth: depth + 1 })
    }
  }
  return undefined
}

/** Writes a fresh marker at `top`, or reports that the volume would not take one. */
async function writeMarker(top: string): Promise<string | undefined> {
  const id = randomUUID()
  try {
    await mkdir(join(top, MARKER_DIR), { recursive: true })
    await writeFile(join(top, MARKER_DIR, MARKER_FILE), `${JSON.stringify({ id, version: 1 })}\n`)
  } catch {
    return undefined
  }
  return id
}

function hashedId(realTop: string): string {
  return createHash('sha256').update(realTop).digest('hex')
}

/** A real path under `realTop` as a library path; `/` for the top itself. */
function toLibPath(realTop: string, real: string): string | undefined {
  if (real === realTop) return '/'
  if (!real.startsWith(realTop + sep)) return undefined
  return `/${relative(realTop, real).split(sep).join(posix.sep)}`
}

export function createLibrary(env: NodeJS.ProcessEnv = process.env): Library {
  /**
   * What a successful evaluation settled on: the library, and the root string
   * that was configured to find it. The root is kept verbatim because it is
   * what a later `missing` has to name — the state the top's own stat produces
   * once the volume goes away, when the configured spelling is the only thing
   * the user can act on.
   */
  let settled: { ready: Ready; root: string } | undefined

  async function evaluate(): Promise<LibraryState> {
    const root = await configuredRoot(env)
    if (root === undefined) return { state: 'unconfigured' }
    try {
      if (!(await stat(root)).isDirectory()) return { state: 'missing', root }
    } catch {
      // Not present at all — the usual shape of an unmounted volume.
      return { state: 'missing', root }
    }
    const realRoot = await realpath(root)
    const found = await findMarker(realRoot)
    if (found !== undefined) {
      // The root is a viewpoint inside the marked tree, not the tree.
      settled = {
        ready: {
          state: 'ready',
          id: found.id,
          top: found.top,
          root: toLibPath(found.top, realRoot) ?? '/',
        },
        root,
      }
      return settled.ready
    }
    // Nothing above it — so look *below* before claiming the root. A root
    // chosen above an existing library would otherwise write a marker over it:
    // the inner library's cache is orphaned, its cameras with it, and the only
    // signal is a line in the log (R1). The probe is bounded and runs only on
    // this branch, so a library that is already marked pays nothing for it.
    const nested = await findNestedLibrary(realRoot)
    if (nested !== undefined) return { state: 'nested', root, library: nested }
    // No library either way: the root becomes one, if the volume will say so.
    const written = await writeMarker(realRoot)
    settled = {
      ready:
        written === undefined
          ? { state: 'ready', id: hashedId(realRoot), top: realRoot, root: '/', unmarked: true }
          : { state: 'ready', id: written, top: realRoot, root: '/' },
      root,
    }
    return settled.ready
  }

  function requireReady(): Ready {
    if (settled === undefined) throw new Error('the library is not ready')
    return settled.ready
  }

  return {
    async state() {
      const current = settled
      // Not settled yet: every not-ready state is a question about the
      // filesystem right now, and is asked again every time.
      if (current === undefined) return evaluate()
      // Settled, but the tree it named can still go away under a running
      // server. One `stat` per request buys the difference between "the
      // library is not present" and a 404 on every path in it.
      //
      // Measured on the removable volume this library lives on, warm (the top
      // is in the dentry cache after the first call, which is the state every
      // request after the first finds it in): `os.stat` ×1000 against the
      // mounted top /run/media/masa/STLLibrary took 1.72 ms in total — ~1.7 µs
      // a call — and 2.17 ms against a path that is not there. W1's run,
      // 2026-08-29; the coordinator's run the same day read 2.03 ms for the
      // first of those. Either way one stat per request is free beside the
      // `realpath` the same request already pays (D3). Re-run:
      //   python3 -c "import os,time; p='/run/media/masa/STLLibrary'; os.stat(p); \
      //     t=time.perf_counter(); [os.stat(p) for _ in range(1000)]; \
      //     print((time.perf_counter()-t)*1e3, 'ms')"
      const top = await stat(current.ready.top).catch(() => null)
      if (top !== null && top.isDirectory()) return current.ready
      // The cached `ready` is deliberately *not* discarded: the same tree
      // returning at the same place is the same library, and `realTop()`/`id()`
      // keep answering meanwhile — the cache's own sweep guard reads them to
      // decide it must not run (`ThumbCache.maintain`).
      return { state: 'missing', root: current.root }
    },

    async refresh() {
      settled = undefined
      return evaluate()
    },

    realTop: () => requireReady().top,
    id: () => requireReady().id,

    async resolve(libPath) {
      const realTop = requireReady().top
      if (!libPath.startsWith('/')) throw new LibraryError('path must be a library path', 400)
      // Before any filesystem call: the loop below pays per component of a path
      // that is not there, so its length is a cost the request chooses.
      if (tooLong(libPath)) throw new LibraryError(TOO_LONG, 400)
      // The virtual path splits **first**: only the filesystem half is a path
      // in this tree. The entry half is an opaque archive name — normalising it
      // would rewrite a cache key that is the string itself.
      const { fsPath, entry } = parseVPath(libPath)
      const normalized = posix.normalize(fsPath)
      // The marker directory is this app's own corner of the library — its
      // identity, and the home of every file the app keeps beside the models.
      // Listings and completions already hide it; refusing it here is what
      // keeps it unreadable by a request that spells it out. Refused as
      // "outside", because that is what it is from the browsing side: the
      // library is the models, and this is the app's own file.
      if (normalized.split('/')[1] === MARKER_DIR) throw new LibraryError(OUTSIDE, 400)
      const candidate = join(realTop, normalized)

      // Confinement is decided on the nearest ancestor that exists, so a path
      // that is merely absent (a completion prefix, a deleted folder, a thumb
      // PUT racing a delete) is the route's ordinary 404 rather than either a
      // refusal or an ENOENT escaping from here.
      let anchor = candidate
      const missing: string[] = []
      let anchorReal: string
      for (;;) {
        try {
          anchorReal = await realpath(anchor)
          break
        } catch {
          // Every `realpath` failure is read as "this component is not there",
          // ENOENT and EACCES and ELOOP and ENOTDIR alike. Deliberate, not an
          // oversight: the confinement test below still runs against the
          // nearest ancestor that *did* resolve, so a component this process
          // cannot traverse can never widen the answer — and opening the file
          // afterwards needs exactly the rights `realpath` was refused, so an
          // unreadable ancestor becomes the route's own error rather than
          // access to anything.
          const parent = dirname(anchor)
          // The filesystem root always resolves, so this terminates.
          if (parent === anchor) throw new LibraryError(OUTSIDE, 400)
          missing.unshift(basename(anchor))
          anchor = parent
        }
      }
      if (anchorReal !== realTop && !anchorReal.startsWith(realTop + sep)) {
        throw new LibraryError(OUTSIDE, 400)
      }
      return { fsPath: missing.length === 0 ? anchorReal : join(anchorReal, ...missing), entry }
    },

    libPathOf(real) {
      const libPath = toLibPath(requireReady().top, real)
      if (libPath === undefined) throw new LibraryError(OUTSIDE, 400)
      return libPath
    },
  }
}
