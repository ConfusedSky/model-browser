import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type BakeArgs,
  type BakeModel,
  type FetchLike,
  type LaunchBudget,
  type ManifestInput,
  type ManifestRecipe,
  type RunLike,
  INITIAL_LAUNCH_BUDGET,
  POLL_MS,
  RESTART_COMMAND,
  SHIP_READY_DEADLINE_MS,
  SHIP_READY_PROBE_TIMEOUT_MS,
  auditUnposed,
  fetchPoses,
  indexCacheDirMatches,
  indexFingerprint,
  manifestFor,
  manifestPath,
  originFromShip,
  parseArgs,
  resolveShipBoxDir,
  resolveShipOrigin,
  rsyncArgv,
  rsyncCommand,
  ship,
  shipInstructions,
  shouldRefuse,
  sidecarKey,
  sshRestartArgv,
  verifyBake,
  verifyShip,
  waitForShipReady,
  writeManifest,
} from "../../scripts/bake-demo";
import {
  type IndexPose,
  type LightingMode,
  POSES_MAX,
} from "../../shared/types";
import { ThumbCache } from "../src/cache";
import { libraryFor, realTempDir } from "./helpers";

/**
 * The bake script's core, exercised as functions (corpus-bake task 1.2) the way
 * `genOverrides.test.ts` exercises `gen-overrides.ts`. The fixture store is
 * written by `ThumbCache.put` itself — never by hand — so its sidecars are the
 * real shape and cannot drift from the writer `verifyBake` reads.
 *
 * The recipe is a value here, not the client's constants: `renderer.ts`
 * imports `three`, which this workspace does not have (design Context). What
 * these cells pin is the *comparison*; the constants are the client suite's.
 */
const RECIPE: ManifestRecipe = {
  rig: 7,
  poseVersion: 2,
  lighting: "camera",
  size: 256,
};
const POSE_KEY = "v3@40/20";
const CAP = 2 * 1024 ** 3;

const MODELS: BakeModel[] = [
  { path: "/kit/a.stl", mtime: 1000 },
  { path: "/kit/b.stl", mtime: 2000 },
  { path: "/kit/c.stl", mtime: 3000 },
];

interface Store {
  /** The library's top — what a second `ThumbCache` over the same store is built from. */
  top: string;
  cacheDir: string;
  id: string;
  cache: ThumbCache;
  /** The id directory — where the sidecars and renders lie. */
  dir: string;
}

/**
 * A library of three models with a cache beside it, every write through
 * `put`. `maintainEvery` is set high so no background sweep runs while a cell
 * is reading the directory.
 */
async function store(): Promise<Store> {
  const top = realTempDir("mb-bake-lib-");
  mkdirSync(join(top, "kit"));
  for (const m of MODELS)
    writeFileSync(join(top, m.path.slice(1)), "model bytes");
  const library = libraryFor(top);
  await library.state();
  const id = library.id();
  const cacheDir = realTempDir("mb-bake-cache-");
  const cache = new ThumbCache(cacheDir, CAP, 1_000_000, library);
  return { top, cacheDir, id, cache, dir: join(cacheDir, id) };
}

type Labels = {
  mtime?: number;
  lighting?: LightingMode;
  rig?: number;
  posed?: number;
  poseKey?: string;
};

/** One render of `model`, at the recipe unless a label is overridden. */
async function render(
  s: Store,
  model: BakeModel,
  ao: boolean,
  labels: Labels = {},
): Promise<void> {
  await s.cache.put(model.path, {
    mtime: labels.mtime ?? model.mtime,
    png: Buffer.from(`webp ${model.path} ${ao ? "ao" : "noao"}`),
    lighting: labels.lighting ?? RECIPE.lighting,
    rig: labels.rig ?? RECIPE.rig,
    posed: labels.posed,
    poseKey: labels.poseKey,
    ao,
  });
}

const POSED: Labels = { posed: RECIPE.poseVersion, poseKey: POSE_KEY };

/** The complete store: `a` and `b` posed on both renders, `c` unposed on both. */
async function completeStore(): Promise<Store> {
  const s = await store();
  for (const ao of [true, false]) {
    await render(s, MODELS[0]!, ao, POSED);
    await render(s, MODELS[1]!, ao, POSED);
    await render(s, MODELS[2]!, ao);
  }
  return s;
}

const missFor = (misses: { path: string; reasons: string[] }[], path: string) =>
  misses.find((m) => m.path === path);

describe("verifyBake", () => {
  it("passes a complete store with the right counts and lists its unlabelled paths", async () => {
    const s = await completeStore();
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses).toEqual([]);
    expect(r.renders).toEqual({ ao: 3, noao: 3 });
    expect(r.posed).toBe(2);
    expect(r.unposed).toBe(1);
    expect(r.unlabelled).toEqual(["/kit/c.stl"]);
    expect(r.refusal).toBeNull();
  });

  it("lists a model missing its .noao.webp", async () => {
    const s = await completeStore();
    const key = sidecarKey("/kit/b.stl");
    rmSync(join(s.dir, `${key}.noao.webp`));
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/b.stl"]);
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      `no ${key}.noao.webp`,
    ]);
    expect(r.renders).toEqual({ ao: 3, noao: 2 });
    expect(r.refusal).not.toBeNull();
  });

  it("lists a noao label at another mtime", async () => {
    const s = await completeStore();
    // An older mtime, so the write does not supersede the occluded sibling
    // (`put` deletes the sibling only for a strictly newer one): the top-level
    // labels stay right and only `noao` disagrees with the model.
    await render(s, MODELS[0]!, false, { ...POSED, mtime: 999 });
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/a.stl"]);
    expect(missFor(r.misses, "/kit/a.stl")!.reasons).toEqual([
      "noao: mtime 999, model 1000",
    ]);
    expect(r.refusal).not.toBeNull();
  });

  it("lists a rig behind by one", async () => {
    const s = await completeStore();
    await render(s, MODELS[1]!, true, { ...POSED, rig: RECIPE.rig - 1 });
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/b.stl"]);
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      `ao: rig ${RECIPE.rig - 1}, recipe ${RECIPE.rig}`,
    ]);
  });

  it("lists an ao render at another lighting", async () => {
    const s = await completeStore();
    await render(s, MODELS[1]!, true, { ...POSED, lighting: "axis" });
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/b.stl"]);
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      `ao: lighting axis, recipe ${RECIPE.lighting}`,
    ]);
  });

  it("lists a posed label at the wrong pose version, on both renders", async () => {
    const s = await completeStore();
    // Both renders, at the same wrong version — `put`'s unowned-entry pose
    // rule (cache.ts) invalidates a sibling whose `posed` *differs* from
    // this write's, so a single-render override would clear the other
    // rather than exercise the compare this cell is after.
    for (const ao of [true, false])
      await render(s, MODELS[1]!, ao, {
        ...POSED,
        posed: RECIPE.poseVersion - 1,
      });
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/b.stl"]);
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      `ao: posed ${RECIPE.poseVersion - 1}, recipe ${RECIPE.poseVersion}`,
      `noao: posed ${RECIPE.poseVersion - 1}, recipe ${RECIPE.poseVersion}`,
    ]);
  });

  it("lists posed carried without a poseKey, on both renders", async () => {
    const s = await completeStore();
    for (const ao of [true, false])
      await render(s, MODELS[2]!, ao, { posed: RECIPE.poseVersion });
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/c.stl"]);
    expect(missFor(r.misses, "/kit/c.stl")!.reasons).toEqual([
      "ao: posed without a poseKey",
      "noao: posed without a poseKey",
    ]);
    // Counted as posed — it carries the label — so it is not handed to the
    // pose audit as unlabelled; the miss is what refuses it.
    expect(r.posed).toBe(3);
    expect(r.unposed).toBe(0);
    expect(r.unlabelled).toEqual([]);
    expect(r.refusal).not.toBeNull();
  });

  it("refuses zero posed — the unposed corpus-wide bake by another road", async () => {
    const s = await store();
    for (const ao of [true, false])
      for (const m of MODELS) await render(s, m, ao);
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses).toEqual([]);
    expect(r.posed).toBe(0);
    expect(r.unposed).toBe(3);
    expect(r.unlabelled).toEqual(MODELS.map((m) => m.path));
    expect(r.refusal).toMatch(/no model is posed/);
  });

  it("lists a model with no sidecar at all, with both renders missing", async () => {
    const s = await completeStore();
    const missing: BakeModel = { path: "/kit/d.stl", mtime: 4000 };
    const r = await verifyBake(s.cacheDir, s.id, [...MODELS, missing], RECIPE);
    const key = sidecarKey(missing.path);
    expect(missFor(r.misses, missing.path)!.reasons).toEqual([
      `no ${key}.webp`,
      `no ${key}.noao.webp`,
      `no sidecar ${key}.json`,
    ]);
    expect(r.refusal).toBe("1 of 4 models fail verification");
  });

  it("lists ao and noao poseKeys that disagree — the two renders drawn under different orientations", async () => {
    const s = await completeStore();
    // Own the entry with a camera first (an orbited tile, in the finding's
    // telling) — which exempts `put`'s unowned-entry pose rule (cache.ts)
    // from invalidating a sibling whose poseKey moves on its own; an
    // unowned entry would self-heal the very state this cell wants to
    // catch. Setting the camera itself clears both renders' recipe labels
    // (a camera move invalidates what was drawn before it), so both are
    // re-rendered afterwards with the camera already in place and absent
    // from `opts` — no further "moved" — the ao render back at its
    // original poseKey, the noao one at a different orientation.
    await s.cache.put(MODELS[0]!.path, {
      mtime: MODELS[0]!.mtime,
      camera: { az: 1, el: 0, distR: 2, target: [0, 0, 0] },
    });
    await render(s, MODELS[0]!, true, POSED);
    await render(s, MODELS[0]!, false, { ...POSED, poseKey: "v3@10/5" });
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/a.stl"]);
    expect(missFor(r.misses, "/kit/a.stl")!.reasons).toEqual([
      `poseKey differs: ao ${POSE_KEY}, noao v3@10/5`,
    ]);
  });

  it("lists a sidecar that parses to null rather than skipping it silently", async () => {
    const s = await completeStore();
    const key = sidecarKey("/kit/a.stl");
    writeFileSync(join(s.dir, `${key}.json`), "null");
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/a.stl"]);
    expect(missFor(r.misses, "/kit/a.stl")!.reasons).toEqual([
      `sidecar ${key}.json is not an object`,
    ]);
    // "a" is neither posed nor unposed — its sidecar could not be read as
    // labels at all — while "b" (still posed) and "c" (still unlabelled)
    // are unaffected.
    expect(r.posed).toBe(1);
    expect(r.unposed).toBe(1);
    expect(r.unlabelled).toEqual(["/kit/c.stl"]);
  });

  it("lists a noao label that is null as malformed, not missing", async () => {
    const s = await completeStore();
    const key = sidecarKey("/kit/b.stl");
    const file = join(s.dir, `${key}.json`);
    const sidecar = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    sidecar.noao = null;
    writeFileSync(file, JSON.stringify(sidecar));
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/b.stl"]);
    // `null` is present, not absent — mirrors the top-level sidecar parse:
    // present-but-not-an-object gets its own reason, distinct from "no
    // labels" (the key never written at all).
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      "noao: labels are not an object",
      "posed on one render only",
    ]);
  });

  it("lists a noao label that is a number as malformed, not missing", async () => {
    const s = await completeStore();
    const key = sidecarKey("/kit/b.stl");
    const file = join(s.dir, `${key}.json`);
    const sidecar = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    sidecar.noao = 5;
    writeFileSync(file, JSON.stringify(sidecar));
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE);
    expect(r.misses.map((m) => m.path)).toEqual(["/kit/b.stl"]);
    // Before the fix this collapsed to "noao: no labels" — telling the
    // operator a key was missing when it was present and wrong.
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      "noao: labels are not an object",
      "posed on one render only",
    ]);
  });
});

describe("auditUnposed", () => {
  const paths = ["/kit/c.stl", "/kit/base.stl", "/kit/terrain.stl"];
  const pose = {
    up: [0, 0, 1] as [number, number, number],
    azimuth_zero: [1, 0, 0] as [number, number, number],
    source: "index",
    confidence: 0.9,
    front: { view: 3, azimuth_deg: 40, elevation_deg: 20 },
  };

  it("answers empty lists when every path is present and null", () => {
    const answer = Object.fromEntries(paths.map((p) => [p, null]));
    expect(auditUnposed(paths, answer)).toEqual({
      unsettled: [],
      shouldHavePosed: [],
    });
  });

  it("names a path absent from the answer as unsettled", () => {
    const answer = Object.fromEntries(
      paths.filter((p) => p !== "/kit/base.stl").map((p) => [p, null]),
    );
    expect(auditUnposed(paths, answer)).toEqual({
      unsettled: ["/kit/base.stl"],
      shouldHavePosed: [],
    });
  });

  it("names a path answered with a pose as should-have-been-posed", () => {
    const answer = {
      ...Object.fromEntries(paths.map((p) => [p, null])),
      "/kit/terrain.stl": pose,
    };
    expect(auditUnposed(paths, answer)).toEqual({
      unsettled: [],
      shouldHavePosed: ["/kit/terrain.stl"],
    });
  });
});

describe("rsyncCommand", () => {
  it("is the D4 command: snapshots excluded, both trailing slashes, no --delete", () => {
    const expected =
      "rsync -az --info=progress2 --exclude 'snapshots/' /home/me/.cache/model-browser-bake/cache/local-id/ root@157.90.25.110:/srv/cache/box-id/";
    expect(
      rsyncCommand(
        "/home/me/.cache/model-browser-bake/cache",
        "local-id",
        "root@157.90.25.110",
        "/srv/cache/box-id",
      ),
    ).toBe(expected);
    // A box directory typed with its own slash gets exactly one.
    expect(
      rsyncCommand(
        "/home/me/.cache/model-browser-bake/cache/",
        "local-id",
        "root@157.90.25.110",
        "/srv/cache/box-id/",
      ),
    ).toBe(expected);
    expect(expected).not.toContain("--delete");
  });
});

describe("rsyncArgv / sshRestartArgv (Fix 5: the spawn form beside the printed strings)", () => {
  it("carries the same --exclude 'snapshots/', both trailing slashes and no --delete as rsyncCommand — they share rsyncPieces", () => {
    const argv = rsyncArgv(
      "/home/me/.cache/model-browser-bake/cache",
      "local-id",
      "root@157.90.25.110",
      "/srv/cache/box-id",
    );
    expect(argv).toEqual([
      "-az",
      "--info=progress2",
      "--exclude",
      "snapshots/",
      "/home/me/.cache/model-browser-bake/cache/local-id/",
      "root@157.90.25.110:/srv/cache/box-id/",
    ]);
    expect(argv).not.toContain("--delete");
  });

  it("keeps a local cache path with a space as one argv element — sh -c would split it into two rsync sources", () => {
    const argv = rsyncArgv(
      "/home/me/.cache/my cache",
      "local-id",
      "root@box",
      "/srv/cache/box-id",
    );
    expect(argv).toContain("/home/me/.cache/my cache/local-id/");
    // Exactly one source and one destination, whatever it contains — a
    // sh -c interpolation of an unquoted space would instead hand rsync two
    // separate source arguments.
    expect(argv).toHaveLength(6);
  });

  it("keeps a --ship-dir carrying a shell metacharacter as inert data, never executed", () => {
    // `sh -c` with this interpolated unquoted would run `rm -rf /` after the
    // rsync; as one argv element it is just a (bogus, rsync-refused) path.
    const argv = rsyncArgv(
      "/home/me/.cache/model-browser-bake/cache",
      "local-id",
      "root@box",
      "/srv/cache/box-id; rm -rf /",
    );
    expect(argv[argv.length - 1]).toBe("root@box:/srv/cache/box-id; rm -rf /");
  });

  it("sshRestartArgv pairs the host with RESTART_COMMAND as two argv elements, not a shell string", () => {
    expect(sshRestartArgv("root@box")).toEqual(["root@box", RESTART_COMMAND]);
  });
});

const INDEX_HASH_A = createHash("sha256").update('{"poses":1}').digest("hex");
const INDEX_HASH_B = createHash("sha256").update('{"views":8}').digest("hex");

function manifestInput(): ManifestInput {
  return {
    date: "2026-09-15T12:00:00.000Z",
    client: { commit: "abc123", dirty: false },
    recipe: RECIPE,
    library: { id: "local-id", root: "/home/me/decimated" },
    models: 3,
    verify: { renders: { ao: 3, noao: 3 }, posed: 2, unposed: 1 },
    passes: {
      ao: { rendered: 3, elapsed: 0.4 },
      noao: { rendered: 3, elapsed: 0.3 },
    },
    index: {
      collectionRoot: "/",
      cacheDir: "embed-cache-test",
      // The index's own n_models — not the enumeration's 3 (D2's Names).
      models: 2,
      views: 8,
      elevations: [20],
      upAxis: "auto",
      poseCacheSha256: INDEX_HASH_A,
      runParamsSha256: INDEX_HASH_B,
    },
  };
}

/** Lines of `text` that carry the key `name`, as the check on the box would read them. */
const keyLines = (text: string, name: string) =>
  text.split("\n").filter((l) => new RegExp(`^ *"${name}": `).test(l));

describe("manifest", () => {
  it("writes exactly JSON.stringify(manifestFor(...), null, 2) into <cache>/<id>/bake/bake.json", async () => {
    const cacheDir = realTempDir("mb-bake-manifest-");
    const input = manifestInput();
    const file = await writeManifest(cacheDir, "local-id", manifestFor(input));
    expect(file).toBe(manifestPath(cacheDir, "local-id"));
    expect(file).toBe(join(cacheDir, "local-id", "bake", "bake.json"));
    const text = await readFile(file, "utf8");
    expect(text).toBe(JSON.stringify(manifestFor(input), null, 2));
  });

  it("carries the pinned key names once each, and no key named posed or sha256", () => {
    const text = JSON.stringify(manifestFor(manifestInput()), null, 2);
    for (const name of [
      "rig",
      "poseVersion",
      "posedModels",
      "unposedModels",
      "poseCacheSha256",
      "runParamsSha256",
    ]) {
      expect(keyLines(text, name), name).toHaveLength(1);
    }
    expect(keyLines(text, "posed")).toHaveLength(0);
    expect(keyLines(text, "sha256")).toHaveLength(0);
    // Where each lives, and what it says.
    expect(text).toContain(`"poseVersion": ${RECIPE.poseVersion},`);
    expect(text).toContain('"posedModels": 2,');
    expect(text).toContain('"unposedModels": 1,');
    expect(text).toContain(`"poseCacheSha256": "${INDEX_HASH_A}",`);
    expect(text).toContain(`"runParamsSha256": "${INDEX_HASH_B}"`);
  });

  it("takes D2 shape: key order, index.models from the index, rates and elapsed derived", () => {
    const m = manifestFor(manifestInput());
    expect(Object.keys(m)).toEqual([
      "version",
      "date",
      "client",
      "recipe",
      "library",
      "models",
      "renders",
      "posedModels",
      "unposedModels",
      "rate",
      "elapsed",
      "index",
    ]);
    expect(Object.keys(m.index)).toEqual([
      "collectionRoot",
      "cacheDir",
      "models",
      "views",
      "elevations",
      "upAxis",
      "poseCacheSha256",
      "runParamsSha256",
    ]);
    // D2's sample is introduced as "the shape, as the writer emits it", so the
    // block's order is pinned too — an operator diffs a real bake.json against it.
    expect(Object.keys(m.client)).toEqual(["commit", "dirty"]);
    expect(m.version).toBe(1);
    expect(m.models).toBe(3);
    expect(m.index.models).toBe(2);
    expect(m.recipe).toEqual({
      rig: 7,
      poseVersion: 2,
      lighting: "camera",
      size: 256,
    });
    expect(m.rate).toEqual({ ao: 7.5, noao: 10 });
    expect(m.elapsed).toEqual({ ao: 0.4, noao: 0.3, total: 0.7 });
  });

  it("omits client.commit when git could not answer, and never writes Infinity", () => {
    const input = manifestInput();
    delete input.client.commit;
    input.passes.ao.elapsed = 0;
    const m = manifestFor(input);
    expect("commit" in m.client).toBe(false);
    expect(Object.keys(m.client)).toEqual(["dirty"]);
    expect(m.rate.ao).toBe(0);
    expect(JSON.stringify(m)).not.toContain("null");
  });
});

describe("indexFingerprint", () => {
  it("hashes pose-cache.json and run-params.json each under its own key", async () => {
    const dir = realTempDir("mb-bake-index-");
    writeFileSync(join(dir, "pose-cache.json"), '{"poses":1}');
    writeFileSync(join(dir, "run-params.json"), '{"views":8}');
    expect(await indexFingerprint(dir)).toEqual({
      poseCacheSha256: INDEX_HASH_A,
      runParamsSha256: INDEX_HASH_B,
    });
  });

  it("rejects when either file is missing rather than fingerprinting half an index", async () => {
    const dir = realTempDir("mb-bake-index-");
    writeFileSync(join(dir, "pose-cache.json"), '{"poses":1}');
    await expect(indexFingerprint(dir)).rejects.toThrow(/run-params\.json/);
  });
});

const A_POSE: IndexPose = {
  up: [0, 0, 1],
  azimuth_zero: [1, 0, 0],
  source: "index",
  confidence: 0.9,
  front: { view: 3, azimuth_deg: 40, elevation_deg: 20 },
};

/**
 * The driver's pose fetch (task 1.6), against a fake `POST /api/semantic/poses`
 * that records each request's paths and answers `null` for every one — the
 * settled absence the audit wants — except `poseFor`. `failFirst` batches
 * answer 500 before the fake starts answering.
 */
function fakePosesRoute(opts: { failFirst?: number; poseFor?: string } = {}) {
  const batches: string[][] = [];
  let failures = 0;
  const fetchFn: FetchLike = async (input, init) => {
    expect(input).toBe("http://bake/api/semantic/poses");
    expect(init?.method).toBe("POST");
    const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
    batches.push(paths);
    if (failures < (opts.failFirst ?? 0)) {
      failures++;
      return new Response("index hiccup", { status: 500 });
    }
    const poses = Object.fromEntries(
      paths.map((p) => [p, p === opts.poseFor ? A_POSE : null]),
    );
    return new Response(JSON.stringify({ poses }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { batches, fetchFn };
}

const pathsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => `/kit/m${i}.stl`);

describe("fetchPoses", () => {
  it("sends 1,500 paths as two POSTs — POSES_MAX, then the 476 left — and merges both answers", async () => {
    const paths = pathsOf(1500);
    const last = paths[1499]!;
    const { batches, fetchFn } = fakePosesRoute({ poseFor: last });
    const answer = await fetchPoses("http://bake", paths, fetchFn);
    // 1,500 is under two batches of the wire bound, so the split is the bound
    // and the remainder — the bound imported, never restated (task 1.6).
    expect(batches.map((b) => b.length)).toEqual([POSES_MAX, 1500 - POSES_MAX]);
    expect(batches[0]).toEqual(paths.slice(0, POSES_MAX));
    expect(batches[1]).toEqual(paths.slice(POSES_MAX));
    expect(Object.keys(answer)).toHaveLength(1500);
    expect(answer[paths[0]!]).toBeNull();
    expect(answer[paths[POSES_MAX]!]).toBeNull();
    expect(answer[last]).toEqual(A_POSE);
    // Judged as the driver judges it: the one posed path, from the second batch, is named.
    expect(auditUnposed(paths, answer)).toEqual({
      unsettled: [],
      shouldHavePosed: [last],
    });
  });

  it("retries a failed batch once, then refuses naming the batch", async () => {
    const paths = pathsOf(10);
    const once = fakePosesRoute({ failFirst: 1 });
    await expect(
      fetchPoses("http://bake", paths, once.fetchFn),
    ).resolves.toEqual(Object.fromEntries(paths.map((p) => [p, null])));
    expect(once.batches).toHaveLength(2);
    const twice = fakePosesRoute({ failFirst: 2 });
    await expect(
      fetchPoses("http://bake", paths, twice.fetchFn),
    ).rejects.toThrow(/500 for a batch of 10/);
    expect(twice.batches).toHaveLength(2);
  });
});

describe("indexCacheDirMatches", () => {
  const real = "/home/me/mini-classify/embed-cache-test";
  it("an absolute cache_dir must equal the realpath; a relative one its basename (D1 step 4)", () => {
    expect(indexCacheDirMatches(real, real)).toBe(true);
    expect(indexCacheDirMatches(`${real}/`, real)).toBe(true);
    expect(indexCacheDirMatches("embed-cache-test", real)).toBe(true);
    expect(indexCacheDirMatches("./embed-cache-test/", real)).toBe(true);
    expect(indexCacheDirMatches("embed-cache512", real)).toBe(false);
    expect(indexCacheDirMatches("/home/me/other/embed-cache-test", real)).toBe(
      false,
    );
    expect(indexCacheDirMatches("caches/embed-cache-test", real)).toBe(false);
  });
});

describe("parseArgs", () => {
  const required = [
    "--root",
    "/corpus",
    "--cache",
    "/scratch",
    "--index-cache",
    "/index",
  ];
  it("rejects an unknown flag by name rather than swallowing it", () => {
    expect(() => parseArgs([...required, "--prot", "3199"])).toThrow(
      /unknown flag --prot/,
    );
  });
  it("defaults the port to 3199, needs the three flags, and --ship-dir beside --ship", () => {
    expect(parseArgs(required)).toEqual({
      root: "/corpus",
      cache: "/scratch",
      indexCache: "/index",
      port: 3199,
      client: undefined,
      ship: undefined,
      shipDir: undefined,
      origin: undefined,
    });
    expect(
      parseArgs([
        ...required,
        "--port",
        "4000",
        "--ship",
        "root@box",
        "--ship-dir",
        "/srv/cache/box-id",
      ]).port,
    ).toBe(4000);
    expect(() => parseArgs([])).toThrow(/^usage:/);
    expect(() => parseArgs([...required, "--ship", "root@box"])).toThrow(
      /--ship needs --ship-dir/,
    );
  });

  it("resolves root/cache/index-cache/client to absolute paths, against process.cwd()", () => {
    const args = parseArgs([
      "--root",
      "corpus",
      "--cache",
      "scratch",
      "--index-cache",
      "idx",
      "--client",
      "cli",
      "--ship",
      "root@box",
      "--ship-dir",
      "srv/cache/box-id",
    ]);
    for (const p of [args.root, args.cache, args.indexCache]) {
      expect(isAbsolute(p)).toBe(true);
    }
    expect(args.client).toBeDefined();
    expect(isAbsolute(args.client!)).toBe(true);
    // `--ship` names a host for ssh/rsync, not a local path — left as typed.
    expect(args.ship).toBe("root@box");
    // Already-absolute input is unaffected (existing behaviour, re-pinned).
    expect(parseArgs(required).root).toBe("/corpus");
  });

  it("leaves --ship-dir exactly as typed — it names a path on the box, not this machine", () => {
    // A relative --ship-dir resolved against this machine's cwd silently
    // became a *local* path used as the remote rsync destination
    // (`root@box:/home/.../srv/cache/box-id/` instead of
    // `root@box:srv/cache/box-id/`), which `rsyncCommand` then shipped to.
    const args = parseArgs([
      ...required,
      "--ship",
      "root@box",
      "--ship-dir",
      "srv/cache/box-id",
    ]);
    expect(args.shipDir).toBe("srv/cache/box-id");
    expect(
      rsyncCommand(args.cache, "local-id", args.ship!, args.shipDir!),
    ).toBe(
      `rsync -az --info=progress2 --exclude 'snapshots/' ${args.cache}/local-id/ root@box:srv/cache/box-id/`,
    );
    // An already-absolute --ship-dir is unaffected either way.
    const absolute = parseArgs([
      ...required,
      "--ship",
      "root@box",
      "--ship-dir",
      "/srv/cache/box-id",
    ]);
    expect(absolute.shipDir).toBe("/srv/cache/box-id");
  });

  it("accepts --origin already in its normalized form unchanged", () => {
    const args = parseArgs([
      ...required,
      "--ship",
      "root@box",
      "--ship-dir",
      "/srv/cache/box-id",
      "--origin",
      "https://staging.example.com",
    ]);
    expect(args.origin).toBe("https://staging.example.com");
  });

  it("normalizes a trailing-slash --origin — the address-bar copy-paste form, which `${origin}/api/…` would otherwise turn into `//api/…`", () => {
    const args = parseArgs([
      ...required,
      "--ship",
      "root@box",
      "--ship-dir",
      "/srv/cache/box-id",
      "--origin",
      "https://staging.example.com/",
    ]);
    expect(args.origin).toBe("https://staging.example.com");
  });

  it("normalizes a --origin carrying a path component to just the origin", () => {
    const args = parseArgs([
      ...required,
      "--ship",
      "root@box",
      "--ship-dir",
      "/srv/cache/box-id",
      "--origin",
      "https://staging.example.com/demo",
    ]);
    expect(args.origin).toBe("https://staging.example.com");
  });

  it("rejects a non-http(s) scheme (ftp) — the only cell that reaches the protocol check itself rather than dying in `new URL`", () => {
    expect(() =>
      parseArgs([
        ...required,
        "--ship",
        "root@box",
        "--ship-dir",
        "/srv/cache/box-id",
        "--origin",
        "ftp://models.masamaeda.com",
      ]),
    ).toThrow(
      /--origin must be an absolute http\(s\) URL, got ftp:\/\/models\.masamaeda\.com/,
    );
  });

  it("refuses a --ship to a bare IPv4 host with no --origin, naming the host and the flag — a ship whose task 4.2 cannot run must never leave argv parsing", () => {
    expect(() =>
      parseArgs([
        ...required,
        "--ship",
        "root@157.90.25.110",
        "--ship-dir",
        "/srv/cache/box-id",
      ]),
    ).toThrow(/157\.90\.25\.110[\s\S]*--origin/);
  });

  it("accepts the same --ship once --origin names task 4.2's target", () => {
    const args = parseArgs([
      ...required,
      "--ship",
      "root@157.90.25.110",
      "--ship-dir",
      "/srv/cache/box-id",
      "--origin",
      "https://models.masamaeda.com",
    ]);
    expect(args.origin).toBe("https://models.masamaeda.com");
  });

  it("rejects --origin with no scheme — the exact string tasks.md 1.5 uses", () => {
    expect(() =>
      parseArgs([
        ...required,
        "--ship",
        "root@box",
        "--ship-dir",
        "/srv/cache/box-id",
        "--origin",
        "models.masamaeda.com",
      ]),
    ).toThrow(
      /--origin must be an absolute http\(s\) URL, got models\.masamaeda\.com/,
    );
  });

  it("accepts --origin alone, without --ship — it only retargets the printed no-ship template (shipInstructions)", () => {
    const args = parseArgs([
      ...required,
      "--origin",
      "https://staging.example.com",
    ]);
    expect(args.origin).toBe("https://staging.example.com");
    expect(args.ship).toBeUndefined();
  });
});

describe("originFromShip", () => {
  it("derives https://<host> from a hostname, with or without a user@", () => {
    expect(originFromShip("models.masamaeda.com")).toBe(
      "https://models.masamaeda.com",
    );
    expect(originFromShip("root@models.masamaeda.com")).toBe(
      "https://models.masamaeda.com",
    );
  });

  it("splits at the rightmost @ — a user portion that itself carries one", () => {
    // indexOf would have split "user@host@weird" at the first @, deriving
    // https://host@weird instead of the host after every @ — the one
    // ssh/rsync themselves would use.
    expect(originFromShip("user@host@weird")).toBe("https://weird");
  });

  it("refuses to derive an origin from a bare IPv4 address", () => {
    // The demo box is reached as root@157.90.25.110 for ssh/rsync but serves
    // the demo at models.masamaeda.com — deriving an origin from the IP
    // would reach a host with no certificate for that name, and silently
    // verifying against DEMO_ORIGIN would hit-check *production* for a ship
    // to any other IPv4 box (root@192.168.1.10, root@127.0.0.1, …).
    expect(originFromShip("root@157.90.25.110")).toBeNull();
    expect(originFromShip("157.90.25.110")).toBeNull();
  });

  it("refuses to derive an origin from a bare IPv6 literal too", () => {
    expect(originFromShip("root@::1")).toBeNull();
    expect(originFromShip("root@[2001:db8::1]")).toBeNull();
  });

  it("refuses to derive an origin from an empty host (--ship root@)", () => {
    // Without this arm an empty host falls through to `https://${host}`,
    // i.e. the bare string "https://" — not null, so parseArgs would treat
    // it as a derived origin instead of refusing and asking for --origin.
    expect(originFromShip("root@")).toBeNull();
  });

  it("an explicit origin wins outright, even over a derivable name", () => {
    expect(
      originFromShip("models.masamaeda.com", "https://staging.example.com"),
    ).toBe("https://staging.example.com");
    expect(
      originFromShip("root@157.90.25.110", "https://staging.example.com"),
    ).toBe("https://staging.example.com");
  });
});

/**
 * `ship()`'s post-restart readiness poll (task 4.2's gate), driven with a
 * fake `fetch` and a shrunk deadline/poll so a cell does not wait out a real
 * 60s — each of these answers must be read as "not ready yet" and keep
 * polling rather than resolving early, then the run must still end at the
 * deadline rather than hanging. Each also bounds the call count: a 50ms
 * deadline at a 10ms poll interval makes at most ~6 attempts — nowhere near
 * what removing the `sleep(pollMs)` between attempts would produce (a hot
 * spin bounded only by wall-clock time, which is hundreds of calls even in
 * 50ms) — so the ceiling catches an unpaced poll a bare `calls > 1` cannot.
 */
describe("waitForShipReady", () => {
  const CALL_CEILING = 20;

  it("SHIP_READY_DEADLINE_MS / POLL_MS / SHIP_READY_PROBE_TIMEOUT_MS are the real constants the exported defaults reference", () => {
    expect(SHIP_READY_DEADLINE_MS).toBe(60_000);
    expect(POLL_MS).toBe(2_000);
    expect(SHIP_READY_PROBE_TIMEOUT_MS).toBe(5_000);
  });

  it("keeps polling a body that is not JSON, then hits the deadline", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return new Response("not json", { status: 200 });
    };
    await expect(
      waitForShipReady("http://box", fetchFn, 50, 10),
    ).rejects.toThrow(
      /http:\/\/box\/api\/library did not answer ready within 0\.05s/,
    );
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(CALL_CEILING);
  });

  it("keeps polling a 404 even with a parseable ready body, then hits the deadline", async () => {
    // The body is deliberately a settled `{state:"ready"}` — the fixture
    // Fix 4 replaced a bodyless 404 with. Deleting the `r.ok` guard
    // (`.then((r) => (r.ok ? r.json() : null))` → `.then((r) => r.json())`)
    // would read this body as ready on the very first call and resolve
    // instead of rejecting; a bodyless 404 could not tell the two apart,
    // since `r.json()` rejects either way once `r.ok` is gone.
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return new Response(JSON.stringify({ state: "ready" }), {
        status: 404,
      });
    };
    await expect(
      waitForShipReady("http://box", fetchFn, 50, 10),
    ).rejects.toThrow(/did not answer ready within 0\.05s/);
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(CALL_CEILING);
  });

  it('keeps polling a settled-but-not-ready state ({"state":"missing"}), then hits the deadline', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return new Response(JSON.stringify({ state: "missing" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await expect(
      waitForShipReady("http://box", fetchFn, 50, 10),
    ).rejects.toThrow(/did not answer ready within 0\.05s/);
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(CALL_CEILING);
  });

  it("resolves as soon as the state reads ready, without waiting for the deadline — probeTimeoutMs is injectable too", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return new Response(JSON.stringify({ state: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await expect(
      waitForShipReady("http://box", fetchFn, 50, 10, 1_000),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("pins probeTimeoutMs onto the per-attempt AbortSignal.timeout — Fix 6: a fetchFn that only settles once the signal aborts proves the injected value is armed, not the real 5s default", async () => {
    // Deleting `probeTimeoutMs` from `AbortSignal.timeout(probeTimeoutMs)` in
    // favour of the `SHIP_READY_PROBE_TIMEOUT_MS` constant leaves the cell
    // above green (it never lets a real timeout fire) — this one only passes
    // when the value actually reaches the signal: at the real 5s default the
    // very first attempt would still be waiting long after the assertions
    // below run.
    let aborts = 0;
    const fetchFn: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborts++;
          reject(new Error("aborted"));
        });
      });
    const start = Date.now();
    await expect(
      waitForShipReady("http://box", fetchFn, 100, 10, 20),
    ).rejects.toThrow(/did not answer ready within 0\.1s/);
    expect(Date.now() - start).toBeLessThan(500);
    expect(aborts).toBeGreaterThan(1);
  });
});

const BASE_ARGS: BakeArgs = {
  root: "/corpus",
  cache: "/scratch",
  indexCache: "/index",
  port: 3199,
};

/**
 * `bake()`'s origin decision (Fix 3), pulled out of `bake()` as
 * `resolveShipOrigin` so it can be celled without running a bake.
 *
 * Falsifies the pre-Fix-3 regression: replacing the `resolved === null`
 * refusal with `origin = resolved ?? "<origin>"` turns the first cell below
 * from a refusal into a silent `"<origin>"` — a `--ship` whose task 4.2
 * cannot run reaching `ship()` instead of being stopped in `bake()`.
 */
describe("resolveShipOrigin (bake()'s origin decision, pulled out to be celled)", () => {
  it("refuses a --ship to a bare IP with no --origin", () => {
    expect(() =>
      resolveShipOrigin({ ...BASE_ARGS, ship: "root@157.90.25.110" }),
    ).toThrow(/157\.90\.25\.110/);
  });

  it("resolves --origin when given, even for a bare-IP --ship", () => {
    expect(
      resolveShipOrigin({
        ...BASE_ARGS,
        ship: "root@157.90.25.110",
        origin: "https://staging.example.com",
      }),
    ).toBe("https://staging.example.com");
  });

  it("derives https://<host> from a named --ship host", () => {
    expect(
      resolveShipOrigin({ ...BASE_ARGS, ship: "root@box.example.com" }),
    ).toBe("https://box.example.com");
  });

  it("without --ship, yields --origin when given, else the <origin> placeholder", () => {
    expect(resolveShipOrigin(BASE_ARGS)).toBe("<origin>");
    expect(
      resolveShipOrigin({
        ...BASE_ARGS,
        origin: "https://staging.example.com",
      }),
    ).toBe("https://staging.example.com");
  });
});

/**
 * `bake()`'s box-directory decision (Fix 4), mirroring `resolveShipOrigin`.
 *
 * Falsifies the pre-Fix-4 regression: replacing the `args.shipDir ===
 * undefined` refusal with `boxDir = args.shipDir ?? "/srv/cache/<box id>"`
 * turns the first cell below from a refusal into a silent placeholder —
 * which sat on `ship()`'s *running* branch, so a hand-built `BakeArgs` with
 * `ship` set and `shipDir` absent would have built a real rsync target of
 * `root@host:/srv/cache/<box id>/`.
 */
describe("resolveShipBoxDir (bake()'s box-directory decision)", () => {
  it("refuses a --ship with no --ship-dir — parseArgs should already have refused this", () => {
    expect(() => resolveShipBoxDir({ ...BASE_ARGS, ship: "root@box" })).toThrow(
      /--ship-dir/,
    );
  });

  it("resolves --ship-dir verbatim when --ship is given", () => {
    expect(
      resolveShipBoxDir({
        ...BASE_ARGS,
        ship: "root@box",
        shipDir: "/srv/cache/box-id",
      }),
    ).toBe("/srv/cache/box-id");
  });

  it("without --ship, answers --ship-dir when given, else the same placeholder shipInstructions prints (unused by ship() on that branch)", () => {
    expect(resolveShipBoxDir(BASE_ARGS)).toBe("/srv/cache/<box id>");
    expect(
      resolveShipBoxDir({ ...BASE_ARGS, shipDir: "/srv/cache/box-id" }),
    ).toBe("/srv/cache/box-id");
  });
});

describe("shipInstructions (the no-`--ship` printed template)", () => {
  it("uses the resolved origin, not a hardcoded demo one — including the example-queries line landing-page D9 added", () => {
    const lines = shipInstructions(
      BASE_ARGS,
      "local-id",
      MODELS,
      "https://staging.example.com",
    );
    expect(lines.some((l) => l.includes("staging.example.com"))).toBe(true);
    expect(lines.some((l) => l.includes("models.masamaeda.com"))).toBe(false);
    expect(
      lines.some((l) =>
        l.includes("check-example-queries.ts https://staging.example.com"),
      ),
    ).toBe(true);
  });

  it("prints the <origin> placeholder when neither --ship nor --origin was given, and never the demo's origin", () => {
    const lines = shipInstructions(BASE_ARGS, "local-id", MODELS, "<origin>");
    expect(lines.some((l) => l.includes("<origin>"))).toBe(true);
    expect(lines.some((l) => l.includes("models.masamaeda.com"))).toBe(false);
  });
});

/** The id this run "shipped to" in every cell below — what `readyFetch`'s `/api/library` answers and what `verifyShip` is asked to confirm against. */
const SHIPPED_ID = "local-id";

/** A hit-check response `hitCheck` accepts cleanly: a hit at the recipe's rig, an ok image at THUMB_MIME with an immutable cache-control. */
function readyFetch(): FetchLike {
  return async (url) => {
    const u = String(url);
    if (u.includes("/api/library"))
      return new Response(JSON.stringify({ state: "ready", id: SHIPPED_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (u.includes("/api/thumb/image"))
      return new Response("webp bytes", {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    if (u.includes("/api/thumb?"))
      return new Response(JSON.stringify({ status: "hit", rig: RECIPE.rig }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    throw new Error(`readyFetch: unexpected request ${u}`);
  };
}

/** A `readyFetch` whose every example query answers non-empty — the whole chain past the hit checks passes. */
function readyFetchWithLiveExamples(): FetchLike {
  const ready = readyFetch();
  return async (url, init) => {
    const u = String(url);
    if (u.includes("/api/semantic"))
      return new Response(
        JSON.stringify({ entries: [{ path: "/kit/a.stl" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    return ready(u, init);
  };
}

/**
 * `ship()`'s post-restart sequence, extracted as `verifyShip` so it can be
 * driven without a network or a shell (`ship()`'s own shipping branch runs a
 * real `rsync`/`ssh`, and is celled separately below with a stubbed
 * `runCmd`). Every path a run that has already shipped bytes and restarted
 * the box must not survive as exit 0.
 *
 * Falsifies the regression `339e3aa` fixed and this round's own structural
 * fix depends on: reverting `throw err;` to `return;` in the catch block
 * below turns the first cell's rejection into a silent resolution — the
 * cell that follows records that failure verbatim.
 */
describe("verifyShip (ship()'s post-restart sequence, task 4.2 and landing-page D9)", () => {
  it("rejects when the box never answers ready — a never-ready ship must not exit 0", async () => {
    const fetchFn: FetchLike = async () =>
      new Response(JSON.stringify({ state: "missing" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await expect(
      verifyShip("http://box", MODELS, RECIPE, SHIPPED_ID, fetchFn, 50, 10, 10),
    ).rejects.toThrow(/did not answer ready within 0\.05s/);
  });

  it("rejects naming both ids when the box's ready id does not match what this run shipped to — Fix 2: nothing else ties --origin to --ship, so a mismatched origin must not hit-check a different box's store", async () => {
    await expect(
      verifyShip(
        "http://box",
        MODELS,
        RECIPE,
        "other-id",
        readyFetch(),
        50,
        10,
        10,
      ),
    ).rejects.toThrow(
      new RegExp(
        `${SHIPPED_ID}[\\s\\S]*other-id|other-id[\\s\\S]*${SHIPPED_ID}`,
      ),
    );
  });

  it("proceeds past the readiness/id gate when the box's ready id matches what this run shipped to", async () => {
    await expect(
      verifyShip(
        "http://box",
        MODELS,
        RECIPE,
        SHIPPED_ID,
        readyFetchWithLiveExamples(),
        50,
        10,
        10,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects when the box answers ready but a hit check then fails — a shipped store must not exit 0 with a bad render live", async () => {
    const fetchFn: FetchLike = async (url) => {
      const body = String(url).includes("/api/library")
        ? { state: "ready", id: SHIPPED_ID }
        : { status: "miss" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await expect(
      verifyShip("http://box", MODELS, RECIPE, SHIPPED_ID, fetchFn, 50, 10, 10),
    ).rejects.toThrow(/hit check failed/);
  });

  it("collects every failing hit check rather than throwing on the first — Fix 7: a hand fixing a store wants the whole list", async () => {
    const aStl = encodeURIComponent("/kit/a.stl");
    const bStl = encodeURIComponent("/kit/b.stl");
    const fetchFn: FetchLike = async (url) => {
      const u = String(url);
      if (u.includes("/api/library"))
        return new Response(
          JSON.stringify({ state: "ready", id: SHIPPED_ID }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (u.includes("/api/thumb/image"))
        return new Response("webp bytes", {
          status: 200,
          headers: {
            "content-type": "image/webp",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      if (u.includes("/api/thumb?")) {
        // a's ao=on check fails; b's ao=off (noao) check fails; every other
        // model/variant hits — exactly two failures, on two different models.
        const bad =
          (u.includes(aStl) && !u.includes("ao=off")) ||
          (u.includes(bStl) && u.includes("ao=off"));
        return new Response(
          JSON.stringify({ status: bad ? "miss" : "hit", rig: RECIPE.rig }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected request ${u}`);
    };
    let caught: unknown;
    try {
      await verifyShip(
        "http://box",
        MODELS,
        RECIPE,
        SHIPPED_ID,
        fetchFn,
        50,
        10,
        10,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/^2 hit check\(s\) failed:/);
    expect(message).toContain("/kit/a.stl ao");
    expect(message).toContain("/kit/b.stl noao");
  });

  it("rejects when the box is ready, the id matches and every hit check passes, but an example query comes back dead — a shipped store must not exit 0 with a dead chip on the landing page", async () => {
    const ready = readyFetch();
    const fetchFn: FetchLike = async (url, init) => {
      const u = String(url);
      if (u.includes("/api/semantic"))
        // Every example query's grid comes back empty — all dead.
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return ready(u, init);
    };
    await expect(
      verifyShip("http://box", MODELS, RECIPE, SHIPPED_ID, fetchFn, 50, 10, 10),
    ).rejects.toThrow(/example queries did not all answer/);
  });

  it("threads probeTimeoutMs to the readiness poll rather than arming the real 5s default per attempt", async () => {
    let aborts = 0;
    const fetchFn: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborts++;
          reject(new Error("aborted"));
        });
      });
    const start = Date.now();
    await expect(
      verifyShip(
        "http://box",
        MODELS,
        RECIPE,
        SHIPPED_ID,
        fetchFn,
        100,
        10,
        20,
      ),
    ).rejects.toThrow(/did not answer ready within 0\.1s/);
    // At a 20ms per-attempt probe timeout, several attempts fit inside the
    // 100ms deadline; at the real 5s default (the constant this parameter
    // replaces on the production path), the very first attempt alone would
    // still be waiting long after this assertion runs.
    expect(Date.now() - start).toBeLessThan(500);
    expect(aborts).toBeGreaterThan(1);
  });
});

/**
 * `ship()`'s own shipping branch (Fix 1): the invariant this whole file
 * serves — a run that ships bytes and restarts the box must never exit 0
 * without `verifyShip` having run against it — has its production call site
 * here, and this is the seam that lets a cell pin it without a network or a
 * shell. A never-ready `fetchFn` makes `verifyShip` reject the way a real box
 * that never comes back up after the restart would, proving `ship()` awaits
 * it rather than firing-and-forgetting.
 *
 * Falsifies the round-five regression Fix 1 targets: deleting `await
 * verifyShip(...)` from `ship()`'s body turns this cell's rejection into a
 * silent resolution while every other cell in the suite (60/60 before this
 * round) stays green.
 */
describe("ship (the injectable seam onto rsync/ssh/verifyShip — Fix 1)", () => {
  function stubRun(): {
    calls: { cmd: string; args: string[] }[];
    runCmd: RunLike;
  } {
    const calls: { cmd: string; args: string[] }[] = [];
    const runCmd: RunLike = (cmd, args) => {
      calls.push({ cmd, args });
    };
    return { calls, runCmd };
  }

  it("rejects when verifyShip's readiness wait never settles — the stub already recorded the rsync and the restart", async () => {
    const { calls, runCmd } = stubRun();
    const neverReady: FetchLike = async () =>
      new Response(JSON.stringify({ state: "missing" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await expect(
      ship(
        { ...BASE_ARGS, ship: "root@box", shipDir: "/srv/cache/box-id" },
        "local-id",
        MODELS,
        RECIPE,
        "https://box.example.com",
        "/srv/cache/box-id",
        runCmd,
        neverReady,
        50,
        10,
        10,
      ),
    ).rejects.toThrow(/did not answer ready within 0\.05s/);
    expect(calls).toEqual([
      {
        cmd: "rsync",
        args: rsyncArgv(
          BASE_ARGS.cache,
          "local-id",
          "root@box",
          "/srv/cache/box-id",
        ),
      },
      { cmd: "ssh", args: sshRestartArgv("root@box") },
    ]);
  });

  it("prints the no-ship template and never calls runCmd when --ship is absent", async () => {
    const { calls, runCmd } = stubRun();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await ship(
        BASE_ARGS,
        "local-id",
        MODELS,
        RECIPE,
        "<origin>",
        "/srv/cache/<box id>",
        runCmd,
      );
    } finally {
      log.mockRestore();
    }
    expect(calls).toEqual([]);
  });
});

/**
 * `runPass`'s launch-budget decision (D1 step 6), pulled out as `shouldRefuse`
 * so it can be celled without a Playwright page. Feeds a sequence of `Generate
 * N missing thumbnails` counts through it from a fresh budget and reports
 * either the refusal reason it hit, or that the whole sequence launched clean.
 */
describe("shouldRefuse (runPass's launch budget)", () => {
  function drive(counts: number[]): {
    refusal: string | null;
    launches: number;
  } {
    let budget: LaunchBudget = INITIAL_LAUNCH_BUDGET;
    for (const n of counts) {
      const decision = shouldRefuse(n, budget);
      if (decision.refuse !== null)
        return { refusal: decision.refuse, launches: budget.total };
      budget = decision.budget;
    }
    return { refusal: null, launches: budget.total };
  }

  it("a monotone-descending count never refuses", () => {
    const counts = Array.from({ length: 120 }, (_, i) => 120 - i);
    expect(drive(counts)).toEqual({ refusal: null, launches: counts.length });
  });

  it("an oscillating count (100, 99, 100, 99, …) refuses — db935a3's regression", () => {
    // The count that fell below the *previous* launch, not the best ever
    // seen, counted as progress under db935a3: every dip to 99 reset the
    // budget, so this sequence launched forever. Run it out to 200 to prove
    // it terminates well short of that (it refuses on the 4th launch).
    const counts = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0 ? 100 : 99,
    );
    const result = drive(counts);
    expect(result.refusal).toMatch(/the count stuck at 99 after 2 launches/);
    expect(result.launches).toBeLessThan(10);
  });

  it("a flat count (5, 5, 5, …) refuses after MAX_LAUNCHES", () => {
    const result = drive([5, 5, 5, 5]);
    expect(result.refusal).toMatch(/the count stuck at 5 after 2 launches/);
  });

  it("a monotone-descending count past 200 launches hits the hard ceiling, not the stuck-count budget", () => {
    // Every count is progress (strictly lower than the last), so `launches`
    // (MAX_LAUNCHES) never trips — the only thing here is MAX_TOTAL_LAUNCHES.
    // Deleting that block leaves this 40/40-green (task 5): the monotone cell
    // above stops at 120, well under the ceiling.
    const counts = Array.from({ length: 201 }, (_, i) => 1000 - i);
    const result = drive(counts);
    expect(result.refusal).toMatch(/hit the hard ceiling of 200 launches/);
    expect(result.launches).toBe(200);
  });

  it("a slow sawtooth that keeps making real progress (100, 99, 100, 98, 100, 97, …) still hits the hard ceiling", () => {
    // Every other launch dips below the all-time best (100→99→…), so
    // `launches` resets on every progressing step and never trips either —
    // the oscillating cell above only catches a count that repeats a value
    // it has already seen, which this sequence never does. Only the hard
    // ceiling, at total 200, stops it.
    const counts: number[] = [];
    let low = 100;
    for (let i = 0; i < 220; i++) counts.push(i % 2 === 0 ? 100 : (low -= 1));
    const result = drive(counts);
    expect(result.refusal).toMatch(/hit the hard ceiling of 200 launches/);
    expect(result.launches).toBe(200);
  });
});

describe("the manifest under bake/ and the startup sweep (task 1.4)", () => {
  it("survives maintain(), every sidecar is annotated afterwards, and no stranger is warned about", async () => {
    const s = await completeStore();
    const file = await writeManifest(
      s.cacheDir,
      s.id,
      manifestFor(manifestInput()),
    );
    // A fresh cache over the same store, so `annotate` reflects what this
    // `maintain()` itself learned rather than what `put` already remembered.
    const resumed = new ThumbCache(s.cacheDir, CAP, 1, libraryFor(s.top));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await resumed.maintain();
      expect(existsSync(file)).toBe(true);
      for (const m of MODELS)
        expect(resumed.annotate(m.path, m.mtime), m.path).toBeDefined();
      // The subdirectory is what keeps the sweep from ever reading the manifest
      // as a sidecar: no stranger seen, no warning. The **control** — what a
      // `bake.json` copied up to the id level does — is cache.test.ts's cell
      // "skips a stranger *.json with no `path` (a manifest copied up from
      // bake/) rather than aborting the sweep" (task 1.7): the file survives,
      // `maintain()` resolves, one warning names it, every sidecar is
      // annotated. Never assert that a flat manifest is removed at the id
      // level; it is not (design Context, second bullet).
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
