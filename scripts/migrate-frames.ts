/**
 * Migrate a thumbnail cache's stored axes from the scene convention to the
 * file convention, once (file-frame-spindle D5).
 *
 *   bun run scripts/migrate-frames.ts --cache-dir <dir> [--undo]
 *
 * `<dir>` is one library's cache directory — `~/.cache/model-browser/<id>/`,
 * the directory holding the `<key>.json` sidecars — not the cache root.
 *
 * Node APIs only, though scripts here may use Bun: the core below is exported
 * and exercised by `server/test/migrateFrames.test.ts`, whose tsconfig types
 * are Node's, and that import is also what typechecks this file (so nothing
 * on its import path may pull in `three`, which the server project lacks —
 * `shared/frames.ts` is plain arithmetic for exactly this reason).
 *
 * What a run does to a sidecar that stores a `camera` or an `axis` and carries
 * no `frame` label (the scene convention, 1, which was never written as a
 * value):
 *
 * - STL / 3MF with an axis: the axis is relabelled to the file axis it named
 *   (`migrateAxis`, derived from the two frame tables), the camera untouched —
 *   the spindle frames were redefined so the same angles draw the same view.
 * - STL / 3MF with a camera and no axis: the label alone. The entry drew about
 *   the old default `y` and draws about the new default `z`, whose frame is
 *   the old `y` frame; writing an axis would withhold an index pose the entry
 *   never suppressed.
 * - OBJ (never baked): the axis keeps its name, but four of the six frames
 *   moved under that name, so a stored camera at `x`/`-x`/`z`/`-z` has
 *   `swapOffset(axis)` added to its azimuth. At `y`/`-y` (or with no axis —
 *   the old default `y`) the offset is 0, so the label alone.
 *
 * Then `frame: FRAME_CONVENTION` is stamped and the sidecar rewritten with a
 * plain `writeFile`, the way `writeMeta` does, every other field carried
 * verbatim. **Render files (`<key>.webp`, `<key>.noao.webp`) are never
 * touched**: under the redefined frames a relabelled axis with its untouched
 * camera draws the same view (D3's measurement), so the cached pixels stay
 * valid.
 *
 * The run is recorded in `<dir>/.frame-migration` — no `.json` extension, or
 * `maintain()`'s sweeps would read it as a sidecar and delete it. On a later
 * run the marker is what lets the script refuse a directory a server *without*
 * the label has written to since (a rolled-back server): a framed sidecar
 * that is unlabelled *and* newer than the marker is that signature, and
 * relabelling it would turn a file axis into `-y`. `--undo` inverts a run —
 * the axis back, the offset subtracted, the label removed, the marker deleted
 * — and is what to run before rolling the server back.
 */

import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { migrateAxis, swapOffset } from '../shared/frames'
import type { CameraState, ModelFormat, OrbitAxis } from '../shared/types'
import { FRAME_CONVENTION } from '../server/src/cache'
import { modelFormat } from '../server/src/listing'

/** The run record's name. No `.json`: `maintain()` treats every `*.json` as a sidecar. */
export const MARKER_FILE = '.frame-migration'

export interface MigrateOptions {
  /** One library's cache directory — the one holding the `<key>.json` sidecars. */
  cacheDir: string
  /** Invert a previous run instead of performing one. */
  undo?: boolean
  /** Where the summary and the per-sidecar notices go. Defaults to stdout. */
  report?: (message: string) => void
  /** The clock the marker's `at` is taken from. Defaults to the wall clock. */
  now?: () => Date
}

/**
 * The seven counts. Every sidecar read lands in exactly one of the six
 * categories below `read`. Under `--undo` the same names describe the inverse
 * step: `relabelled` is an axis put back, `reExpressed` an offset subtracted,
 * `labelOnly` a label removed with nothing else to invert, and
 * `alreadyLabelled` a framed sidecar with nothing to undo — one carrying no
 * label — so an undo over an unlabelled directory reports zeros for the three
 * that change anything.
 */
export interface MigrateResult {
  /** Sidecars (`*.json`) found in the directory. */
  read: number
  /** STL/3MF axes relabelled (or, under `--undo`, put back). */
  relabelled: number
  /** OBJ cameras with the swap offset added (or subtracted). */
  reExpressed: number
  /** Framed sidecars that only gained (or lost) the label. */
  labelOnly: number
  /** Framed sidecars already in the target state, left untouched. */
  alreadyLabelled: number
  /** Framed sidecars the script would not touch: a path it cannot classify, or a field it cannot read. */
  unclassifiable: number
  /** Sidecars storing neither a camera nor an axis — nothing to migrate, never labelled. */
  skipped: number
  /** The marker's path. */
  marker: string
}

/**
 * The fields the migration reads or writes. Everything else in a sidecar is
 * carried through untouched by the spread in `transform`; the cache's `Meta`
 * is not imported because it is private to `ThumbCache`, and this script
 * must not depend on any field it does not migrate.
 */
interface Sidecar {
  path?: unknown
  camera?: CameraState | null
  axis?: OrbitAxis | null
  frame?: number
  [field: string]: unknown
}

/** `merged` never stores a `null`, but a sidecar is a file: absent and `null` both mean none. */
function has<T>(v: T | null | undefined): v is T {
  return v !== undefined && v !== null
}

const AXES: readonly OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']

function isAxis(v: unknown): v is OrbitAxis {
  return typeof v === 'string' && (AXES as readonly string[]).includes(v)
}

/**
 * The scene axis whose file image is `fileAxis` — `migrateAxis` inverted by
 * search, never by a second table, so the two directions cannot drift apart.
 */
function unmigrateAxis(fileAxis: OrbitAxis): OrbitAxis {
  const scene = AXES.find((a) => migrateAxis(a) === fileAxis)
  if (scene === undefined) throw new Error(`no scene axis maps to ${fileAxis}`)
  return scene
}

/** The count a written sidecar goes to. */
type Outcome = 'relabelled' | 'reExpressed' | 'labelOnly'

/**
 * The transform, one direction or the other, for a framed sidecar that is in
 * the source convention. Returns the rewritten sidecar and the count it
 * belongs to. Pure: the caller decides whether to write.
 */
function transform(meta: Sidecar, format: ModelFormat, undo: boolean): { next: Sidecar; outcome: Outcome } {
  const next: Sidecar = { ...meta }
  let outcome: Outcome = 'labelOnly'
  if (format === 'obj') {
    // Never baked: the axis keeps its name. A camera at a spindle whose frame
    // moved is re-measured in the new frame by the offset; at `y`/`-y`, and
    // with no axis (the old default `y`), the offset is 0 and nothing moves.
    if (has(meta.camera) && has(meta.axis)) {
      const offset = swapOffset(meta.axis)
      if (offset !== 0) {
        next.camera = { ...meta.camera, az: meta.camera.az + (undo ? -offset : offset) }
        outcome = 'reExpressed'
      }
    }
  } else if (has(meta.axis)) {
    next.axis = undo ? unmigrateAxis(meta.axis) : migrateAxis(meta.axis)
    outcome = 'relabelled'
  }
  // A camera with no axis on a baked format gains none (see the header): the
  // label alone says the entry has been seen.
  if (undo) delete next.frame
  else next.frame = FRAME_CONVENTION
  return { next, outcome }
}

/** A read sidecar, classified once so the refusal check and the write pass agree. */
interface Entry {
  file: string
  meta: Sidecar
  /** The format its path classifies to; undefined when it cannot be classified. */
  format: ModelFormat | undefined
  /** Why it is unclassifiable, when it is — reported verbatim. */
  problem?: string
  /** The file did not parse as a sidecar object; nothing about it is known. */
  unreadable?: boolean
}

function framed(meta: Sidecar): boolean {
  return has(meta.camera) || has(meta.axis)
}

async function readMarker(marker: string): Promise<{ at: string } | null> {
  let text: string
  try {
    text = await readFile(marker, 'utf8')
  } catch {
    return null
  }
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { at?: unknown }).at !== 'string') {
    throw new Error(`${marker} exists but is not a migration record — fix or remove it before migrating`)
  }
  return parsed as { at: string }
}

export async function migrateFrames(opts: MigrateOptions): Promise<MigrateResult> {
  const report = opts.report ?? ((m: string) => console.log(m))
  const now = opts.now ?? (() => new Date())
  const undo = opts.undo === true
  const cacheDir = resolve(opts.cacheDir)
  const marker = join(cacheDir, MARKER_FILE)

  // Read everything before writing anything: the refusal below has to see
  // every sidecar, and a refusal must leave the directory exactly as found.
  const entries: Entry[] = []
  const names = (await readdir(cacheDir)).filter((f) => f.endsWith('.json')).sort()
  for (const name of names) {
    const file = join(cacheDir, name)
    let meta: Sidecar
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
      meta = parsed as Sidecar
    } catch (err) {
      entries.push({ file, meta: {}, format: undefined, unreadable: true, problem: `not a readable sidecar (${err instanceof Error ? err.message : String(err)})` })
      continue
    }
    const entry: Entry = { file, meta, format: undefined }
    if (typeof meta.path !== 'string') entry.problem = 'no path'
    else if ((entry.format = modelFormat(meta.path)) === undefined) entry.problem = `cannot classify ${meta.path}`
    else if (has(meta.axis) && !isAxis(meta.axis)) {
      entry.problem = `${meta.path}: axis ${JSON.stringify(meta.axis)} is not a spindle`
    }
    entries.push(entry)
  }

  // The refusal (D5, Risks): the marker says a run happened at `at`; a framed
  // sidecar still unlabelled but written after that is one a server without
  // the label wrote — relabelling it would turn a file axis into `-y`. Only
  // a forward run can do that damage, so only a forward run refuses.
  if (!undo) {
    const record = await readMarker(marker)
    if (record !== null) {
      const since = Date.parse(record.at)
      if (Number.isNaN(since)) throw new Error(`${marker} carries an unreadable timestamp ${JSON.stringify(record.at)}`)
      const newer: string[] = []
      for (const e of entries) {
        if (e.problem !== undefined || !framed(e.meta) || e.meta.frame !== undefined) continue
        if ((await stat(e.file)).mtimeMs > since) newer.push(e.file)
      }
      if (newer.length > 0) {
        throw new Error(
          `refusing ${cacheDir}: ${newer.length} framed sidecar(s) carry no frame label but were modified after the ` +
            `migration recorded in ${marker} (${record.at}):\n${newer.map((f) => `  ${f}`).join('\n')}\n` +
            'They were written after the migration by a server without the label (a rolled-back server), OR this ' +
            'directory was copied without preserving modification times (`cp -r` rather than `cp -a`/`rsync -a`) — ' +
            'run `--undo` before rolling the server back, or restore mtimes. Nothing was written.',
        )
      }
    }
  }

  const counts = { relabelled: 0, reExpressed: 0, labelOnly: 0, alreadyLabelled: 0, unclassifiable: 0, skipped: 0 }
  for (const e of entries) {
    if (e.unreadable !== true && !framed(e.meta)) {
      // Pixels only: nothing to migrate, and the label is never written to an
      // entry with no framing — whatever its path.
      counts.skipped++
      continue
    }
    if (e.problem !== undefined || e.format === undefined) {
      counts.unclassifiable++
      report(`  untouched, ${e.problem ?? 'unclassifiable'}: ${e.file}`)
      continue
    }
    // Forward touches only an unlabelled sidecar; undo only a labelled one.
    const inSource = undo ? e.meta.frame === FRAME_CONVENTION : e.meta.frame === undefined
    if (!inSource) {
      counts.alreadyLabelled++
      continue
    }
    const { next, outcome } = transform(e.meta, e.format, undo)
    // Plain truncate-and-write, as `writeMeta` does — the render files beside
    // it are not touched.
    await writeFile(e.file, JSON.stringify(next))
    counts[outcome]++
  }

  if (undo) {
    await rm(marker, { force: true })
  } else {
    await writeFile(marker, JSON.stringify({ convention: FRAME_CONVENTION, at: now().toISOString(), counts }))
  }

  const result: MigrateResult = { read: entries.length, ...counts, marker }
  report(
    `${undo ? 'undid' : 'migrated'} ${cacheDir}: ${result.read} sidecars read, ${result.relabelled} axes ` +
      `${undo ? 'put back' : 'relabelled'}, ${result.reExpressed} OBJ cameras ${undo ? 'restored' : 're-expressed'}, ` +
      `${result.labelOnly} label-only, ${result.alreadyLabelled} ${undo ? 'without the label' : 'already labelled'}, ` +
      `${result.unclassifiable} unclassifiable, ${result.skipped} unframed; marker ${undo ? 'removed' : 'written'}: ${marker}`,
  )
  return result
}

export const USAGE = 'usage: bun run scripts/migrate-frames.ts --cache-dir <dir> [--undo]'

export function parseArgs(argv: string[]): MigrateOptions {
  let cacheDir: string | undefined
  let undo = false
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--undo') {
      undo = true
    } else if (flag === '--cache-dir') {
      cacheDir = argv[++i]
      if (cacheDir === undefined) throw new Error(USAGE)
    } else {
      // Rejected, not ignored: a misspelled --undo would otherwise run the
      // migration forward over a directory the operator meant to revert.
      throw new Error(`unknown flag ${flag}\n${USAGE}`)
    }
  }
  if (cacheDir === undefined) throw new Error(USAGE)
  return { cacheDir, undo }
}

// Run only when invoked directly, so the core above can be imported by the
// suite. `import.meta.main` would be shorter but is not in the Node types this
// workspace typechecks against.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateFrames(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
