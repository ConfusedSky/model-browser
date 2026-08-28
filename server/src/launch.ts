/**
 * Platform launch operations (open-in-slicer L2/L6/L7/L8/L9).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1), so spawning is
 * `node:child_process` and temp files are `node:fs`/`node:os`.
 *
 * Four operations, each replaceable by an argv template from local config:
 * `default(mime)`, `associations(mime)`, `launch(appId, file)`, `chooser(file)`.
 * Templates are argv **arrays** handed to `spawn` — never a shell string — so
 * no value, a file name included, is ever interpreted by one.
 */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { extname, join, relative, sep } from 'node:path'
import type { AppRef, AppsReport, TypeApps } from '../../shared/types'
import { modelFormat } from './listing'
import { extractEntry } from './zip'

/** A launch or chooser command that failed or could not be spawned. */
export class LaunchError extends Error {}

/**
 * The mimes this server handles, derived from the listing's own format
 * detector (L6) rather than a second extension table — the two cannot drift,
 * because `modelFormat` is also what makes an entry `kind === 'model'`.
 */
const MIME_BY_FORMAT = { stl: 'model/stl', '3mf': 'model/3mf', obj: 'model/obj' } as const

export const HANDLED_MIMES: readonly string[] = Object.values(MIME_BY_FORMAT)

/** The mime for a name or path, undefined when it is not a model. */
export function mimeFor(name: string): string | undefined {
  const format = modelFormat(name)
  return format === undefined ? undefined : MIME_BY_FORMAT[format]
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Spawn options. Deliberately has **no `signal`**: the chooser spans a human
 * decision (L9) and a dropped request must never kill it, so there is no abort
 * to wire in the first place. Absence here is the structural guarantee.
 */
export interface SpawnOptions {
  /** Own process group, so neither a request nor a `bun --hot` reload reaps it. */
  detached?: boolean
  /**
   * Pipe and read the child's **stdout**. **Only the two query operations set
   * it**, because only they read what the command printed. A launch or a
   * chooser leaves it off, and that is what bounds the request: a piped
   * write-end is inherited by every descendant, so `close` — which waits for
   * EOF on the pipes, not for the child — would not fire until the *launched
   * application* quit.
   *
   * Off does not mean output is discarded. `stderr` is collected either way,
   * into a file rather than a pipe when this is off (`stderrSink`), so a failed
   * launch or chooser can still say why without any descendant holding the
   * request open. `stdout` is what is genuinely dropped.
   */
  capture?: boolean
}

/** Runs an argv. Resolves with the exit code; rejects only when unspawnable. */
export type ExecFn = (file: string, args: string[], opts: SpawnOptions) => Promise<SpawnResult>

/**
 * `spawn`, not `execFile`: `detached` is what puts a chooser in its own process
 * group (L9) and `@types/node` does not admit it on `execFile`'s options. What
 * ends the request is `capture`, not `detached` — see SpawnOptions.
 * The guarantee that matters is unchanged — an argv array, never a shell
 * string, so nothing is ever word-split or metacharacter-interpreted.
 */
/** Most of a reason fits in a line; this is a guard, not a budget. */
const STDERR_LIMIT = 8192

/**
 * An anonymous file to collect a non-capturing command's stderr in.
 *
 * A *file* rather than a pipe, and that is the whole point. Piping stderr would
 * reintroduce the hang this module already fixed once — `close` waits for EOF
 * on a pipe, and every descendant inherits the write-end — and closing the read
 * end early to dodge that is worse than the hang: measured here, a descendant
 * that writes to stderr after the parent destroys its end takes SIGPIPE and
 * dies, which for a *launcher* means killing the application it just started.
 * A file has neither failure mode: nothing waits on it, descendants may write
 * to it for as long as they live, and the reason is there to read at exit.
 *
 * Unlinked at once, so there is no name to clean up on any path — the fd is the
 * only handle, and the space returns when the last descendant exits. That is a
 * POSIX assumption (`docs/platform-surface.md`). A bare file rather than
 * `mkdtemp` plus a file inside it, because the directory is not unlinkable the
 * same way and would outlive every launch as empty litter in the temp dir;
 * `wx+` is what makes the name ours without one.
 */
function stderrSink(): number {
  const path = join(tmpdir(), `mb-launch-${randomUUID()}`)
  const fd = openSync(path, 'wx+')
  unlinkSync(path)
  return fd
}

/**
 * What the sink caught, capped to the **tail**. A reason is the last thing a
 * command prints, not the first: a child that chatters through startup and then
 * fails would, read from the front, hand back the chatter and drop the very
 * line this whole mechanism exists to deliver. An explicit `position` leaves the
 * fd's own offset alone, which matters because that offset belongs to the child.
 */
function readSink(fd: number): string {
  try {
    const total = fstatSync(fd).size
    const size = Math.min(total, STDERR_LIMIT)
    if (size === 0) return ''
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, total - size)
    const text = buf.toString('utf8')
    // Say so when the head was dropped, so a truncated reason cannot read as a
    // command that only said this much.
    return total > size ? `…${text}` : text
  } catch {
    // A reason is a nicety; failing to read one must never fail the request.
    return ''
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* already gone */
    }
  }
}

const nodeExec: ExecFn = (file, args, opts) =>
  new Promise((resolve, reject) => {
    const capture = opts.capture === true
    // Non-capturing commands still get their stderr collected — it is the only
    // place a failed launch or chooser says *why* — but into a file, never a
    // pipe. See `stderrSink`.
    const sink = capture ? null : stderrSink()
    let child
    try {
      child = spawn(file, args, {
        detached: opts.detached === true,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', sink as number],
      })
    } catch (err) {
      if (sink !== null) closeSync(sink)
      return reject(err as Error)
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.on('data', (d: string) => {
      stderr += d
    })
    // `error` is unspawnable (ENOENT, EACCES) — not a result. A close with a
    // null code is a signal death, which is also not a result.
    child.once('error', (err) => {
      if (sink !== null) closeSync(sink)
      reject(err)
    })
    child.once('close', (code, signal) => {
      if (sink !== null) stderr = readSink(sink)
      if (code === null) return reject(new Error(`killed by ${signal ?? 'a signal'}`))
      resolve({ code, stdout, stderr })
    })
  })

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Argv templates, `{mime}`/`{appId}`/`{file}` substituted per element. */
export interface LaunchConfig {
  default?: string[]
  associations?: string[]
  launch?: string[]
  chooser?: string[]
}

const CONFIG_KEYS = ['default', 'associations', 'launch', 'chooser'] as const

function configPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.MODEL_BROWSER_LAUNCH_CONFIG
  if (explicit !== undefined && explicit !== '') return explicit
  return join(configHome(env), 'model-browser', 'launch.json')
}

/** Read at startup; an absent or unreadable file leaves the builtins in force. */
export function loadLaunchConfig(env: NodeJS.ProcessEnv = process.env): LaunchConfig {
  let text: string
  try {
    text = readFileSync(configPath(env), 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const config: LaunchConfig = {}
  for (const key of CONFIG_KEYS) {
    const value = (parsed as Record<string, unknown>)[key]
    // A template is only a template when it is a non-empty argv array of
    // strings; anything else is ignored rather than half-honoured.
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
      config[key] = value as string[]
    }
  }
  return config
}

/**
 * Placeholder substitution, **per element**. A value is replaced inside the
 * string it appears in and is never split, quoted, or shell-interpreted, so a
 * file name full of metacharacters arrives as exactly one argv entry.
 */
function fill(argv: readonly string[], vars: Record<string, string>): string[] {
  return argv.map((el) => el.replace(/\{(mime|appId|file)\}/g, (m, k: string) => vars[k] ?? m))
}

// ---------------------------------------------------------------------------
// XDG locations
// ---------------------------------------------------------------------------

function home(env: NodeJS.ProcessEnv): string {
  const h = env.HOME
  return h !== undefined && h !== '' ? h : homedir()
}

function configHome(env: NodeJS.ProcessEnv): string {
  const c = env.XDG_CONFIG_HOME
  return c !== undefined && c !== '' ? c : join(home(env), '.config')
}

/**
 * Data dirs in precedence order, **with the XDG defaults applied**. Reading
 * the variables literally is not equivalent: on the development machine
 * `XDG_DATA_HOME` is unset and `~/.local/share` is absent from
 * `XDG_DATA_DIRS` (verified), so the literal read misses the one directory
 * holding every entry that matters (L2).
 */
function dataDirs(env: NodeJS.ProcessEnv): string[] {
  const dataHome = env.XDG_DATA_HOME
  const first = dataHome !== undefined && dataHome !== '' ? dataHome : join(home(env), '.local', 'share')
  const rest = env.XDG_DATA_DIRS
  const dirs = (rest !== undefined && rest !== '' ? rest : '/usr/local/share:/usr/share')
    .split(':')
    .filter((d) => d !== '')
  const seen = new Set<string>()
  return [first, ...dirs].filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
}

// ---------------------------------------------------------------------------
// Desktop entries
// ---------------------------------------------------------------------------

interface DesktopEntry {
  id: string
  name: string
  mimes: string[]
  /** `NoDisplay=true` or `Hidden=true` — filtered from associations. */
  hidden: boolean
  isApplication: boolean
}

/**
 * Parse the `[Desktop Entry]` section only. `Name` takes the first *plain*
 * occurrence: `Name[de]` is a localization, not the name this server renders.
 */
function parseEntry(text: string, id: string): DesktopEntry {
  const entry: DesktopEntry = { id, name: id, mimes: [], hidden: false, isApplication: false }
  let inSection = false
  let named = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inSection = line === '[Desktop Entry]'
      continue
    }
    if (!inSection) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'Name' && !named && value !== '') {
      entry.name = value
      named = true
    } else if (key === 'MimeType') {
      entry.mimes = value.split(';').map((m) => m.trim()).filter((m) => m !== '')
    } else if (key === 'NoDisplay' || key === 'Hidden') {
      if (value.toLowerCase() === 'true') entry.hidden = true
    } else if (key === 'Type') {
      entry.isApplication = value === 'Application'
    }
  }
  return entry
}

/** Comfortably past the deepest live example (wine/Programs/<app>/<app>.desktop). */
const MAX_DEPTH = 8

/**
 * Scan every `applications/` dir for desktop entries, earlier data dir winning
 * an id collision (a user entry shadows the package's).
 *
 * The traversal **stats through symlinks, files and directories both**, rather
 * than trusting `withFileTypes` bits: every dotfiles-deployed entry on this
 * machine is a top-level *file* symlink for which `dirent.isFile()` is false
 * (verified: `lycheeslicer.desktop`, `photon-workshop.desktop`), so a naive
 * dirent filter skips exactly the entries the feature exists for (L2).
 *
 * `mimeinfo.cache` is never consulted: it is a build artifact, and nothing
 * reruns `update-desktop-database` for hand-placed entries, so a new
 * `MimeType=` stays invisible in it indefinitely.
 */
function scanEntries(env: NodeJS.ProcessEnv): Map<string, DesktopEntry> {
  const found = new Map<string, DesktopEntry>()
  const visited = new Set<string>()

  const walk = (root: string, dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    let real: string
    try {
      real = realpathSync(dir)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue // broken symlink
      }
      if (st.isDirectory()) {
        walk(root, full, depth + 1)
        continue
      }
      if (!st.isFile() || !name.endsWith('.desktop')) continue
      const id = relative(root, full).split(sep).join('-')
      if (found.has(id)) continue
      let text: string
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      found.set(id, parseEntry(text, id))
    }
  }

  for (const dir of dataDirs(env)) walk(join(dir, 'applications'), join(dir, 'applications'), 0)
  return found
}

/**
 * Candidate relative paths for a desktop-file id, in lookup order: the literal
 * id first (`photon-workshop.desktop` has a dash that is not a separator),
 * then **cumulative** left-to-right dash→`/` substitutions. Cumulative because
 * the live subdirectoried example needs three at once —
 * `wine-Programs-App-App.desktop` → `wine/Programs/App/App.desktop`.
 */
function* idCandidates(id: string): Generator<string> {
  yield id
  const parts = id.split('-')
  for (let n = 1; n < parts.length; n++) {
    yield `${parts.slice(0, n).join('/')}/${parts.slice(n).join('-')}`
  }
}

// ---------------------------------------------------------------------------
// mimeapps.list
// ---------------------------------------------------------------------------

type Sections = Map<string, Map<string, string[]>>

function parseMimeapps(text: string): Sections {
  const sections: Sections = new Map()
  let current: Map<string, string[]> | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1)
      current = sections.get(name) ?? new Map()
      sections.set(name, current)
      continue
    }
    if (current === undefined) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const mime = line.slice(0, eq).trim()
    const ids = line
      .slice(eq + 1)
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v !== '')
    const prior = current.get(mime)
    current.set(mime, prior === undefined ? ids : [...prior, ...ids])
  }
  return sections
}

/** Standard mimeapps.list locations, most precedent first. */
function mimeappsFiles(env: NodeJS.ProcessEnv): string[] {
  return [
    join(configHome(env), 'mimeapps.list'),
    ...dataDirs(env).map((d) => join(d, 'applications', 'mimeapps.list')),
  ]
}

/**
 * Section-aware read of the mimeapps chain. `[Default Applications]` and
 * `[Added Associations]` associate; `[Removed Associations]` **excludes** — an
 * app the user explicitly removed must not get a pill (L2).
 *
 * The first location to mention an id decides it, so a removal in
 * `~/.config` beats an addition in `/usr/share`. Within one file removals are
 * read first, so an explicit removal also wins a self-contradicting file.
 */
function mimeappsDecisions(
  env: NodeJS.ProcessEnv,
  mime: string,
): { added: string[]; removed: Set<string> } {
  const decided = new Map<string, 'add' | 'remove'>()
  const added: string[] = []
  for (const file of mimeappsFiles(env)) {
    let sections: Sections
    try {
      sections = parseMimeapps(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    for (const id of sections.get('Removed Associations')?.get(mime) ?? []) {
      if (!decided.has(id)) decided.set(id, 'remove')
    }
    const adds = [
      ...(sections.get('Default Applications')?.get(mime) ?? []),
      ...(sections.get('Added Associations')?.get(mime) ?? []),
    ]
    for (const id of adds) {
      if (decided.has(id)) continue
      decided.set(id, 'add')
      added.push(id)
    }
  }
  const removed = new Set([...decided].filter(([, v]) => v === 'remove').map(([k]) => k))
  return { added, removed }
}

// ---------------------------------------------------------------------------
// The registry reader
// ---------------------------------------------------------------------------

/**
 * One read of the platform registry. Built per request (L5: no memoization
 * across requests, since the chooser may rewrite the registry mid-session) and
 * shared across the handled mimes within that request.
 */
interface Reader {
  name(id: string): string
  associations(mime: string): AppRef[]
}

function createReader(env: NodeJS.ProcessEnv): Reader {
  let scan: Map<string, DesktopEntry> | undefined
  const entries = (): Map<string, DesktopEntry> => (scan ??= scanEntries(env))

  const lookup = (id: string): DesktopEntry | undefined => {
    const hit = entries().get(id)
    if (hit !== undefined) return hit
    // Not scanned (past the depth cap, an unreadable dir, or an id naming a
    // file we never walked): probe the filesystem for it directly.
    if (id.includes('/') || id.includes('\\') || id.includes('..')) return undefined
    for (const dir of dataDirs(env)) {
      const root = join(dir, 'applications')
      for (const rel of idCandidates(id)) {
        const full = join(root, rel)
        try {
          if (!statSync(full).isFile()) continue
          return parseEntry(readFileSync(full, 'utf8'), id)
        } catch {
          // keep trying candidates
        }
      }
    }
    return undefined
  }

  return {
    // An unresolvable id renders as itself rather than vanishing: an app the
    // registry names is reported even when its entry cannot be found.
    name: (id) => lookup(id)?.name ?? id,

    associations(mime) {
      const { added, removed } = mimeappsDecisions(env, mime)
      const declaring = [...entries().values()]
        .filter((e) => e.mimes.includes(mime))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => e.id)
      const ordered = [...added, ...declaring.filter((id) => !added.includes(id))]
      const out: AppRef[] = []
      const seen = new Set<string>()
      for (const id of ordered) {
        if (removed.has(id) || seen.has(id)) continue
        seen.add(id)
        const entry = lookup(id)
        // The NoDisplay/Hidden filter is load-bearing, not cosmetic: for
        // model/stl it removes the `0FileVersion` wine shim and the f3d plugin
        // whose Name=F3D would otherwise duplicate the default's pill.
        if (entry !== undefined && (entry.hidden || !entry.isApplication)) continue
        out.push({ id, name: entry?.name ?? id })
      }
      return out
    },
  }
}

/** Overridden query output: `appId<TAB>name` per line, names the override's job. */
function parseQueryLines(stdout: string): { id: string; name?: string }[] {
  return stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const tab = l.indexOf('\t')
      if (tab === -1) return { id: l.trim() }
      return { id: l.slice(0, tab).trim(), name: l.slice(tab + 1).trim() }
    })
}

// ---------------------------------------------------------------------------
// Zip temp extraction (L7)
// ---------------------------------------------------------------------------

let stagingCounter = 0

/**
 * Per-server-run temp store for zip entries. Named from the **full virtual
 * path**, never the basename: `a.zip!/part.stl` and `b.zip!/part.stl` must not
 * share a file, or the second launch overwrites bytes the first app may still
 * be reading — the exact hazard this exists to avoid (L7).
 *
 * `root` is the directory its per-run `mkdtemp` is created inside — defaults
 * to the OS tmpdir, unchanged from before this parameter existed. Tests pass
 * their own swept root so `createApp` never litters the real tmpdir (4.5).
 */
export class ZipTempStore {
  private dir: string | undefined

  constructor(private readonly root: string = tmpdir()) {}

  /** Created lazily: a server that never opens a zip entry makes no temp dir. */
  private ensureDir(): string {
    return (this.dir ??= mkdtempSync(join(this.root, 'model-browser-open-')))
  }

  async fileFor(vpath: string, zipPath: string, entry: string): Promise<string> {
    const dir = this.ensureDir()
    const hash = createHash('sha256').update(vpath).digest('hex').slice(0, 16)
    const target = join(dir, hash + extname(entry))
    const bytes = await extractEntry(zipPath, entry)
    // Staging + rename, never truncate in place: a rename swaps the *name*, so
    // an application still reading from the previous launch keeps the inode it
    // opened, with the content it opened. Nothing is deleted while the server
    // runs; the OS reclaims the dir.
    const staging = `${target}.${process.pid}-${stagingCounter++}.part`
    writeFileSync(staging, bytes)
    renameSync(staging, target)
    return target
  }
}

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

export interface Launcher {
  /** Whether a chooser template exists — there is no builtin (L2/L4). */
  readonly chooserConfigured: boolean
  /** Reads the registry fresh; never memoized across calls (L5). */
  report(): Promise<AppsReport>
  launch(appId: string, file: string): Promise<void>
  chooser(file: string): Promise<void>
}

export interface LauncherOptions {
  env?: NodeJS.ProcessEnv
  exec?: ExecFn
  /** Injected in tests; otherwise read from disk once, at construction. */
  config?: LaunchConfig
}

export function createLauncher(opts: LauncherOptions = {}): Launcher {
  const env = opts.env ?? process.env
  const exec = opts.exec ?? nodeExec
  const config = opts.config ?? loadLaunchConfig(env)

  async function run(argv: string[], options: SpawnOptions, what: string): Promise<SpawnResult> {
    let result: SpawnResult
    try {
      result = await exec(argv[0] as string, argv.slice(1), options)
    } catch (err) {
      throw new LaunchError(`could not run ${what}: ${(err as Error).message}`)
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim()
      throw new LaunchError(
        `${what} exited ${result.code}${detail === '' ? '' : `: ${detail}`}`,
      )
    }
    return result
  }

  async function queryDefault(mime: string, reader: Reader): Promise<AppRef | null> {
    if (config.default !== undefined) {
      const argv = fill(config.default, { mime })
      // Same policy as the builtin below: a failing query is "no default" for
      // this one mime, never an error that sinks the whole report.
      let stdout: string
      try {
        ;({ stdout } = await run(argv, { capture: true }, 'the default query'))
      } catch {
        return null
      }
      const first = parseQueryLines(stdout)[0]
      if (first === undefined) return null
      return { id: first.id, name: first.name ?? reader.name(first.id) }
    }
    // One machine-readable line; a missing or failing xdg-mime is "no default",
    // not an error that should sink the whole report.
    let out: SpawnResult
    try {
      out = await exec('xdg-mime', ['query', 'default', mime], { capture: true })
    } catch {
      return null
    }
    if (out.code !== 0) return null
    const id = out.stdout.split('\n')[0]?.trim() ?? ''
    if (id === '') return null
    return { id, name: reader.name(id) }
  }

  async function queryAssociations(mime: string, reader: Reader): Promise<AppRef[]> {
    if (config.associations !== undefined) {
      const argv = fill(config.associations, { mime })
      let stdout: string
      try {
        ;({ stdout } = await run(argv, { capture: true }, 'the associations query'))
      } catch {
        return []
      }
      return parseQueryLines(stdout).map((l) => ({ id: l.id, name: l.name ?? reader.name(l.id) }))
    }
    return reader.associations(mime)
  }

  return {
    chooserConfigured: config.chooser !== undefined,

    async report(): Promise<AppsReport> {
      const reader = createReader(env)
      const types: Record<string, TypeApps> = {}
      for (const mime of HANDLED_MIMES) {
        const def = await queryDefault(mime, reader)
        // The default is reported separately, so the associations are the
        // *further* ones the spec asks for.
        const associated = (await queryAssociations(mime, reader)).filter((a) => a.id !== def?.id)
        types[mime] = { default: def, associated }
      }
      return { chooser: config.chooser !== undefined, types }
    },

    async launch(appId, file) {
      const argv =
        config.launch !== undefined
          ? fill(config.launch, { appId, file })
          : ['gtk-launch', appId.replace(/\.desktop$/, ''), file]
      await run(argv, {}, 'the launch command')
    },

    async chooser(file) {
      if (config.chooser === undefined) throw new LaunchError('no chooser is configured')
      // `detached` and no signal: the chooser blocks on a human decision, and a
      // dropped request or a hot reload must not kill it — a dismissed chooser
      // and a killed one can never read the same (L9).
      await run(fill(config.chooser, { file }), { detached: true }, 'the chooser command')
    },
  }
}
