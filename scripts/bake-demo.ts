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

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SNAPSHOT_DIR } from "../server/src/snapshot";
import {
  type DirEntry,
  type IndexAvailability,
  type IndexPose,
  type LibraryState,
  type LightingMode,
  type ModelsListing,
  POSES_MAX,
  type PosesResponse,
  THUMB_MIME,
  type ThumbGetResponse,
} from "../shared/types";

/** One enumerated model — `/api/models`' library path and file mtime. */
export interface BakeModel {
  path: string;
  mtime: number;
}

/** What every render in the store must have been drawn under. */
export interface BakeRecipe {
  rig: number;
  poseVersion: number;
  lighting: LightingMode;
}

/** The recipe as the manifest records it: `BakeRecipe` plus the pixel size. */
export interface ManifestRecipe extends BakeRecipe {
  size: number;
}

/** A model the store does not hold correctly, with every reason found. */
export interface BakeMiss {
  path: string;
  reasons: string[];
}

export interface VerifyResult {
  /** Every model that failed a check, in enumeration order, with all its reasons. */
  misses: BakeMiss[];
  /** Renders present on disk per variant — `<key>.webp` and `<key>.noao.webp`. */
  renders: { ao: number; noao: number };
  /** Models whose labels carry `posed` (both renders) / carry none. */
  posed: number;
  unposed: number;
  /** The unposed models' paths — what `auditUnposed` judges against the index. */
  unlabelled: string[];
  /**
   * Why the manifest must not be written, or `null` when the store passes. Any
   * miss refuses; so does a posed count of zero, which is the unposed
   * corpus-wide bake by another road (D1 step 7).
   */
  refusal: string | null;
}

/**
 * A sidecar as it lies on disk — the fields `verifyBake` reads, typed loosely
 * because the file is read raw. The real shape is `ThumbCache`'s `Meta` (not
 * exported); the cells write their fixture through `ThumbCache.put`, so a drift
 * between the two fails every cell rather than passing one.
 */
interface SidecarLabels {
  mtime?: unknown;
  lighting?: unknown;
  rig?: unknown;
  posed?: unknown;
  poseKey?: unknown;
}
interface Sidecar extends SidecarLabels {
  noao?: SidecarLabels;
}

/** `ThumbCache.key` — the sidecar's name is the SHA-256 of the library path. */
export function sidecarKey(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null)) !== null;
}

/** A plain JSON object — excludes `null` and arrays, which `typeof` alone would not. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * One render's labels against the recipe. `name` is `ao` for the top-level set
 * (the occluded render) and `noao` for the sibling's, so a reason says which
 * render it is about. Answers whether the set carries `posed`.
 */
function checkLabels(
  name: string,
  labels: SidecarLabels,
  model: BakeModel,
  recipe: BakeRecipe,
  reasons: string[],
): boolean {
  if (labels.mtime !== model.mtime)
    reasons.push(
      `${name}: mtime ${String(labels.mtime)}, model ${model.mtime}`,
    );
  if (labels.lighting !== recipe.lighting)
    reasons.push(
      `${name}: lighting ${String(labels.lighting)}, recipe ${recipe.lighting}`,
    );
  if (labels.rig !== recipe.rig)
    reasons.push(`${name}: rig ${String(labels.rig)}, recipe ${recipe.rig}`);
  const posed = labels.posed !== undefined;
  if (posed) {
    if (labels.posed !== recipe.poseVersion)
      reasons.push(
        `${name}: posed ${String(labels.posed)}, recipe ${recipe.poseVersion}`,
      );
    if (typeof labels.poseKey !== "string")
      reasons.push(`${name}: posed without a poseKey`);
  }
  return posed;
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
export async function verifyBake(
  cacheDir: string,
  libraryId: string,
  models: BakeModel[],
  recipe: BakeRecipe,
): Promise<VerifyResult> {
  const dir = join(cacheDir, libraryId);
  const misses: BakeMiss[] = [];
  const renders = { ao: 0, noao: 0 };
  const unlabelled: string[] = [];
  let posed = 0;
  let unposed = 0;

  for (const model of models) {
    const key = sidecarKey(model.path);
    const reasons: string[] = [];
    if (await exists(join(dir, `${key}.webp`))) renders.ao++;
    else reasons.push(`no ${key}.webp`);
    if (await exists(join(dir, `${key}.noao.webp`))) renders.noao++;
    else reasons.push(`no ${key}.noao.webp`);

    // `JSON.parse` succeeding is not "parsed as a sidecar": it can hand back
    // something that is not an object at all (a sidecar file whose contents
    // are literally `null`, or any other JSON scalar/array), which is not a
    // shape `checkLabels` can be trusted with. The catch below tracks parse
    // failure; `isRecord` here tracks shape failure — kept separate so each
    // gets its own reason — and `sidecar` is assigned only once both have
    // passed, so `sidecar !== null` means "parsed, and an object", never
    // reaching `checkLabels("noao", …)` with a non-object either.
    let sidecar: Sidecar | null = null;
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(dir, `${key}.json`), "utf8"),
      );
      if (isRecord(raw)) sidecar = raw as Sidecar;
      else reasons.push(`sidecar ${key}.json is not an object`);
    } catch {
      reasons.push(`no sidecar ${key}.json`);
    }
    if (sidecar !== null) {
      const aoPosed = checkLabels("ao", sidecar, model, recipe, reasons);
      // Mirrors the top-level parse above: absent (`undefined`, the key
      // never written) gets its own reason, and present-but-not-an-object
      // (`"noao": 5`, or JSON `null`) gets a different one — collapsing the
      // two made a malformed `noao` read as a missing one, telling the
      // operator a key is absent when it is present and wrong.
      let noao: SidecarLabels | undefined;
      let noaoPosed = false;
      if (sidecar.noao === undefined) reasons.push("noao: no labels");
      else if (!isRecord(sidecar.noao))
        reasons.push("noao: labels are not an object");
      else {
        noao = sidecar.noao;
        noaoPosed = checkLabels("noao", noao, model, recipe, reasons);
      }
      if (aoPosed !== noaoPosed) reasons.push("posed on one render only");
      else if (aoPosed && noao !== undefined) {
        // Both renders posed: they must have been drawn under the same
        // orientation. A scratch cache reused across sessions (`bake`'s
        // `mkdir(args.cache, {recursive: true})` never empties it) can carry
        // an ao render orbited in one session beside a noao render from
        // another — `put`'s unowned-entry pose rule does not catch it,
        // because a `camera` label exempts it.
        if (sidecar.poseKey !== noao.poseKey)
          reasons.push(
            `poseKey differs: ao ${String(sidecar.poseKey)}, noao ${String(noao.poseKey)}`,
          );
        posed++;
      } else {
        unposed++;
        unlabelled.push(model.path);
      }
    }
    if (reasons.length > 0) misses.push({ path: model.path, reasons });
  }

  let refusal: string | null = null;
  if (misses.length > 0)
    refusal = `${misses.length} of ${models.length} models fail verification`;
  else if (posed === 0)
    refusal = `no model is posed — the index framed nothing (an unposed bake corpus-wide)`;
  return { misses, renders, posed, unposed, unlabelled, refusal };
}

export interface UnposedAudit {
  /** Absent from the answer: the index was not asked, or did not answer. */
  unsettled: string[];
  /** Answered with a pose: the render should have been posed. */
  shouldHavePosed: string[];
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
export function auditUnposed(
  unlabelled: string[],
  answer: Record<string, IndexPose | null>,
): UnposedAudit {
  const unsettled: string[] = [];
  const shouldHavePosed: string[] = [];
  for (const p of unlabelled) {
    if (!Object.hasOwn(answer, p)) unsettled.push(p);
    else if (answer[p] !== null) shouldHavePosed.push(p);
  }
  return { unsettled, shouldHavePosed };
}

/** What the index's own `/status` said at bake time (D1 step 4), plus the two hashes (D6). */
export interface IndexFacts {
  /** The bake instance's `/api/semantic/status` `collectionRoot` — must be `/`. */
  collectionRoot: string;
  /** `cache_dir` as `/status` reports it — the string the index was started with. */
  cacheDir: string;
  /** `n_models` — how many models the index answers a pose for; not the enumeration's count. */
  models: number;
  views: number;
  elevations: number[];
  upAxis: string;
  poseCacheSha256: string;
  runParamsSha256: string;
}

/** One *Generate* pass's figures: renders the job made and the seconds it took. */
export interface PassFigures {
  rendered: number;
  elapsed: number;
}

export interface ManifestInput {
  /** ISO 8601 — `new Date().toISOString()` at write time. */
  date: string;
  /** `git rev-parse HEAD` (omitted when git could not answer) and whether the tree was dirty. */
  client: { commit?: string; dirty: boolean };
  recipe: ManifestRecipe;
  library: { id: string; root: string };
  /** The enumeration's count — `/api/models?path=/`. */
  models: number;
  /** `verifyBake`'s result for the store being described; the counts come from it. */
  verify: Pick<VerifyResult, "renders" | "posed" | "unposed">;
  passes: { ao: PassFigures; noao: PassFigures };
  index: IndexFacts;
}

/** The manifest, D2's shape — key order here is the order the file carries. */
export interface BakeManifest {
  version: 1;
  date: string;
  client: { commit?: string; dirty: boolean };
  recipe: ManifestRecipe;
  library: { id: string; root: string };
  models: number;
  renders: { ao: number; noao: number };
  posedModels: number;
  unposedModels: number;
  rate: { ao: number; noao: number };
  elapsed: { ao: number; noao: number; total: number };
  index: IndexFacts;
}

/** Renders per second to one decimal; a pass that took no time rates 0, never `Infinity` (which JSON writes as `null`). */
function rateOf(pass: PassFigures): number {
  return pass.elapsed > 0
    ? Math.round((pass.rendered / pass.elapsed) * 10) / 10
    : 0;
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
  const { ao, noao } = input.passes;
  // `commit` before `dirty`, as D2's sample shows — the sample is what an
  // operator diffs a real bake.json against, so the writer's order is its order.
  const client: BakeManifest["client"] =
    input.client.commit !== undefined
      ? { commit: input.client.commit, dirty: input.client.dirty }
      : { dirty: input.client.dirty };
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
    elapsed: {
      ao: ao.elapsed,
      noao: noao.elapsed,
      total: ao.elapsed + noao.elapsed,
    },
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
  };
}

/** The manifest's home under the id directory — a subdirectory, so neither sweep parses it as a sidecar (D2). */
export const MANIFEST_DIR = "bake";
export const MANIFEST_FILE = "bake.json";

export function manifestPath(cacheDir: string, libraryId: string): string {
  return join(cacheDir, libraryId, MANIFEST_DIR, MANIFEST_FILE);
}

/**
 * The one serialisation: `JSON.stringify(m, null, 2)` and nothing else — two-
 * space indent, every key on its own line, arrays one element per line, no
 * trailing newline. `deploy/demo/check-bake.sh` reads the file line by line
 * with `grep`/`sed`, so this formatting *is* the contract; a manifest produced
 * any other way is refused there, not misread.
 */
export function manifestText(manifest: BakeManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/** Writes the manifest to `manifestPath` (creating `bake/`) and answers where it went. */
export async function writeManifest(
  cacheDir: string,
  libraryId: string,
  manifest: BakeManifest,
): Promise<string> {
  const file = manifestPath(cacheDir, libraryId);
  await mkdir(join(cacheDir, libraryId, MANIFEST_DIR), { recursive: true });
  await writeFile(file, manifestText(manifest));
  return file;
}

export async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

/** The two files under `--index-cache` — `pose-cache.json` and `run-params.json` — that the poses are a function of (D6). */
export const POSE_CACHE_FILE = "pose-cache.json";
export const RUN_PARAMS_FILE = "run-params.json";

/**
 * The index fingerprint: one hash per file, each under its own manifest key.
 * A re-embed rewrites `pose-cache.json`; a changed view configuration leaves it
 * alone and moves every `front` through `run-params.json`, hence every
 * `poseKey` — so both are hashed, and a missing file throws rather than
 * fingerprinting half an index.
 */
export async function indexFingerprint(
  indexCacheDir: string,
): Promise<Pick<IndexFacts, "poseCacheSha256" | "runParamsSha256">> {
  return {
    poseCacheSha256: await sha256File(join(indexCacheDir, POSE_CACHE_FILE)),
    runParamsSha256: await sha256File(join(indexCacheDir, RUN_PARAMS_FILE)),
  };
}

/** `dir` with exactly one trailing slash — rsync's "the contents of" spelling. */
function contentsOf(dir: string): string {
  return `${dir.replace(/\/+$/, "")}/`;
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
export function rsyncCommand(
  localCache: string,
  localId: string,
  host: string,
  boxDir: string,
): string {
  return `rsync -az --info=progress2 --exclude '${SNAPSHOT_DIR}/' ${contentsOf(join(localCache, localId))} ${host}:${contentsOf(boxDir)}`;
}

// ─── The driver ──────────────────────────────────────────────────────────────
//
// D1 steps 1–6 and 8–11, around the core above. Node APIs only here too, though
// the design allows Bun: the server suite's `tsc` reaches this file through
// `bakeDemo.test.ts`, and there are no Bun types in this repo to check a
// `Bun.spawn` against — `node:child_process` runs under `bun run` unchanged.
// Two things are loaded by a non-literal dynamic `import()` so that program
// never follows them: the client's recipe constants (`renderer.ts` imports
// `three`, which the server workspace cannot resolve — design Context) and
// Playwright (found, never installed — `playwright-found.mjs`).

export interface BakeArgs {
  root: string;
  cache: string;
  indexCache: string;
  port: number;
  /** The scratch client build; a fresh temp directory when absent. Never `client/dist` (CLAUDE.md). */
  client?: string;
  ship?: string;
  /** A **remote** path on the box — never resolved against this machine's cwd (`originFromShip`, `rsyncCommand`'s `boxDir`). */
  shipDir?: string;
  /** Task 4.2's hit-check origin, overriding `originFromShip`'s derivation from `--ship`. */
  origin?: string;
}

export const USAGE = `usage: bun run scripts/bake-demo.ts --root <corpus top> --cache <scratch cache dir> --index-cache <the index's cache dir>
         [--port 3199] [--client <scratch build dir>] [--ship <user@host> --ship-dir </srv/cache/<box id>> [--origin <https://url>]]`;

const FLAGS = [
  "root",
  "cache",
  "index-cache",
  "port",
  "client",
  "ship",
  "ship-dir",
  "origin",
] as const;
type Flag = (typeof FLAGS)[number];

/**
 * `gen-overrides.ts`'s shape: every flag takes a value, an unknown flag is
 * rejected by name rather than collected — a misspelled `--index-cache` that
 * silently defaulted is how a wrong run would look clean — and the three
 * required flags are required. `--ship` needs `--ship-dir` (the rsync has no
 * target without it); `--ship-dir` alone only fills in the printed command.
 */
export function parseArgs(argv: string[]): BakeArgs {
  const values: Partial<Record<Flag, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined)
      throw new Error(USAGE);
    const name = flag.slice(2);
    if (!(FLAGS as readonly string[]).includes(name))
      throw new Error(`unknown flag ${flag}\n${USAGE}`);
    values[name as Flag] = value;
  }
  const root = values.root;
  const cache = values.cache;
  const indexCache = values["index-cache"];
  if (root === undefined || cache === undefined || indexCache === undefined)
    throw new Error(USAGE);
  const port = values.port === undefined ? 3199 : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`--port must be a port number, got ${values.port}`);
  if (values.ship !== undefined && values["ship-dir"] === undefined)
    throw new Error(`--ship needs --ship-dir\n${USAGE}`);
  // Absolute against `process.cwd()` here, once — everything downstream
  // (`writeManifest`, `realpath`, `indexFingerprint`, step 10's
  // `check-bake.sh` run under `cwd: repo`) reads these paths as given, so a
  // relative one resolved against the bake's own cwd stayed relative all the
  // way to a `run()` under a different cwd, reading `<repo>/…` instead.
  // `ship-dir` is deliberately absent from this list: it names a path on the
  // *box*, not this machine, and resolving it against this machine's cwd
  // silently turned a relative `--ship-dir` into a local path used as the
  // remote rsync destination.
  return {
    root: resolve(root),
    cache: resolve(cache),
    indexCache: resolve(indexCache),
    port,
    client: values.client === undefined ? undefined : resolve(values.client),
    ship: values.ship,
    shipDir: values["ship-dir"],
    origin: values.origin,
  };
}

/** The bake instance's `/api/semantic/status` is re-read until it stops saying `warming` (~16 s of SigLIP; the app itself calls it wedged at 180 s). */
const WARMING_DEADLINE_MS = 180_000;
/** How long `/api/library` may refuse connections while the child starts. */
const START_DEADLINE_MS = 60_000;
/** Between chip reads while a pass runs. */
const POLL_MS = 2_000;
/** A chip whose sentence has not changed for this long is a stuck pass (D1 step 6's "bounded time"). */
const STALL_MS = 5 * 60_000;
/**
 * Non-progressing launches per pass before the count that stuck is refused:
 * the first, and one relaunch. A launch that *did* progress (its count fell
 * below the **best** — lowest — count any launch this pass has seen, not
 * merely the launch immediately before it) resets this — a stalled-and-
 * cancelled launch must not spend the budget a later, productive relaunch
 * needs (D1 step 6's "a pass whose count stops falling for a bounded time is
 * relaunched once"). Comparing only to the previous launch let an
 * oscillating count (100, 99, 100, 99, …) reset the budget forever, since
 * each dip below its immediate predecessor counted as progress though the
 * count was never actually falling — `MAX_TOTAL_LAUNCHES` below is the bound
 * that still catches a sequence like that.
 */
const MAX_LAUNCHES = 2;
/**
 * A hard ceiling on launches a pass may make at all, independent of whether
 * `MAX_LAUNCHES` ever sees a stuck best — the backstop for any sequence
 * `MAX_LAUNCHES` does not bound (an oscillating count is already caught by
 * the best-tracking above once a value repeats, but this is the one bound
 * that holds regardless of the sequence's shape).
 */
const MAX_TOTAL_LAUNCHES = 200;
/** The default index base — `semantic.ts`'s `DEFAULT_BASE`, read from the same variable. */
const DEFAULT_INDEX = "http://127.0.0.1:8077";
/** Printed in the no-`--ship` template only — there is no `--ship` host to derive anything from yet. */
export const DEMO_ORIGIN = "https://models.masamaeda.com";
/** The restart after a ship (D3: for the startup sweep's memo, not for correctness). */
export const RESTART_COMMAND =
  "cd /opt/model-browser && docker compose -f deploy/demo/compose.yaml restart app";
/** How long the shipped app may still be booting, after `restart app`, before the first hit check. */
const SHIP_READY_DEADLINE_MS = 60_000;
/** Per-attempt bound on the readiness probe itself — `SHIP_READY_DEADLINE_MS` is only checked between attempts, so one black-holed connect (Linux's ~130s default) could otherwise overrun it. */
const SHIP_READY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Task 4.2's hit-check origin, resolved in this order: `--origin` when given
 * (the operator names the box's public host directly, and it wins even over
 * a name `--ship` would otherwise derive one from); else `https://<host>`
 * derived from `--ship`'s `user@host` (or bare `host`) when that host is a
 * *name*; else `null` — no origin can be derived, so hit-checking is refused
 * rather than defaulting to production (`DEMO_ORIGIN`), which would silently
 * verify the wrong box's store whenever `--ship` names any IP address (the
 * demo box itself is reached as `root@157.90.25.110` for `ssh`/`rsync` but
 * serves the demo at `models.masamaeda.com` — no certificate answers for the
 * bare address, and neither a bare IPv4 nor an IPv6 literal names anything a
 * `https://` origin could mean). `lastIndexOf` for the `@`, not `indexOf`:
 * a user portion that itself contains one (`user@host@weird`) must split at
 * the rightmost `@`, the one `ssh`/`rsync` themselves would use.
 */
export function originFromShip(
  ship: string,
  explicitOrigin?: string,
): string | null {
  if (explicitOrigin !== undefined) return explicitOrigin;
  const at = ship.lastIndexOf("@");
  const host = at === -1 ? ship : ship.slice(at + 1);
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIPv6 = host.includes(":");
  return host === "" || isIPv4 || isIPv6 ? null : `https://${host}`;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const T0 = Date.now();
function log(...parts: unknown[]): void {
  console.log(`[bake ${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...parts);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getJson<T>(url: string, fetchFn: FetchLike = fetch): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return (await res.json()) as T;
}

async function postPoses(
  base: string,
  batch: string[],
  fetchFn: FetchLike,
): Promise<Record<string, IndexPose | null>> {
  const res = await fetchFn(`${base}/api/semantic/poses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths: batch }),
  });
  if (!res.ok)
    throw new Error(
      `POST /api/semantic/poses answered ${res.status} for a batch of ${batch.length}`,
    );
  const body: unknown = await res.json();
  if (!isRecord(body) || !isRecord(body.poses))
    throw new Error("POST /api/semantic/poses answered no poses map");
  return body.poses as PosesResponse["poses"];
}

/**
 * D1 step 8's fetch: `paths` to the bake instance's `POST /api/semantic/poses`
 * in batches of at most `POSES_MAX` — the wire bound the route refuses past,
 * imported and never restated — and the answers merged into one map. A batch
 * that fails is retried once, then the failure names it. Judged afterwards by
 * `auditUnposed`; also the wave `confirmNothingLeft` primes the pose layer
 * with. Separate from the browser and the server so a cell can drive it with
 * a fake `fetch`.
 */
export async function fetchPoses(
  base: string,
  paths: string[],
  fetchFn: FetchLike = fetch,
): Promise<Record<string, IndexPose | null>> {
  const merged: Record<string, IndexPose | null> = {};
  for (let i = 0; i < paths.length; i += POSES_MAX) {
    const batch = paths.slice(i, i + POSES_MAX);
    const answer = await postPoses(base, batch, fetchFn).catch(() =>
      postPoses(base, batch, fetchFn),
    );
    Object.assign(merged, answer);
  }
  return merged;
}

/**
 * D1 step 4's compare between what the index's `/status` reports as
 * `cache_dir` — the string it was started with, `str(args.cache_dir)` — and
 * the realpath of `--index-cache`: an absolute report must equal the realpath,
 * a relative one (`embed-cache-test`, relative to the checkout's cwd) must
 * equal its basename. `normalize` so `./embed-cache-test/` reads as
 * `embed-cache-test`; nothing looser, since the fingerprint is taken from
 * `--index-cache` and this is what ties it to the index that framed the renders.
 */
export function indexCacheDirMatches(
  reported: string,
  indexCacheReal: string,
): boolean {
  const norm = normalize(reported).replace(/(?<=.)\/+$/, "");
  return isAbsolute(norm)
    ? norm === indexCacheReal
    : norm === basename(indexCacheReal);
}

/** What the index's own `/status` says (mini-classify `src/api.py` `status`), the fields the manifest keeps. */
interface IndexStatusWire {
  ready?: unknown;
  cache_dir?: unknown;
  views?: unknown;
  elevations?: unknown;
  up_axis?: unknown;
  n_models?: unknown;
  failure?: unknown;
}

/** The client's recipe constants, imported (never restated) from the modules that own them. */
async function loadRecipe(repo: string): Promise<ManifestRecipe> {
  // Non-literal specifiers, so the server suite's `tsc` does not follow them
  // into `three`; the values are checked here instead of typed there.
  const renderer = (await import(
    pathToFileURL(join(repo, "client/src/three/renderer.ts")).href
  )) as Record<string, unknown>;
  const pose = (await import(
    pathToFileURL(join(repo, "client/src/three/pose.ts")).href
  )) as Record<string, unknown>;
  const { RIG_VERSION, THUMB_LIGHTING, THUMB_SIZE } = renderer;
  const { POSE_VERSION } = pose;
  if (
    typeof RIG_VERSION !== "number" ||
    typeof THUMB_SIZE !== "number" ||
    typeof POSE_VERSION !== "number"
  ) {
    throw new Error(
      "renderer.ts/pose.ts no longer export numeric RIG_VERSION, THUMB_SIZE and POSE_VERSION",
    );
  }
  if (THUMB_LIGHTING !== "camera" && THUMB_LIGHTING !== "axis")
    throw new Error("renderer.ts THUMB_LIGHTING is not a LightingMode");
  return {
    rig: RIG_VERSION,
    poseVersion: POSE_VERSION,
    lighting: THUMB_LIGHTING,
    size: THUMB_SIZE,
  };
}

function run(cmd: string, args: string[], cwd: string): void {
  log("$", cmd, ...args);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

/** `git rev-parse HEAD` and whether `git status --porcelain` says anything — recorded, never refused (D1 step 1). */
function gitFacts(repo: string): { commit?: string; dirty: boolean } {
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  });
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: repo,
    encoding: "utf8",
  });
  const commit = head.status === 0 ? head.stdout.trim() : undefined;
  return {
    commit,
    dirty: status.status === 0 ? status.stdout.trim() !== "" : false,
  };
}

/** Refuses a port something already listens on — before the child is started, so the refusal names the port rather than a confusing startup failure. */
async function refuseBusyPort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `port ${port} is already in use — another instance on the scratch port?`,
            )
          : err,
      );
    });
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

interface ChildServer {
  exited: number | null;
  stop(): Promise<void>;
}

/**
 * The bake's own server (D1 step 3): `bun run server/src/index.ts` with the
 * scratch config, cache and client build, `MODEL_BROWSER_ROOT` unset so the
 * file's `root` is the root. Its output is relayed line by line under a
 * prefix — the `library <id> at <top>` startup line is the one to read.
 */
function startServer(
  repo: string,
  env: { configFile: string; cache: string; client: string },
): ChildServer {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.MODEL_BROWSER_ROOT;
  childEnv.MODEL_BROWSER_CONFIG = env.configFile;
  childEnv.MODEL_BROWSER_CACHE = env.cache;
  childEnv.MODEL_BROWSER_CLIENT = env.client;
  const child: ChildProcess = spawn("bun", ["run", "server/src/index.ts"], {
    cwd: repo,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const relay = (stream: NodeJS.ReadableStream | null, tag: string) => {
    let rest = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) console.log(`${tag} ${line}`);
    });
  };
  relay(child.stdout, "server │");
  relay(child.stderr, "server ‼");
  const gone = new Promise<void>((r) => child.once("exit", () => r()));
  const server: ChildServer = {
    exited: null,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([gone, sleep(3000)]);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await gone;
    },
  };
  child.on("exit", (code, signal) => {
    server.exited = code ?? (signal !== null ? 128 : 1);
  });
  // Belt and braces for a way out no handler saw (an uncaught throw in a
  // callback): `kill` is synchronous, so it works from the exit event.
  process.on("exit", () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  return server;
}

type ReadyLibrary = Extract<LibraryState, { state: "ready" }>;

/** Waits for `/api/library` to answer `ready`; refuses `nested`, `missing`, `unconfigured` by name, and a child that died first. */
async function waitForLibrary(
  base: string,
  server: ChildServer,
): Promise<ReadyLibrary> {
  const deadline = Date.now() + START_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (server.exited !== null)
      throw new Error(
        `the server exited (${server.exited}) before answering /api/library`,
      );
    const s = await getJson<LibraryState>(`${base}/api/library`).catch(
      () => null,
    );
    if (s !== null) {
      if (s.state === "ready") return s;
      const where =
        s.state === "nested"
          ? ` (root ${s.root ?? "?"} encloses a library at ${s.library ?? "?"})`
          : s.state === "missing"
            ? ` (root ${s.root ?? "?"})`
            : "";
      throw new Error(
        `the library is ${s.state}${where}; the bake needs ready`,
      );
    }
    await sleep(250);
  }
  throw new Error(
    `/api/library did not answer within ${START_DEADLINE_MS / 1000}s`,
  );
}

/** `/api/semantic/status?fresh=true` must read `ready`; waits through `warming`. */
async function indexThroughApp(base: string): Promise<IndexAvailability> {
  const deadline = Date.now() + WARMING_DEADLINE_MS;
  for (;;) {
    const s = await getJson<IndexAvailability>(
      `${base}/api/semantic/status?fresh=true`,
    );
    if (s.state === "ready") return s;
    if (s.state !== "warming" || Date.now() >= deadline) {
      throw new Error(
        `the index is ${s.state}${s.detail !== undefined ? ` — ${s.detail}` : ""}; the bake needs ready`,
      );
    }
    log(`index warming (${s.elapsed ?? "?"}s), waiting`);
    await sleep(POLL_MS);
  }
}

/** D1 step 4, the app's half: ready and covering the bake library's top. Refuses naming the root reported and the root wanted. */
async function requireIndexAtRoot(base: string): Promise<void> {
  const s = await indexThroughApp(base);
  if (s.collectionRoot !== "/") {
    const reported =
      s.collectionRoot ??
      `no library root${s.detail !== undefined ? ` (${s.detail})` : ""}`;
    throw new Error(
      `the index covers ${reported}; the bake wants a collection root of / (the library's top)`,
    );
  }
}

type DirectIndexFacts = Omit<
  IndexFacts,
  "collectionRoot" | "poseCacheSha256" | "runParamsSha256"
>;

/** D1 step 4, the index's half: its own `/status`, `ready` and `cache_dir` naming `--index-cache`; the four fields the manifest keeps. */
async function indexDirect(indexCache: string): Promise<DirectIndexFacts> {
  const indexBase = (process.env.MODEL_BROWSER_INDEX ?? DEFAULT_INDEX).replace(
    /\/+$/,
    "",
  );
  const s = await getJson<IndexStatusWire>(`${indexBase}/status`).catch(
    (err: unknown) => {
      throw new Error(
        `the index's own /status at ${indexBase} did not answer: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );
  if (s.ready !== true) {
    const failure =
      s.failure !== null && s.failure !== undefined
        ? ` (failure: ${String(s.failure)})`
        : "";
    throw new Error(
      `the index's /status reads ready: ${String(s.ready)}${failure}`,
    );
  }
  const real = await realpath(indexCache);
  if (
    typeof s.cache_dir !== "string" ||
    !indexCacheDirMatches(s.cache_dir, real)
  ) {
    throw new Error(
      `the index reports cache_dir ${String(s.cache_dir)}, but --index-cache is ${real} — the fingerprint would pin poses nobody rendered under`,
    );
  }
  if (
    typeof s.views !== "number" ||
    !Array.isArray(s.elevations) ||
    typeof s.n_models !== "number"
  ) {
    throw new Error(
      `the index's /status lacks views/elevations/n_models: ${JSON.stringify({ views: s.views, elevations: s.elevations, n_models: s.n_models })}`,
    );
  }
  return {
    cacheDir: s.cache_dir,
    models: s.n_models,
    views: s.views,
    elevations: s.elevations.map(Number),
    upAxis: String(s.up_axis ?? ""),
  };
}

/** D1 step 5: `/api/models?path=/`, whole; an incomplete enumeration is refused. */
async function enumerateModels(
  base: string,
): Promise<{ models: BakeModel[]; entries: DirEntry[] }> {
  const listing = await getJson<ModelsListing>(
    `${base}/api/models?path=${encodeURIComponent("/")}`,
  );
  if (!listing.complete) {
    throw new Error(
      "the enumeration is incomplete (the tree cache ran out of budget) — models would go unbaked and the count would never say so",
    );
  }
  const entries = listing.entries.filter((e) => e.kind === "model");
  if (entries.length === 0) throw new Error("the enumeration holds no models");
  return {
    models: entries.map((e) => ({ path: e.path, mtime: e.mtime })),
    entries,
  };
}

// ── Playwright, as much of it as the passes touch ──
interface PwLocator {
  first(): PwLocator;
  count(): Promise<number>;
  click(): Promise<void>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  locator(selector: string, options?: { hasText?: RegExp | string }): PwLocator;
}
interface PwResponse {
  status(): number;
  request(): { method(): string; url(): string };
}
interface PwPage {
  goto(
    url: string,
    options?: { waitUntil?: "domcontentloaded" },
  ): Promise<unknown>;
  locator(selector: string, options?: { hasText?: RegExp | string }): PwLocator;
  waitForSelector(
    selector: string,
    options?: { timeout?: number },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  on(event: "response", handler: (response: PwResponse) => void): void;
}
interface PwBrowser {
  newPage(options?: {
    viewport?: { width: number; height: number };
  }): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwChromium {
  launch(options: {
    headless: boolean;
    executablePath: string;
    args: string[];
  }): Promise<PwBrowser>;
}

async function launchChromium(): Promise<PwBrowser> {
  const found = (await import(
    new URL("./playwright-found.mjs", import.meta.url).href
  )) as {
    findModule(): string | null;
    findChrome(): string | null;
  };
  const modulePath = found.findModule();
  const chrome = found.findChrome();
  if (modulePath === null || chrome === null) {
    throw new Error(
      "needs a Playwright install this repo does not carry:\n  npx playwright install chromium   (downloads both the library and the browser)",
    );
  }
  const { chromium } = (await import(modulePath)) as { chromium: PwChromium };
  // The 2026-09-14 driver's flags: SwiftShader through ANGLE, and the third
  // because that launch needed it to admit an unaccelerated WebGL context.
  return chromium.launch({
    headless: true,
    executablePath: chrome,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
}

/** The corner pill (`App.tsx`, the button with `aria-pressed` reading `ssao`). */
function pill(page: PwPage): PwLocator {
  return page
    .locator("button[aria-pressed]", { hasText: /^\s*ssao\s*$/ })
    .first();
}

async function aoOn(page: PwPage): Promise<boolean> {
  return (await pill(page).getAttribute("aria-pressed")) === "true";
}

const GENERATE = /^Generate (\d+) missing thumbnails$/;

/**
 * Opens the `library` tab — via another tab first when it is already open,
 * since the count re-derives on open — and reads the button's count once it
 * has stopped `Counting…`. `Count failed` refuses: a scope that cannot be
 * enumerated cannot be baked.
 */
async function openLibraryTabAndCount(page: PwPage): Promise<number> {
  const tabs = page.locator('[role="tab"]');
  if ((await tabs.count()) === 0) {
    const expand = page.locator('button[aria-label="Expand side panel"]');
    if ((await expand.count()) > 0) await expand.first().click();
    await page.waitForSelector('[role="tab"]', { timeout: 30_000 });
  }
  const library = page.locator('[role="tab"]', { hasText: /library/i }).first();
  if ((await library.getAttribute("aria-selected")) === "true") {
    await page
      .locator('[role="tab"]', { hasText: /search/i })
      .first()
      .click();
    await page.waitForTimeout(300);
  }
  await library.click();
  const button = page
    .locator("button", {
      hasText: /Generate .* missing thumbnails|Counting…|Count failed/,
    })
    .first();
  const deadline = Date.now() + 120_000;
  for (;;) {
    const text = ((await button.textContent().catch(() => null)) ?? "").trim();
    const m = GENERATE.exec(text);
    if (m !== null) return Number(m[1]);
    if (text === "Count failed")
      throw new Error(
        "the library tab could not count the scope (Count failed)",
      );
    if (Date.now() >= deadline)
      throw new Error(
        `the library tab never finished counting (button reads "${text}")`,
      );
    await page.waitForTimeout(500);
  }
}

/**
 * The chip (`JobChip`, `role="status"`) with no Cancel button — `BulkJobs.run`'s
 * last patch sets `phase: 'done'` and `settled: true` together, and Cancel is
 * offered exactly in the three live phases. No chip at all is not settled: it
 * is a job that has not been launched.
 */
async function chipSettled(page: PwPage): Promise<boolean> {
  const chip = page.locator('[role="status"]').first();
  if ((await chip.count()) === 0) return false;
  return (
    (await chip.locator("button", { hasText: /^\s*Cancel\s*$/ }).count()) === 0
  );
}

async function chipText(page: PwPage): Promise<string> {
  const chip = page.locator('[role="status"]').first();
  return (await chip.count()) === 0
    ? ""
    : ((await chip.textContent()) ?? "").trim();
}

/** Polls the chip until it settles, or until its sentence has not moved for `STALL_MS`. */
async function waitSettled(
  page: PwPage,
  label: string,
): Promise<"settled" | "stalled"> {
  let last = "";
  let changed = Date.now();
  let reported = 0;
  for (;;) {
    await page.waitForTimeout(POLL_MS);
    const text = await chipText(page);
    if (text !== last) {
      last = text;
      changed = Date.now();
    }
    if (await chipSettled(page)) {
      log(label, "settled:", text);
      return "settled";
    }
    if (Date.now() - changed > STALL_MS) {
      log(label, "stalled:", text);
      return "stalled";
    }
    if (Date.now() - reported > 20_000) {
      reported = Date.now();
      log(label, text);
    }
  }
}

/**
 * The stopping rule's last clause. D1 step 6 asks for a *relaunch* settling
 * at `Generated 0 of 0 in the library`, because a launch runs the pose wave a
 * count does not (`BulkJobs.enumerate`'s `needsPose`). The button is
 * `disabled` at a count of zero (SidePanel's `libraryOps.map`), so that press
 * cannot be made in the DOM; this is its equivalent, and the difference between
 * a launch's derivation and a count's is exactly the wave: both judge with
 * `entry.pose` where the enumeration carries one (`annotate` in app.ts fills
 * it from the pose layer), and `POST /api/semantic/poses` records what it
 * answers into that layer (`layers.recordPoses`). So: enumerate, ask the route
 * for every model still `pose === undefined` — the wave, made by hand — and
 * count again. A zero then is what a relaunch's `Generated 0 of 0` would be.
 */
async function confirmNothingLeft(page: PwPage, base: string): Promise<number> {
  const { entries } = await enumerateModels(base);
  const unknown = entries
    .filter((e) => e.pose === undefined)
    .map((e) => e.path);
  if (unknown.length > 0) {
    const answered = await fetchPoses(base, unknown);
    log(
      `pose wave by hand: ${unknown.length} models asked, ${Object.keys(answered).length} answered`,
    );
  }
  return openLibraryTabAndCount(page);
}

/** `runPass`'s launch-budget state — see `shouldRefuse`. */
export interface LaunchBudget {
  /** The lowest count any launch this pass has seen; `null` before the first. */
  best: number | null;
  /** Non-progressing launches since `best` last improved. */
  launches: number;
  /** Every launch this pass has made, regardless of progress — `MAX_TOTAL_LAUNCHES`' count. */
  total: number;
}

/** The budget a pass starts with, before its first launch. */
export const INITIAL_LAUNCH_BUDGET: LaunchBudget = {
  best: null,
  launches: 0,
  total: 0,
};

/**
 * D1 step 6's launch-budget decision for one candidate launch at count `n`,
 * pulled out of `runPass` as a pure function so it can be celled without a
 * Playwright page. `launches` bounds a *stuck* count: it resets whenever `n`
 * betters `budget.best` — the lowest count *any* launch this pass has seen —
 * not merely the launch immediately before it, so an oscillating count
 * (100, 99, 100, 99, …) cannot re-arm the budget forever the way comparing
 * only to the previous launch did (that count never stops "progressing" by
 * the old rule, since 99 is always below the 100 that preceded it). `total`
 * is the hard ceiling that bounds a pass's launches at all, independent of
 * progress — the backstop for a sequence `launches` alone does not catch (a
 * flat count trips `launches` first; the oscillating one above is in fact
 * already caught once a value repeats, since a repeat is never `< best`, but
 * `total` is the bound that holds regardless of the sequence's shape).
 * Returns the refusal reason, or the budget to carry into the next launch.
 */
export function shouldRefuse(
  n: number,
  budget: LaunchBudget,
): { refuse: string } | { refuse: null; budget: LaunchBudget } {
  const progressed = budget.best === null || n < budget.best;
  const best = progressed ? n : budget.best;
  const launches = progressed ? 0 : budget.launches;
  if (launches >= MAX_LAUNCHES)
    return { refuse: `the count stuck at ${n} after ${launches} launches` };
  if (budget.total >= MAX_TOTAL_LAUNCHES)
    return {
      refuse: `hit the hard ceiling of ${MAX_TOTAL_LAUNCHES} launches without settling`,
    };
  return {
    refuse: null,
    budget: { best, launches: launches + 1, total: budget.total + 1 },
  };
}

/**
 * One *Generate* pass under the pill's current state (D1 step 6). A pass ends
 * only when the chip has settled, the button reads `Generate 0 missing
 * thumbnails`, and `confirmNothingLeft` still reads zero — never on the count
 * alone, which reads zero while the last entries are in flight. A stalled
 * launch is cancelled and relaunched once, then refused with the count that
 * stuck (`shouldRefuse`).
 */
async function runPass(
  page: PwPage,
  base: string,
  label: string,
  puts: { ok: number },
): Promise<PassFigures> {
  const t0 = Date.now();
  const before = puts.ok;
  let budget = INITIAL_LAUNCH_BUDGET;
  for (;;) {
    let n = await openLibraryTabAndCount(page);
    if (
      n === 0 &&
      (await chipText(page)) !== "" &&
      !(await chipSettled(page))
    ) {
      // Zero with a job still live: the in-flight tail. Let it land.
      if ((await waitSettled(page, label)) === "stalled")
        throw new Error(
          `${label}: a live job stalled at "${await chipText(page)}"`,
        );
      continue;
    }
    if (n === 0) {
      n = await confirmNothingLeft(page, base);
      if (n === 0) break;
      log(label, `the pose wave found ${n} more`);
    }
    const decision = shouldRefuse(n, budget);
    if (decision.refuse !== null)
      throw new Error(`${label}: ${decision.refuse}`);
    budget = decision.budget;
    log(label, `launch ${budget.launches}: Generate ${n} missing thumbnails`);
    await page.locator("button", { hasText: GENERATE }).first().click();
    const outcome = await waitSettled(page, label);
    if (outcome === "stalled") {
      await page
        .locator('[role="status"] button', { hasText: /^\s*Cancel\s*$/ })
        .first()
        .click()
        .catch(() => undefined);
      await waitSettled(page, label);
    }
  }
  return {
    rendered: puts.ok - before,
    elapsed: Math.round((Date.now() - t0) / 1000),
  };
}

type Variant = "ao" | "noao";

/** D1 step 6 whole: both variants, the pill toggled only between fully ended passes. */
async function generateBoth(
  base: string,
): Promise<{ first: Variant; ao: PassFigures; noao: PassFigures }> {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    const puts = { ok: 0, failed: 0 };
    page.on("response", (r) => {
      const q = r.request();
      if (q.method() === "PUT" && q.url().includes("/api/thumb")) {
        if (r.status() === 200) puts.ok++;
        else puts.failed++;
      }
    });
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tab"]', { timeout: 60_000 });
    const first: Variant = (await aoOn(page)) ? "ao" : "noao";
    log(
      `pill reads ssao ${first === "ao" ? "on" : "off"}: the first pass is ${first}`,
    );
    const one = await runPass(page, base, `pass 1 (${first})`, puts);
    // Only now: `renderEntryThumbnail` reads `aoEnabled()` live, and a pill
    // toggled with an entry in flight files it under the other variant.
    await pill(page).click();
    await page.waitForTimeout(500);
    const second: Variant = (await aoOn(page)) ? "ao" : "noao";
    if (second === first) throw new Error("the ssao pill did not toggle");
    const two = await runPass(page, base, `pass 2 (${second})`, puts);
    if (puts.failed > 0)
      log(
        `warning: ${puts.failed} PUTs answered non-200 (verifyBake decides what that cost)`,
      );
    return first === "ao"
      ? { first, ao: one, noao: two }
      : { first, ao: two, noao: one };
  } finally {
    await browser.close();
  }
}

/**
 * Polls `${origin}/api/library` for `state: "ready"`, bounded: `docker
 * compose … restart app` returns before the container is actually serving.
 * Not `/api/features` (also UNGATED, in `createApp`'s sense, and cheaper):
 * it answers 200 as soon as Hono binds, *before* the library has resolved,
 * while `/api/thumb` stays gated and 503s with a state envelope until then —
 * so polling `/api/features` could return while the box was still walking
 * for its marker, and the first hit check then threw `GET … answered 503`
 * on a store that had already landed. `/api/library` answers `ready` only
 * once the walk itself has settled. Each attempt carries its own timeout
 * (`SHIP_READY_PROBE_TIMEOUT_MS`): `SHIP_READY_DEADLINE_MS` is otherwise
 * only checked *between* attempts, so one black-holed connect (Linux's
 * ~130s default) could overrun the whole deadline on a single try.
 */
async function waitForShipReady(origin: string): Promise<void> {
  const deadline = Date.now() + SHIP_READY_DEADLINE_MS;
  for (;;) {
    const state = await fetch(`${origin}/api/library`, {
      signal: AbortSignal.timeout(SHIP_READY_PROBE_TIMEOUT_MS),
    })
      .then((r) => (r.ok ? (r.json() as Promise<LibraryState>) : null))
      .then((s) => s?.state ?? null)
      .catch(() => null);
    if (state === "ready") return;
    if (Date.now() >= deadline)
      throw new Error(
        `${origin}/api/library did not answer ready within ${SHIP_READY_DEADLINE_MS / 1000}s of the restart`,
      );
    await sleep(POLL_MS);
  }
}

/** Task 4.2's two hit checks for one model and one variant, against the live host. */
async function hitCheck(
  model: BakeModel,
  ao: boolean,
  recipe: ManifestRecipe,
  origin: string,
): Promise<string> {
  const q = `path=${encodeURIComponent(model.path)}&mtime=${model.mtime}${ao ? "" : "&ao=off"}`;
  const info = await getJson<ThumbGetResponse & { gen?: number }>(
    `${origin}/api/thumb?${q}`,
  );
  const problems: string[] = [];
  if (info.status !== "hit") problems.push(`status ${info.status}`);
  if (info.rig !== recipe.rig) problems.push(`rig ${String(info.rig)}`);
  if (
    info.posed !== undefined &&
    (info.posed !== recipe.poseVersion || typeof info.poseKey !== "string")
  ) {
    problems.push(
      `posed ${String(info.posed)} poseKey ${String(info.poseKey)}`,
    );
  }
  const image = await fetch(
    `${origin}/api/thumb/image?${q}${info.gen !== undefined ? `&gen=${info.gen}` : ""}`,
  );
  const type = image.headers.get("content-type") ?? "";
  const cacheControl = image.headers.get("cache-control") ?? "";
  if (!image.ok || !type.startsWith(THUMB_MIME))
    problems.push(`image ${image.status} ${type}`);
  if (!cacheControl.includes("immutable"))
    problems.push(`image cache-control "${cacheControl}"`);
  const label = `${model.path} ${ao ? "ao" : "noao"}`;
  if (problems.length > 0)
    throw new Error(`hit check failed for ${label}: ${problems.join(", ")}`);
  return `${label}: hit, rig ${info.rig}, ${info.posed !== undefined ? `posed ${info.posed} (${info.poseKey})` : "unposed"}, ${type}, ${cacheControl}`;
}

function hitCheckCommands(models: BakeModel[], origin: string): string[] {
  return models.flatMap((m) => {
    const q = `path=${encodeURIComponent(m.path)}&mtime=${m.mtime}`;
    return [
      `curl -s '${origin}/api/thumb?${q}'`,
      `curl -s '${origin}/api/thumb?${q}&ao=off'`,
      `curl -sI '${origin}/api/thumb/image?${q}&gen=<gen from the lookup>'`,
    ];
  });
}

/** D1 step 11 / D5: the rsync, the restart and task 4.2's hit checks — run behind `--ship`, printed without it. */
async function ship(
  args: BakeArgs,
  libraryId: string,
  models: BakeModel[],
  recipe: ManifestRecipe,
): Promise<void> {
  const host = args.ship ?? "<user@host>";
  const boxDir = args.shipDir ?? "/srv/cache/<box id>";
  const rsync = rsyncCommand(args.cache, libraryId, host, boxDir);
  const restart = `ssh ${host} '${RESTART_COMMAND}'`;
  const three = models.slice(0, 3);
  if (args.ship === undefined) {
    console.log(
      "\nTo ship (D4/D5) — the box id is read from its startup line `library <id> at …`, never assumed:",
    );
    console.log(`  ${rsync}`);
    console.log(`  ${restart}`);
    for (const c of hitCheckCommands(three, DEMO_ORIGIN)) console.log(`  ${c}`);
    return;
  }
  run("sh", ["-c", rsync], process.cwd());
  run("sh", ["-c", restart], process.cwd());
  const origin = originFromShip(host, args.origin);
  if (origin === null) {
    console.log(
      `\nthe store shipped and the container restarted, but task 4.2's origin could not be derived from --ship ${host} (a bare IP names no certificate) — pass --origin <https://url> to hit-check automatically. Finish task 4.2 by hand:`,
    );
    for (const c of hitCheckCommands(three, "<origin — pass --origin>"))
      console.log(`  ${c}`);
    return;
  }
  log(`waiting for ${origin} to answer /api/library after the restart`);
  try {
    await waitForShipReady(origin);
  } catch (err) {
    console.log(
      `\nthe store shipped and the container restarted, but ${err instanceof Error ? err.message : String(err)} — finish task 4.2 by hand:`,
    );
    for (const c of hitCheckCommands(three, origin)) console.log(`  ${c}`);
    return;
  }
  for (const m of three)
    for (const ao of [true, false])
      log("hit check:", await hitCheck(m, ao, recipe, origin));
}

/** The whole run, D1's eleven steps in order; the child server is stopped on every path out. */
export async function bake(args: BakeArgs): Promise<void> {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const base = `http://127.0.0.1:${args.port}`;
  const scratch = await mkdtemp(join(tmpdir(), "mb-bake-"));
  const clientDir = args.client ?? join(scratch, "client");
  log(
    `scratch ${scratch} (the config and, unless --client says otherwise, the client build; kept for inspection)`,
  );

  // 1. The client build — to the scratch directory, never `client/dist`.
  run(
    "bunx",
    ["vite", "build", "--outDir", clientDir, "--emptyOutDir"],
    join(repo, "client"),
  );
  const client = gitFacts(repo);
  const recipe = await loadRecipe(repo);
  log(
    `client ${client.commit ?? "(no git)"}${client.dirty ? " (dirty tree, recorded)" : ""}; recipe rig ${recipe.rig}, pose ${recipe.poseVersion}, ${recipe.lighting}, ${recipe.size}²`,
  );

  // 2. The scratch configuration. `hostDetails: true` because `/api/library`'s
  // `top`/`id` and `/api/semantic/status`'s `detail` are withheld otherwise.
  const configFile = join(scratch, "config.json");
  const config = {
    root: args.root,
    listen: { host: "127.0.0.1", port: args.port },
    features: {
      thumbWrites: true,
      maintenance: true,
      appLaunch: false,
      chatTab: false,
      hostDetails: true,
    },
  };
  await writeFile(configFile, JSON.stringify(config, null, 2));

  // 3. The child server, killed on every way out of the block below — and by
  // the signal handlers, so a Ctrl-C mid-pass leaves the scratch port free.
  await refuseBusyPort(args.port);
  await mkdir(args.cache, { recursive: true });
  const server = startServer(repo, {
    configFile,
    cache: args.cache,
    client: clientDir,
  });
  const onSignal = (signal: NodeJS.Signals) => {
    console.error(`\n${signal}: stopping the server`);
    void server.stop().finally(() => process.exit(130));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let libraryId: string;
  let libraryTop: string;
  let models: BakeModel[];
  let index: IndexFacts;
  let passes: Awaited<ReturnType<typeof generateBoth>>;
  let verify: VerifyResult;
  try {
    const lib = await waitForLibrary(base, server);
    if (lib.top === undefined)
      throw new Error("/api/library withholds top — hostDetails is off?");
    libraryId = lib.id;
    libraryTop = lib.top;
    log(`library ${lib.id} at ${lib.top}`);

    // 4. The index, twice over.
    await requireIndexAtRoot(base);
    const direct = await indexDirect(args.indexCache);
    log(
      `index ready: cache_dir ${direct.cacheDir}, ${direct.models} models, ${direct.views} views, elevations ${JSON.stringify(direct.elevations)}, up_axis ${direct.upAxis}`,
    );

    // 5. The enumeration.
    models = (await enumerateModels(base)).models;
    log(`${models.length} models enumerated`);

    // 6. Both passes.
    passes = await generateBoth(base);
    log(
      `passes: first ${passes.first}; ao ${passes.ao.rendered} renders in ${passes.ao.elapsed}s, noao ${passes.noao.rendered} in ${passes.noao.elapsed}s`,
    );

    // 7. The store on disk.
    verify = await verifyBake(args.cache, libraryId, models, recipe);
    for (const miss of verify.misses)
      console.error(`miss ${miss.path}: ${miss.reasons.join("; ")}`);
    if (verify.refusal !== null)
      throw new Error(`verifyBake: ${verify.refusal}`);
    log(
      `verified: ${verify.renders.ao} ao + ${verify.renders.noao} noao renders, ${verify.posed} posed, ${verify.unposed} unposed`,
    );

    // 8. The unposed against the index — ready before and after, so a `null`
    // filed under an absent/wedged/volume-gone memo cannot pass as settled.
    await requireIndexAtRoot(base);
    const answer = await fetchPoses(base, verify.unlabelled);
    await requireIndexAtRoot(base);
    const audit = auditUnposed(verify.unlabelled, answer);
    for (const p of audit.unsettled)
      console.error(`unsettled (absent from the index's answer): ${p}`);
    for (const p of audit.shouldHavePosed)
      console.error(`should have been posed (the index answers a pose): ${p}`);
    if (audit.unsettled.length > 0 || audit.shouldHavePosed.length > 0) {
      throw new Error(
        `pose audit: ${audit.unsettled.length} unsettled, ${audit.shouldHavePosed.length} should have been posed — no manifest written`,
      );
    }
    log(`pose audit: ${verify.unlabelled.length} unlabelled, all settled null`);

    index = {
      collectionRoot: "/",
      ...direct,
      ...(await indexFingerprint(args.indexCache)),
    };
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await server.stop();
    log("server stopped");
  }

  // 9. The manifest, after the server is stopped (no sweep of the bake instance running while it lands).
  const manifest = manifestFor({
    date: new Date().toISOString(),
    client,
    recipe,
    library: { id: libraryId, root: libraryTop },
    models: models.length,
    verify,
    passes: { ao: passes.ao, noao: passes.noao },
    index,
  });
  const file = await writeManifest(args.cache, libraryId, manifest);
  log(`manifest ${file}`);

  // 10. The pin check — the same script the box runs.
  run("sh", ["deploy/demo/check-bake.sh", file, args.indexCache], repo);
  log("check-bake.sh passed");

  // 11. The ship, or its commands.
  await ship(args, libraryId, models, recipe);
}

// Run only when invoked directly, so the core above can be imported by the
// suite (`gen-overrides.ts`'s guard).
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let args: BakeArgs | null = null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  bake(args).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
