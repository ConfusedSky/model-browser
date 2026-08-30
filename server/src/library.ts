/**
 * The library: one marked tree, and the only translator between a request's
 * path and a filesystem path (library-root D1–D4).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * A library is a directory tree whose top carries
 * `.model-browser/library.json` — `{ "id": "<uuid>", "version": 1 }`. The
 * configured *root* is only where the app opens inside that tree: the library
 * is found by walking **up** from the root until a marker appears, so
 * re-picking a deeper folder is a change of viewpoint and not of namespace
 * (D1). Every path the app then handles is relative to the top, written with a
 * leading slash, so the top is `/` (D2).
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import type { LibraryState } from '../../shared/types'
import { parseVPath } from './vpath'
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

export interface Resolved {
  /** Filesystem path — the file, or the containing zip for a virtual path. */
  fsPath: string
  /** Entry inside the zip, verbatim from the request. Undefined for plain paths. */
  entry?: string
}

export interface Library {
  /**
   * The current state. `missing` is re-evaluated on every call, so a volume
   * mounted after start needs no restart; `ready` is cached — a library does
   * not stop being itself (D4).
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
 * The first marker at or above `start`, walking to the filesystem root.
 *
 * A marker is a JSON *object* carrying a non-empty string `id`; unknown fields
 * are ignored, so a later version may add them. Anything else — unreadable,
 * malformed, an `id` that is not a string, or an empty one, which is no
 * identifier and would name a cache directory of `''` — is not a marker, and
 * the walk continues past it rather than adopting it.
 */
async function findMarker(start: string): Promise<{ top: string; id: string } | undefined> {
  let dir = start
  for (;;) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(dir, MARKER_DIR, MARKER_FILE), 'utf8'))
    } catch {
      parsed = undefined
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const id = (parsed as Record<string, unknown>).id
      if (typeof id === 'string' && id !== '') return { top: dir, id }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
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
  let ready: Ready | undefined

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
      ready = {
        state: 'ready',
        id: found.id,
        top: found.top,
        root: toLibPath(found.top, realRoot) ?? '/',
      }
      return ready
    }
    // No marker above it: the root becomes a library, if the volume will say so.
    const written = await writeMarker(realRoot)
    ready =
      written === undefined
        ? { state: 'ready', id: hashedId(realRoot), top: realRoot, root: '/', unmarked: true }
        : { state: 'ready', id: written, top: realRoot, root: '/' }
    return ready
  }

  function requireReady(): Ready {
    if (ready === undefined) throw new Error('the library is not ready')
    return ready
  }

  return {
    async state() {
      // `ready` is cached; the other two states are a question about the
      // filesystem right now, and are asked again every time.
      return ready ?? (await evaluate())
    },

    async refresh() {
      ready = undefined
      return evaluate()
    },

    realTop: () => requireReady().top,
    id: () => requireReady().id,

    async resolve(libPath) {
      const realTop = requireReady().top
      if (!libPath.startsWith('/')) throw new LibraryError('path must be a library path', 400)
      // The virtual path splits **first**: only the filesystem half is a path
      // in this tree. The entry half is an opaque archive name — normalising it
      // would rewrite a cache key that is the string itself.
      const { fsPath, entry } = parseVPath(libPath)
      const candidate = join(realTop, posix.normalize(fsPath))

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
