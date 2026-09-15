import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import {
  indexFingerprint,
  manifestFor,
  POSE_CACHE_FILE,
  RUN_PARAMS_FILE,
  writeManifest,
} from "../../scripts/bake-demo";
import { POSE_VERSION } from "../src/three/pose";

/**
 * The one cell that pins `deploy/demo/check-bake.sh`'s source extraction to the
 * *live* constants (corpus-bake D2): a manifest `manifestFor` built from the
 * imported `RIG_VERSION` and `POSE_VERSION` passes the check against this
 * checkout. Every other branch of the script is `server/test/checkBake.test.ts`'s,
 * which reads the constants by the script's own pattern; this suite is where
 * `renderer.ts` (which imports `three`) can be imported at all. The import is
 * dynamic — the module creates no renderer at load (`renderer` is a `let … =
 * null`), and a static one would bind this file to WebGL at collection time.
 */
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO, "deploy", "demo", "check-bake.sh");

const dir = realpathSync(mkdtempSync(join(tmpdir(), "mb-check-bake-live-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("exits 0 silently for a manifest baked at the live RIG_VERSION and POSE_VERSION", async () => {
  const { RIG_VERSION } = await import("../src/three/renderer");
  const index = join(dir, "index");
  mkdirSync(index);
  writeFileSync(join(index, POSE_CACHE_FILE), '{"poses":{}}');
  writeFileSync(join(index, RUN_PARAMS_FILE), '{"views":8}');
  const manifest = await writeManifest(
    join(dir, "cache"),
    "lib",
    manifestFor({
      date: "2026-09-15T00:00:00.000Z",
      client: { dirty: false },
      recipe: {
        rig: RIG_VERSION,
        poseVersion: POSE_VERSION,
        lighting: "camera",
        size: 256,
      },
      library: { id: "lib", root: "/library" },
      models: 1,
      verify: { renders: { ao: 1, noao: 1 }, posed: 1, unposed: 0 },
      passes: {
        ao: { rendered: 1, elapsed: 1 },
        noao: { rendered: 1, elapsed: 1 },
      },
      index: {
        collectionRoot: "/",
        cacheDir: "/index-cache",
        models: 1,
        views: 8,
        elevations: [20],
        upAxis: "auto",
        ...(await indexFingerprint(index)),
      },
    }),
  );
  const r = spawnSync("sh", [SCRIPT, manifest, index], { encoding: "utf8" });
  expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({
    status: 0,
    stdout: "",
    stderr: "",
  });
});
