/**
 * Bake the demo's thumbnail store: drive both *Generate* passes against a
 * server this script owns, verify every sidecar on disk and the unposed ones
 * against the index, write the manifest the box's pin check reads, and say how
 * to ship it (corpus-bake D1).
 *
 *   bun run scripts/bake-demo.ts --root <corpus top> --cache <scratch cache dir>
 *     --index-cache <the index's cache dir> [--port 3199] [--client <scratch build dir>]
 *     [--ship <user@host> --ship-dir </srv/cache/<box id>>]
 *
 * Node APIs only in the core below, though the driver may use Bun: the core is
 * exported and exercised by `server/test/bakeDemo.test.ts`, whose tsconfig
 * types are Node's, exactly as `gen-overrides.ts` is by `genOverrides.test.ts`.
 * It runs under `bun run` unchanged.
 *
 * The core is what a run must agree on and what a cell can pin without a
 * browser: `verifyBake` (D1 step 7 — the store, whole, on disk), `auditUnposed`
 * (step 8's judgement over an answer the driver fetched), `manifestFor` and
 * `writeManifest` (step 9, D2 — the shape and the one serialisation the check
 * on the box reads line by line), `indexFingerprint` (the two hashes D6 pins
 * the redeploy to) and `rsyncCommand` (D4). The driver — the scratch build,
 * the child server, the two headless passes, the pose fetch, the check and the
 * ship — is the other half of this file.
 *
 * The recipe (`RIG_VERSION`, `THUMB_LIGHTING`, `THUMB_SIZE`, `POSE_VERSION`) is
 * the driver's to import from the client modules; the core takes it as a value
 * so the server suite, which cannot resolve `three`, can exercise it.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SNAPSHOT_DIR } from '../server/src/snapshot'
import type { IndexPose, LightingMode } from '../shared/types'

/** One enumerated model — `/api/models`' library path and file mtime. */
export interface BakeModel {
  path: string
  mtime: number
}

/** What every render in the store must have been drawn under. */
export interface BakeRecipe {
  rig: number
  poseVersion: number
  lighting: LightingMode
}

/** The recipe as the manifest records it: `BakeRecipe` plus the pixel size. */
export interface ManifestRecipe extends BakeRecipe {
  size: number
}

/** A model the store does not hold correctly, with every reason found. */
export interface BakeMiss {
  path: string
  reasons: string[]
}

export interface VerifyResult {
  /** Every model that failed a check, in enumeration order, with all its reasons. */
  misses: BakeMiss[]
  /** Renders present on disk per variant — `<key>.webp` and `<key>.noao.webp`. */
  renders: { ao: number; noao: number }
  /** Models whose labels carry `posed` (both renders) / carry none. */
  posed: number
  unposed: number
  /** The unposed models' paths — what `auditUnposed` judges against the index. */
  unlabelled: string[]
  /**
   * Why the manifest must not be written, or `null` when the store passes. Any
   * miss refuses; so does a posed count of zero, which is the unposed
   * corpus-wide bake by another road (D1 step 7).
   */
  refusal: string | null
}

/**
 * A sidecar as it lies on disk — the fields `verifyBake` reads, typed loosely
 * because the file is read raw. The real shape is `ThumbCache`'s `Meta` (not
 * exported); the cells write their fixture through `ThumbCache.put`, so a drift
 * between the two fails every cell rather than passing one.
 */
interface SidecarLabels {
  mtime?: unknown
  lighting?: unknown
  rig?: unknown
  posed?: unknown
  poseKey?: unknown
}
interface Sidecar extends SidecarLabels {
  noao?: SidecarLabels
}

/** `ThumbCache.key` — the sidecar's name is the SHA-256 of the library path. */
export function sidecarKey(path: string): string {
  return createHash('sha256').update(path).digest('hex')
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null)) !== null
}

/**
 * One render's labels against the recipe. `name` is `ao` for the top-level set
 * (the occluded render) and `noao` for the sibling's, so a reason says which
 * render it is about. Answers whether the set carries `posed`.
 */
function checkLabels(name: string, labels: SidecarLabels, model: BakeModel, recipe: BakeRecipe, reasons: string[]): boolean {
  if (labels.mtime !== model.mtime) reasons.push(`${name}: mtime ${String(labels.mtime)}, model ${model.mtime}`)
  if (labels.lighting !== recipe.lighting) reasons.push(`${name}: lighting ${String(labels.lighting)}, recipe ${recipe.lighting}`)
  if (labels.rig !== recipe.rig) reasons.push(`${name}: rig ${String(labels.rig)}, recipe ${recipe.rig}`)
  const posed = labels.posed !== undefined
  if (posed) {
    if (labels.posed !== recipe.poseVersion) reasons.push(`${name}: posed ${String(labels.posed)}, recipe ${recipe.poseVersion}`)
    if (typeof labels.poseKey !== 'string') reasons.push(`${name}: posed without a poseKey`)
  }
  return posed
}

/**
 * D1 step 7: the store on disk, whole, against the enumeration and the recipe.
 * For every model the sidecar at `<cacheDir>/<libraryId>/<sha256(path)>.json`
 * exists; both renders exist; the top-level and the `noao` labels each carry
 * the model's `mtime`, the recipe's `lighting` and `rig`; where a label set
 * carries `posed` it equals the recipe's `poseVersion` and `poseKey` is
 * present. Every miss is listed with all its reasons — a hand fixing a store
 * wants the whole list, not the first failure.
 *
 * A model is *posed* when both label sets carry `posed` and *unposed* when
 * neither does; one render posed beside an unposed sibling is a miss — the two
 * were drawn under different orientations, which is the very state `put`'s
 * unowned-pose rule invalidates.
 */
export async function verifyBake(cacheDir: string, libraryId: string, models: BakeModel[], recipe: BakeRecipe): Promise<VerifyResult> {
  const dir = join(cacheDir, libraryId)
  const misses: BakeMiss[] = []
  const renders = { ao: 0, noao: 0 }
  const unlabelled: string[] = []
  let posed = 0
  let unposed = 0

  for (const model of models) {
    const key = sidecarKey(model.path)
    const reasons: string[] = []
    if (await exists(join(dir, `${key}.webp`))) renders.ao++
    else reasons.push(`no ${key}.webp`)
    if (await exists(join(dir, `${key}.noao.webp`))) renders.noao++
    else reasons.push(`no ${key}.noao.webp`)

    let sidecar: Sidecar | null = null
    try {
      sidecar = JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8')) as Sidecar
    } catch {
      reasons.push(`no sidecar ${key}.json`)
    }
    if (sidecar !== null) {
      const aoPosed = checkLabels('ao', sidecar, model, recipe, reasons)
      let noaoPosed = false
      if (sidecar.noao === undefined) reasons.push('noao: no labels')
      else noaoPosed = checkLabels('noao', sidecar.noao, model, recipe, reasons)
      if (aoPosed !== noaoPosed) reasons.push('posed on one render only')
      else if (aoPosed) posed++
      else {
        unposed++
        unlabelled.push(model.path)
      }
    }
    if (reasons.length > 0) misses.push({ path: model.path, reasons })
  }

  let refusal: string | null = null
  if (misses.length > 0) refusal = `${misses.length} of ${models.length} models fail verification`
  else if (posed === 0) refusal = `no model is posed — the index framed nothing (an unposed bake corpus-wide)`
  return { misses, renders, posed, unposed, unlabelled, refusal }
}

export interface UnposedAudit {
  /** Absent from the answer: the index was not asked, or did not answer. */
  unsettled: string[]
  /** Answered with a pose: the render should have been posed. */
  shouldHavePosed: string[]
}

/**
 * D1 step 8's judgement over `/api/semantic/poses`' merged answer for the
 * unlabelled paths: each must come back **present and `null`** — a settled
 * absence. Presence is `Object.hasOwn`, never `answer[p] == null`: the route
 * files an unsettled path by leaving it *out* of the map and a settled absence
 * by filing `null`, and reading the two alike is exactly the `??`/`!==`
 * confusion `enumerate`'s comment warns about — it would pass a bake whose pose
 * wave silently failed.
 */
export function auditUnposed(unlabelled: string[], answer: Record<string, IndexPose | null>): UnposedAudit {
  const unsettled: string[] = []
  const shouldHavePosed: string[] = []
  for (const p of unlabelled) {
    if (!Object.hasOwn(answer, p)) unsettled.push(p)
    else if (answer[p] !== null) shouldHavePosed.push(p)
  }
  return { unsettled, shouldHavePosed }
}

/** What the index's own `/status` said at bake time (D1 step 4), plus the two hashes (D6). */
export interface IndexFacts {
  /** The bake instance's `/api/semantic/status` `collectionRoot` — must be `/`. */
  collectionRoot: string
  /** `cache_dir` as `/status` reports it — the string the index was started with. */
  cacheDir: string
  /** `n_models` — how many models the index answers a pose for; not the enumeration's count. */
  models: number
  views: number
  elevations: number[]
  upAxis: string
  poseCacheSha256: string
  runParamsSha256: string
}

/** One *Generate* pass's figures: renders the job made and the seconds it took. */
export interface PassFigures {
  rendered: number
  elapsed: number
}

export interface ManifestInput {
  /** ISO 8601 — `new Date().toISOString()` at write time. */
  date: string
  /** `git rev-parse HEAD` (omitted when git could not answer) and whether the tree was dirty. */
  client: { commit?: string; dirty: boolean }
  recipe: ManifestRecipe
  library: { id: string; root: string }
  /** The enumeration's count — `/api/models?path=/`. */
  models: number
  /** `verifyBake`'s result for the store being described; the counts come from it. */
  verify: Pick<VerifyResult, 'renders' | 'posed' | 'unposed'>
  passes: { ao: PassFigures; noao: PassFigures }
  index: IndexFacts
}

/** The manifest, D2's shape — key order here is the order the file carries. */
export interface BakeManifest {
  version: 1
  date: string
  client: { commit?: string; dirty: boolean }
  recipe: ManifestRecipe
  library: { id: string; root: string }
  models: number
  renders: { ao: number; noao: number }
  posedModels: number
  unposedModels: number
  rate: { ao: number; noao: number }
  elapsed: { ao: number; noao: number; total: number }
  index: IndexFacts
}

/** Renders per second to one decimal; a pass that took no time rates 0, never `Infinity` (which JSON writes as `null`). */
function rateOf(pass: PassFigures): number {
  return pass.elapsed > 0 ? Math.round((pass.rendered / pass.elapsed) * 10) / 10 : 0
}

/**
 * D2's shape from what the run learned. The names are pinned there:
 * `recipe.poseVersion` (never a key named `posed` — the sidecar's label is the
 * same number, but a manifest key that collides with `posedModels` was the
 * misread waiting to happen), `posedModels`/`unposedModels`, and the two hashes
 * under `index.poseCacheSha256`/`index.runParamsSha256` — never `sha256`, since
 * two `"sha256"` lines under two parents would each match a line-oriented read
 * twice. `index.models` is the index's `n_models`, not the enumeration's
 * `models`; on this corpus they differ (2,976 against 3,121).
 */
export function manifestFor(input: ManifestInput): BakeManifest {
  const { ao, noao } = input.passes
  // `commit` before `dirty`, as D2's sample shows — the sample is what an
  // operator diffs a real bake.json against, so the writer's order is its order.
  const client: BakeManifest['client'] =
    input.client.commit !== undefined
      ? { commit: input.client.commit, dirty: input.client.dirty }
      : { dirty: input.client.dirty }
  return {
    version: 1,
    date: input.date,
    client,
    recipe: {
      rig: input.recipe.rig,
      poseVersion: input.recipe.poseVersion,
      lighting: input.recipe.lighting,
      size: input.recipe.size,
    },
    library: { id: input.library.id, root: input.library.root },
    models: input.models,
    renders: { ao: input.verify.renders.ao, noao: input.verify.renders.noao },
    posedModels: input.verify.posed,
    unposedModels: input.verify.unposed,
    rate: { ao: rateOf(ao), noao: rateOf(noao) },
    elapsed: { ao: ao.elapsed, noao: noao.elapsed, total: ao.elapsed + noao.elapsed },
    index: {
      collectionRoot: input.index.collectionRoot,
      cacheDir: input.index.cacheDir,
      models: input.index.models,
      views: input.index.views,
      elevations: [...input.index.elevations],
      upAxis: input.index.upAxis,
      poseCacheSha256: input.index.poseCacheSha256,
      runParamsSha256: input.index.runParamsSha256,
    },
  }
}

/** The manifest's home under the id directory — a subdirectory, so neither sweep parses it as a sidecar (D2). */
export const MANIFEST_DIR = 'bake'
export const MANIFEST_FILE = 'bake.json'

export function manifestPath(cacheDir: string, libraryId: string): string {
  return join(cacheDir, libraryId, MANIFEST_DIR, MANIFEST_FILE)
}

/**
 * The one serialisation: `JSON.stringify(m, null, 2)` and nothing else — two-
 * space indent, every key on its own line, arrays one element per line, no
 * trailing newline. `deploy/demo/check-bake.sh` reads the file line by line
 * with `grep`/`sed`, so this formatting *is* the contract; a manifest produced
 * any other way is refused there, not misread.
 */
export function manifestText(manifest: BakeManifest): string {
  return JSON.stringify(manifest, null, 2)
}

/** Writes the manifest to `manifestPath` (creating `bake/`) and answers where it went. */
export async function writeManifest(cacheDir: string, libraryId: string, manifest: BakeManifest): Promise<string> {
  const file = manifestPath(cacheDir, libraryId)
  await mkdir(join(cacheDir, libraryId, MANIFEST_DIR), { recursive: true })
  await writeFile(file, manifestText(manifest))
  return file
}

export async function sha256File(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

/** The two files under `--index-cache` — `pose-cache.json` and `run-params.json` — that the poses are a function of (D6). */
export const POSE_CACHE_FILE = 'pose-cache.json'
export const RUN_PARAMS_FILE = 'run-params.json'

/**
 * The index fingerprint: one hash per file, each under its own manifest key.
 * A re-embed rewrites `pose-cache.json`; a changed view configuration leaves it
 * alone and moves every `front` through `run-params.json`, hence every
 * `poseKey` — so both are hashed, and a missing file throws rather than
 * fingerprinting half an index.
 */
export async function indexFingerprint(indexCacheDir: string): Promise<Pick<IndexFacts, 'poseCacheSha256' | 'runParamsSha256'>> {
  return {
    poseCacheSha256: await sha256File(join(indexCacheDir, POSE_CACHE_FILE)),
    runParamsSha256: await sha256File(join(indexCacheDir, RUN_PARAMS_FILE)),
  }
}

/** `dir` with exactly one trailing slash — rsync's "the contents of" spelling. */
function contentsOf(dir: string): string {
  return `${dir.replace(/\/+$/, '')}/`
}

/**
 * D4: the local id directory, whole, minus `snapshots/` (the box's own tree
 * snapshot), into the box's id directory — trailing slashes on both, so the
 * contents land in the target rather than a directory of the local id's name
 * under it, and **no `--delete`**: nothing on the box is removed by a ship, a
 * stale sidecar is overwritten by key. `boxDir` is the box's `/srv/cache/<box
 * id>`, an id that differs from the local one and is read from the box's
 * startup line, never assumed.
 */
export function rsyncCommand(localCache: string, localId: string, host: string, boxDir: string): string {
  return `rsync -az --info=progress2 --exclude '${SNAPSHOT_DIR}/' ${contentsOf(join(localCache, localId))} ${host}:${contentsOf(boxDir)}`
}
