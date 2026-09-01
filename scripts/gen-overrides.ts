/**
 * Generate a library's override store from the corpus metadata
 * (`metadata/miniatures.json`) — the demo's CC-BY credits, and each kit's real
 * title (library-overrides D5).
 *
 *   bun run scripts/gen-overrides.ts --top <library-top> --metadata <file> [--kits <dir>]
 *
 * Node APIs only, though scripts here may use Bun: the core below is exported
 * and exercised by `server/test/genOverrides.test.ts`, whose tsconfig types are
 * Node's. It runs under `bun run` unchanged.
 *
 * The kit folders and the library top are two different things, so both are
 * taken. The corpus lays kits out as `<root>/miniatures/<variant>/<stem>/`, so
 * "`/` + stem" is a valid key only when the library top *is* the variant
 * directory; every key is `/` plus the top-relative path of `<kitsDir>/<stem>`.
 * A kit directory outside the top is refused before anything is written —
 * outside, `relative()` yields `..`-keys that normalise into plausible wrong
 * spellings rather than errors.
 *
 * Only top-level `stem` values name kit folders. The nested `files[].stem`
 * entries are file stems, and there are 2,801 of them.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MARKER_DIR } from '../server/src/library'
import { STORE_FILE, type OverridesFile, writeOverrides } from '../server/src/overrides'
import type { OverrideCredits, OverrideEntry } from '../shared/types'

/** One kit as `miniatures.json` carries it. Everything else is ignored. */
interface Kit {
  stem?: unknown
  name?: unknown
  author?: unknown
  author_url?: unknown
  license?: unknown
  source_url?: unknown
}

export interface GenerateOptions {
  /** The library top — what every generated key is relative to. */
  top: string
  /** Where the kit folders live. Defaults to the top; must be it or beneath it. */
  kitsDir?: string
  /** Path to `miniatures.json`. */
  metadata: string
  /** Where progress and misses go. Defaults to stdout. */
  report?: (message: string) => void
}

export interface GenerateResult {
  /** Kits carrying a usable top-level `stem` in the metadata. */
  read: number
  /** Keys written — kits whose folder exists under the kit directory. */
  written: number
  /** Stems naming no directory under the kit directory, in metadata order. */
  missing: string[]
  /** Stems that resolved outside the kit directory, or onto it — refused, never keyed. */
  escaped: string[]
  /** Stems whose key another stem already wrote this run — reported, keyed once. */
  duplicated: string[]
  /** The store that was written. */
  file: string
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The four attribution fields, or undefined when the kit carries none of them. */
function creditsOf(kit: Kit): OverrideCredits | undefined {
  const credits: OverrideCredits = {}
  const author = str(kit.author)
  const authorUrl = str(kit.author_url)
  const license = str(kit.license)
  const sourceUrl = str(kit.source_url)
  if (author !== undefined) credits.author = author
  if (authorUrl !== undefined) credits.authorUrl = authorUrl
  if (license !== undefined) credits.license = license
  if (sourceUrl !== undefined) credits.sourceUrl = sourceUrl
  return Object.keys(credits).length === 0 ? undefined : credits
}

/**
 * The existing store, read as **raw JSON** rather than through
 * `loadOverrides`.
 *
 * Deliberate, and the two readers have opposite jobs: the loader's is to
 * protect resolution, so it drops keys it cannot spell and empties a file whose
 * version it does not know — and merging through it would delete exactly the
 * data this generator is required to preserve. The generator's job is to
 * replace the fields it owns and keep everything else, so it must see the file
 * as written.
 *
 * A file that is present but unusable is **refused**, never overwritten: a
 * store this build cannot merge into is a store whose contents it would destroy
 * by rewriting. Absent is simply a fresh store.
 */
async function readStore(top: string): Promise<OverridesFile> {
  const path = join(top, MARKER_DIR, STORE_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { version: 1, entries: {} }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${path} exists but is not valid JSON — fix or remove it before generating`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} exists but is not an object — fix or remove it before generating`)
  }
  const file = parsed as OverridesFile
  if (file.version !== 1) {
    throw new Error(
      `${path} carries version ${JSON.stringify(file.version)}, which this generator cannot merge into`,
    )
  }
  if (file.entries === undefined) file.entries = {}
  if (typeof file.entries !== 'object' || file.entries === null || Array.isArray(file.entries)) {
    throw new Error(`${path} has a non-object "entries" — fix or remove it before generating`)
  }
  return file
}

/**
 * `join` preserves a stem's trailing separator — `join('/lib', './')` is
 * `'/lib/'` — and `'/lib/'.startsWith('/lib/')` is true, so an unnormalised
 * path slips both the `=== kitsDir` test and the prefix test (review round
 * four: the root key survived two rounds of guards this way). The joined
 * per-stem path goes through here before the predicate judges it; `kitsDir`
 * itself arrives normalised from `resolve`.
 */
function trimSep(p: string): string {
  let out = p
  while (out.length > 1 && out.endsWith(sep)) out = out.slice(0, -1)
  return out
}

/**
 * Textual containment: is `dir` the top, or beneath it? Not a `realpath`
 * test — the check has to hold for a directory that does not exist yet, and
 * `resolve` is what collapses the `..` this refuses. `top + sep` alone would
 * double the separator when the top IS the filesystem root, refusing every
 * legitimate directory under it — which is why this is its own function with
 * its own test (a root-topped library cannot be fixtured end to end).
 */
export function underTop(top: string, dir: string): boolean {
  const prefix = top.endsWith(sep) ? top : top + sep
  return dir === top || dir.startsWith(prefix)
}

export async function generateOverrides(opts: GenerateOptions): Promise<GenerateResult> {
  const report = opts.report ?? ((m: string) => console.log(m))
  const top = resolve(opts.top)
  const kitsDir = opts.kitsDir === undefined ? top : resolve(opts.kitsDir)
  if (!underTop(top, kitsDir)) {
    throw new Error(`the kit directory must be the library top or beneath it: ${kitsDir} is not under ${top}`)
  }

  const parsed: unknown = JSON.parse(await readFile(opts.metadata, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${opts.metadata} is not an array of kits`)
  }
  const kits = parsed as Kit[]

  const file = await readStore(top)
  const missing: string[] = []
  const escaped: string[] = []
  const duplicated: string[] = []
  const seen = new Set<string>()
  let read = 0
  let written = 0

  for (const kit of kits) {
    const stem = str(kit.stem)
    if (stem === undefined) continue
    read++
    const dir = trimSep(join(kitsDir, stem))
    const s = await stat(dir).catch(() => null)
    if (s === null || !s.isDirectory()) {
      if (!missing.includes(stem)) missing.push(stem)
      continue
    }
    // The containment check above guards the kit *directory*; a stem carrying
    // `..` escapes through `join` per key (an absolute stem does NOT — POSIX
    // `join` treats it as relative). The invariant is that a stem names a kit
    // STRICTLY UNDER the kit directory: anything else — the top itself (whose
    // key's credits would inherit to every model in the library: false
    // attribution at maximum blast radius), the kits dir, or any directory
    // above or beside it — is refused. Found by review twice over: the first
    // guard tested `rel` shapes and missed the `.`/`..`-onto-the-top case that
    // the old `rel === '' ? '/' : …` ternary quietly minted the root key for;
    // testing containment under kitsDir subsumes every shape. Escapes are
    // their own list and report line — filing them under `missing` printed
    // "no directory for stem" about directories that exist.
    if (dir === kitsDir || !underTop(kitsDir, dir)) {
      if (!escaped.includes(stem)) escaped.push(stem)
      continue
    }
    const rel = relative(top, dir)
    const key = `/${rel.split(sep).join('/')}`
    // A duplicate stem in the metadata is one key, counted once — the reported
    // count is what the credits-page gate consumes, and it must mean keys. (A
    // key already in the FILE is fine — that is what a rerun looks like.)
    if (seen.has(key)) {
      if (!duplicated.includes(stem)) duplicated.push(stem)
      continue
    }
    seen.add(key)
    // Merge, never replace: a `pose` written by later tooling, and any field or
    // key this generator does not own, survives a rerun.
    const entry: OverrideEntry = { ...file.entries[key] }
    const name = str(kit.name)
    if (name === undefined) delete entry.name
    else entry.name = name
    const credits = creditsOf(kit)
    if (credits === undefined) delete entry.credits
    else entry.credits = credits
    file.entries[key] = entry
    written++
  }

  await writeOverrides(top, file)

  const storePath = join(top, MARKER_DIR, STORE_FILE)
  report(`wrote ${written} keys from ${read} kits read into ${storePath}`)
  report(`keys are relative to ${top}; kit folders were looked for under ${kitsDir}`)
  for (const stem of missing) report(`  no directory for stem: ${stem}`)
  if (missing.length > 0) report(`${missing.length} stems named no directory and were skipped`)
  for (const stem of escaped) report(`  stem escapes the kit directory and was refused: ${stem}`)
  if (escaped.length > 0) report(`${escaped.length} stems escaped the kit directory and were refused`)
  for (const stem of duplicated) report(`  duplicate stem, keyed once: ${stem}`)
  if (duplicated.length > 0) report(`${duplicated.length} stems duplicated keys and were keyed once`)
  // The same rule every config file here has. The store is read once per
  // resolved library, so a running server keeps answering from what it loaded.
  report('the server reads this file once per resolved library — restart it to pick this up')

  return { read, written, missing, escaped, duplicated, file: storePath }
}

const USAGE =
  'usage: bun run scripts/gen-overrides.ts --top <library-top> --metadata <miniatures.json> [--kits <dir>]'

function parseArgs(argv: string[]): GenerateOptions {
  const values: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error(USAGE)
    }
    const name = flag.slice(2)
    // Rejected, not collected: a misspelled --kit would otherwise be swallowed
    // and the kit directory would silently default to the top — wrong keys
    // with a clean exit.
    if (name !== 'top' && name !== 'metadata' && name !== 'kits') {
      throw new Error(`unknown flag ${flag}\n${USAGE}`)
    }
    values[name] = value
  }
  const top = values.top
  const metadata = values.metadata
  if (top === undefined || metadata === undefined) throw new Error(USAGE)
  return { top, metadata, kitsDir: values.kits }
}

// Run only when invoked directly, so the core above can be imported by the
// suite. `import.meta.main` would be shorter but is not in the Node types this
// workspace typechecks against.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateOverrides(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
