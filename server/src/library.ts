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
import type { DeploymentConfig, LibraryState } from '../../shared/types'
import { joinVPath, parseVPath } from './vpath'

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
   * The current state. A not-ready state is re-evaluated on each call, so a
   * volume mounted after start needs no restart — except `nested`, whose answer
   * costs a tree walk and stands for `NESTED_RECHECK_MS` before being asked
   * again. A `ready` library keeps its identity, and its top is stat'd per
   * call, so a volume unplugged *mid-session* answers `missing` rather than
   * 404-ing every path (D4). The marker is re-read on exactly one transition —
   * the top present again after an absence — so a *different* tree arriving at
   * the same mount point is a different library rather than an inheritor of
   * this one's identity.
   *
   * Concurrent calls share one evaluation: the whole body is single-flighted,
   * because everything it decides it decides across `await`s.
   */
  state(): Promise<LibraryState>
  /**
   * Re-evaluate marker and probe from scratch against the filesystem as it is
   * now, whatever the current state — the seam a later repoint-without-restart
   * works through (D4). Nothing is carried over: the settled library, the
   * pending return-transition and the `nested` memo are all dropped first.
   *
   * It does **not** re-read the configuration file, which is parsed once at
   * start (public-deployment D2). An explicit re-read is the seam Electron's
   * file dialog will need; it stays named rather than built speculatively,
   * because nothing outside this module calls `refresh()` today.
   */
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

/**
 * The `ready` state as the **server** holds it. `top` is optional on the wire —
 * a deployment may declare the host none of the viewer's business and withhold
 * it (`public-deployment` D11) — but a library that is ready always knows its
 * own top, and everything below (`realTop`, `resolve`, `libPathOf`, the marker
 * re-read) needs it. Narrowed once here, so the wire's optionality stays a fact
 * about answers rather than leaking into what this module is sure of.
 */
type Ready = Extract<LibraryState, { state: 'ready' }> & { top: string }

/**
 * The root: the environment's, else the configuration's (D4).
 *
 * **Pure, and it opens no file** (public-deployment D2, task 1.2a). Reading
 * `config.json` from here is what made the file re-parsed on every request
 * while the library was unsettled, since `evaluate` re-runs to re-ask the
 * *filesystem* and dragged the file read along with it. The file is now parsed
 * exactly once, by `config.ts` at start, and handed to `createLibrary`; this
 * function keeps the precedence and nothing else.
 *
 * `MODEL_BROWSER_ROOT` is re-read per evaluation rather than baked, so a test
 * that repoints it and calls `refresh()` still works, and `loadConfig` applies
 * the same override to the value it returns — the two agree by construction,
 * because they apply one rule.
 */
function configuredRoot(env: NodeJS.ProcessEnv, config: DeploymentConfig): string | undefined {
  const fromEnv = env.MODEL_BROWSER_ROOT
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  return config.root !== undefined && config.root !== '' ? config.root : undefined
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
 * Undefined means "no marker to adopt". A start that cannot be stat'd at all is
 * not that answer and **throws** — the volume went away mid-evaluation, and the
 * caller must not settle an identity on it.
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
    // "Cannot see the start" is not "no marker here", and reporting it as one
    // would be settled on: the caller would write no marker, hash the root's
    // path for an identity and keep it for the process's life, so the volume
    // coming back with its real marker would be served under the hash (F6).
    // Thrown instead, and caught by `evaluate` as the `missing` this is.
    throw new Error('the library root cannot be read')
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
 * makes by accident.
 *
 * `PROBE_MAX_VISITS` bounds the directories *visited* — one bound, counted
 * where a directory leaves the queue, and the queue is capped at the same
 * number so nothing beyond it is ever enqueued. Every per-directory cost is
 * therefore bounded by it and by nothing else: at most 2000 `readdir`s, at most
 * 2000 marker opens, at most 2000 queue entries held. An earlier version
 * budgeted the `readdir`s alone and let the queue fill freely, which bounded
 * neither the marker opens nor the memory, and every one of them was paid on
 * *every* request while the state was not ready.
 *
 * Re-run: build the fixture with
 *   python3 -c "import os
 *   [os.makedirs('wide/kit-%d/sub-%d'%(i,j)) for i in range(600) for j in range(300)]"
 * `chmod 0555 wide` so the marker cannot be written and the evaluation is
 * repeatable, and time `createLibrary({MODEL_BROWSER_ROOT: wide}).refresh()`
 * while logging `visited` and `queue.length` where `findNestedLibrary` returns.
 * R2-A's run, 2026-08-30, vitest on tmpfs, three evaluations each: the old
 * read budget queued 150,301 directories and marker-opened 150,300 of them for
 * 500 `readdir`s, at 3003/2893/2855 ms an evaluation; this one queues and
 * visits 2000, at 138/132/135 ms. (The review that found this reported ~570 ms
 * for the old shape rather than ~2.9 s — a different machine or a warmer cache;
 * the ratio, ~21×, is what the constant is chosen against.)
 *
 * What that buys, exactly:
 *
 * - A root with **fewer than `PROBE_MAX_VISITS` direct children** has every one
 *   of them marker-checked, whatever order the filesystem listed them in. This
 *   is the case R1 is about — a drive whose library sits one folder down — and
 *   it is order-free.
 * - Beyond that, and at depth ≥ 2 in any tree wide enough to fill the queue,
 *   what is examined is "the first `PROBE_MAX_VISITS` directories breadth-first
 *   **in the order the filesystem lists them**". That order is not stable
 *   across runtimes — Node's `readdir` sorts what libuv returns, Bun's does not
 *   — so at depth ≥ 2 in a wide tree the probe's answer is genuinely
 *   order-dependent, and no test may assume otherwise.
 *
 * Both bounds are best-effort by design: running out is "not found", and the
 * root becomes a library, which is what happened before the probe existed.
 */
const PROBE_MAX_DEPTH = 4
const PROBE_MAX_VISITS = 2000

/**
 * The shallowest library top beneath `start`, within the bounds above.
 *
 * Breadth-first, so a library at depth 1 is found before one at depth 3 — the
 * shallower is the one the root would enclose most of.
 */
async function findNestedLibrary(start: string): Promise<string | undefined> {
  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }]
  let visited = 0
  // The queue is appended to while it is walked, which an array iterator
  // follows — it re-reads the length each step, so a directory pushed below
  // gets its turn after everything already queued. That ordering *is* the
  // breadth-first guarantee this function's callers rely on. Nothing is ever
  // shifted off, so `queue.length` is the number of directories ever pushed,
  // which is what the push guard below tests.
  for (const { dir, depth } of queue) {
    if (visited >= PROBE_MAX_VISITS) break
    visited++
    // `start` itself has already been tested by the upward walk.
    if (depth > 0 && (await markerIdAt(dir)) !== undefined) return dir
    if (depth === PROBE_MAX_DEPTH) continue
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
      // Memory, and only memory: nothing past the 2000th entry is ever
      // dequeued, so truncating the pushes here cannot change which
      // directories are examined — it stops the queue holding the ones that
      // would never get a turn, which is why no test can tell it apart and
      // this comment is the record instead. Measured 2026-08-30 (R2-A) on a
      // root of 600 directories of 300 entries each, built with
      //   python3 -c "import os
      //   [os.makedirs('wide/kit-%d/sub-%d'%(i,j)) for i in range(600) for j in range(300)]"
      // and logging `queue.length` beside `visited` where this function
      // returns: 2000 queued with this line, 180,601 without it, 2000 visited
      // either way.
      if (queue.length >= PROBE_MAX_VISITS) break
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

/**
 * How long a `nested` answer stands before the probe is paid for again.
 *
 * A not-ready state is a question about the filesystem right now, so the gate
 * asks it on every request — and `nested` is the one not-ready answer that
 * costs a tree walk to produce rather than a `stat`: 138 ms over the 600×300
 * fixture `PROBE_MAX_VISITS` documents, even bounded at 2000 visits. Memoised,
 * the walk runs at most once per window however many requests arrive (a
 * client's boot burst is a dozen), and the state is still self-correcting: the
 * user repoints the root or moves the inner library and the next window sees
 * it. Five seconds is chosen against a human at a file manager, not against a
 * poller.
 */
const NESTED_RECHECK_MS = 5000

/**
 * @param env  the process environment; a parameter so a test points the whole
 *             chain at a temp tree without mutating the process.
 * @param config  the deployment's configuration, **already parsed**
 *                (`config.ts`, read once at start). Defaulted to `{}` so a
 *                caller with no file — every test that drives the root from
 *                `MODEL_BROWSER_ROOT` — is unaffected.
 */
export function createLibrary(
  env: NodeJS.ProcessEnv = process.env,
  config: DeploymentConfig = {},
): Library {
  /**
   * What a successful evaluation settled on: the library, and the root string
   * that was configured to find it. The root is kept verbatim because it is
   * what a later `missing` has to name — the state the top's own stat produces
   * once the volume goes away, when the configured spelling is the only thing
   * the user can act on.
   */
  let settled: { ready: Ready; root: string } | undefined

  /**
   * Whether the last thing `state()` said about a settled library was that its
   * top was gone. It is the transition — not the absence — that is caught,
   * and only a transition a request observed: an unplug and replug that both
   * fall between two requests never sets the flag, so a swap in that window
   * is still inherited. The case that matters — automounted drives trading
   * places under a server that is being used — serves requests during the
   * gap, which is what makes the flag worth its one branch.
   */
  let wasMissing = false

  /**
   * The last `nested` answer and when it stops standing. `nested` is not
   * settled — nothing serves under it — so this is a cost memo, not an
   * identity: it only keeps the gate from re-walking the tree once per request
   * (`NESTED_RECHECK_MS`). Cleared by `refresh()`, which is the caller asking
   * for the filesystem as it is now.
   */
  let nestedMemo: { state: LibraryState; until: number } | undefined

  async function evaluate(): Promise<LibraryState> {
    if (nestedMemo !== undefined) {
      if (Date.now() < nestedMemo.until) return nestedMemo.state
      nestedMemo = undefined
    }
    const root = configuredRoot(env, config)
    if (root === undefined) return { state: 'unconfigured' }
    try {
      if (!(await stat(root)).isDirectory()) return { state: 'missing', root }
    } catch {
      // Not present at all — the usual shape of an unmounted volume.
      return { state: 'missing', root }
    }
    // The volume can go away between the `stat` above and this walk — an
    // unmount is not atomic with respect to this function, and both calls below
    // fail in that window. Neither may be read as "nothing found": that branch
    // *settles*, hashing the root's path for an identity and keeping it for the
    // process's life, so the volume returning with its real marker would be
    // served under the hash (F6). `realpath` is inside the same catch because
    // it sits one statement earlier in the identical window — catching only
    // `findMarker` would leave its ENOENT escaping `state()` as a 500.
    let realRoot: string
    let found: { top: string; id: string } | undefined
    try {
      realRoot = await realpath(root)
      found = await findMarker(realRoot)
    } catch {
      return { state: 'missing', root }
    }
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
    if (nested !== undefined) {
      const state: LibraryState = { state: 'nested', root, library: nested }
      nestedMemo = { state, until: Date.now() + NESTED_RECHECK_MS }
      return state
    }
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

  /**
   * The in-flight `state()`, if any. Everything `state()` does — the probe, the
   * marker write, the return-transition check — reads and writes `settled` and
   * `wasMissing` across `await`s, and nothing serialised them: four concurrent
   * first calls each ran the probe and each wrote a marker, handing out four
   * identities for one tree, and on the return transition the flag was cleared
   * before the marker read, so only the first of a burst re-checked. A burst is
   * the normal case, not a contrived one — `index.ts` calls `state()` without
   * awaiting it and the client's boot hits the gate with a dozen requests at
   * once. Single-flighting the whole body makes every one of them the same
   * evaluation.
   */
  let pending: Promise<LibraryState> | undefined

  async function compute(): Promise<LibraryState> {
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
    if (top === null || !top.isDirectory()) {
      // The cached `ready` is deliberately *not* discarded: the same tree
      // returning at the same place is the same library, and
      // `realTop()`/`id()` keep answering meanwhile — the cache's own sweep
      // guard reads them to decide it must not run (`ThumbCache.maintain`).
      wasMissing = true
      return { state: 'missing', root: current.root }
    }
    // Present again after an absence — the one moment a *different* tree can
    // have arrived at the same path. Two drives that automount at the same
    // mount point in one session would otherwise both be served under the
    // first one's identity, and `maintain` would then sweep every path the
    // second does not have, cameras included (F7). So the marker is re-read
    // exactly here, once per absence, and a library that is not the one that
    // went away is evaluated from scratch.
    //
    // The test is "the marker says what it said", not "there is a marker":
    // exempting an `unmarked` library from the read altogether — its id being
    // path-derived, so the path looked like the whole test — let a *marked*
    // drive arriving at that same path be served under the hash of it, which is
    // the same swap this branch exists to catch. An `unmarked` library expects
    // no marker, so `undefined` is what it compares equal to.
    if (wasMissing) {
      const id = await markerIdAt(current.ready.top)
      const expected = current.ready.unmarked === true ? undefined : current.ready.id
      // Cleared only once the read is done, so a caller that is somehow not
      // behind the single flight still re-checks rather than skipping past it.
      wasMissing = false
      if (id !== expected) {
        settled = undefined
        return evaluate()
      }
    }
    return current.ready
  }

  return {
    state() {
      return (pending ??= compute().finally(() => {
        pending = undefined
      }))
    },

    async refresh() {
      // An evaluation already in flight is reading the state this call is about
      // to discard; let it finish rather than clearing `settled` underneath it.
      if (pending !== undefined) await pending.catch(() => undefined)
      settled = undefined
      wasMissing = false
      nestedMemo = undefined
      return (pending ??= evaluate().finally(() => {
        pending = undefined
      }))
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
      // A hidden component is unreachable, not merely unlisted. Listings and
      // completions skip dot-prefixed entries, and skipping was never the same
      // thing: on a deployment that answers strangers, a trash directory a
      // listing hides is browsable by anyone who spells its name. The marker
      // directory — this app's own corner of the library, the home of every
      // file it keeps beside the models — is the case this rule started as, and
      // is covered by it, `.model-browser` being dot-prefixed like the rest.
      //
      // Answered as a path that is not there — `no such path`, 404, the
      // sentence `listDir` and `peek` give a name that misses — rather than as
      // the "outside" refusal it was first written as. *Unreachable* is the
      // property the spec asks for, and a distinct refusal is not
      // unreachability: a 400 saying "outside" where a miss says 404 is an
      // oracle, telling a stranger that the name they spelled is one this
      // server treats specially. The point is that `/.trash/junk.stl`, which is
      // really on disk, and `/.hidden/x.stl`, which is not, and `/nope/x.stl`,
      // which is neither, are one answer.
      //
      // `.` and `..` never reach here as components — `posix.normalize` above
      // resolved them, and an absolute path drops the leading `..` that would
      // climb out. Only the filesystem half is tested: the entry half is an
      // opaque archive name this module does not normalise, and the zip
      // routes read a named entry rather than a path.
      if (normalized.split('/').some((part) => part.startsWith('.'))) {
        throw new LibraryError(`no such path: ${libPath}`, 404)
      }
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
