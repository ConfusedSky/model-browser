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
  type BakeModel,
  type FetchLike,
  type ManifestInput,
  type ManifestRecipe,
  DEMO_ORIGIN,
  auditUnposed,
  fetchPoses,
  indexCacheDirMatches,
  indexFingerprint,
  manifestFor,
  manifestPath,
  originFromShip,
  parseArgs,
  rsyncCommand,
  sidecarKey,
  verifyBake,
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

  it("lists a noao label that is null rather than throwing", async () => {
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
    expect(missFor(r.misses, "/kit/b.stl")!.reasons).toEqual([
      "noao: no labels",
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

  it("resolves root/cache/index-cache/client/ship-dir to absolute paths, against process.cwd()", () => {
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
    expect(args.shipDir).toBeDefined();
    expect(isAbsolute(args.shipDir!)).toBe(true);
    // `--ship` names a host for ssh/rsync, not a local path — left as typed.
    expect(args.ship).toBe("root@box");
    // Already-absolute input is unaffected (existing behaviour, re-pinned).
    expect(parseArgs(required).root).toBe("/corpus");
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

  it("keeps DEMO_ORIGIN when the ship host is a bare IPv4 address", () => {
    // The demo box is reached as root@157.90.25.110 for ssh/rsync but serves
    // the demo at models.masamaeda.com — deriving an origin from the IP
    // would reach a host with no certificate for that name.
    expect(originFromShip("root@157.90.25.110")).toBe(DEMO_ORIGIN);
    expect(originFromShip("157.90.25.110")).toBe(DEMO_ORIGIN);
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
