import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  indexFingerprint,
  type ManifestInput,
  manifestFor,
  POSE_CACHE_FILE,
  RUN_PARAMS_FILE,
  writeManifest,
} from "../../scripts/bake-demo";
import { realTempDir } from "./helpers";

/**
 * `deploy/demo/check-bake.sh` (corpus-bake D2), spawned under `sh` against
 * manifests `manifestFor` produced — never hand-written JSON, so a fixture
 * cannot drift from the writer's formatting the script's line reads depend on.
 *
 * The checkout's versions are obtained here the way the script obtains them:
 * the same `^export const <NAME> = <n>` pattern over the same source file,
 * refused unless it matches one line. Never by importing `renderer.ts` — it
 * imports `three`, which this workspace does not have. The cell that pins the
 * extraction to the *live* constants is the client suite's
 * (`client/test/checkBake.test.ts`); these cells cover every other branch,
 * and drive the two test-only path overrides (`CHECK_BAKE_RENDERER_TS`,
 * `CHECK_BAKE_POSE_TS`) at fixture copies of the source.
 */
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO, "deploy", "demo", "check-bake.sh");
const RENDERER_TS = join(REPO, "client", "src", "three", "renderer.ts");
const POSE_TS = join(REPO, "client", "src", "three", "pose.ts");

/** The script's source extraction, in JS: one `export const <name> = <n>` line, else refused. */
function versionIn(file: string, name: string): number {
  const matches = [
    ...readFileSync(file, "utf8").matchAll(
      new RegExp(`^export const ${name} = (\\d+)`, "gm"),
    ),
  ];
  if (matches.length !== 1)
    throw new Error(`${name}: ${matches.length} lines match in ${file}`);
  return Number(matches[0]![1]);
}
const RIG = versionIn(RENDERER_TS, "RIG_VERSION");
const POSE = versionIn(POSE_TS, "POSE_VERSION");
/** Read per fixture, never once per module: the script asks git the same question
 *  when it runs, and sessions commit to this tree in parallel, so a value read at
 *  import time is a different commit by the time a case asserts on it — which is
 *  silent, since the script only *prints* a differing commit and leaves the exit
 *  code alone. Keep the read next to the `check()` that will be compared to it. */
function headCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}
const OTHER_COMMIT = "f".repeat(40);

// The script's shebang says `#!/bin/sh`, and the box runs dash — but `sh` on
// this machine resolves to bash, which tolerates bashisms a POSIX-only script
// must not lean on. `check()` below re-runs every case under dash too, when
// one is installed, and asserts the two shells agree; a machine with no dash
// just gets sh coverage, same as before this cell existed.
const HAS_DASH =
  spawnSync("sh", ["-c", "command -v dash"], { encoding: "utf8" }).status === 0;
if (!HAS_DASH) {
  console.warn(
    "checkBake.test.ts: no dash on this machine — POSIX parity (sh vs dash) was NOT checked this run",
  );
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  dir: string;
  manifest: string;
  index: string;
  /** The checkout commit this fixture was built against — the side the script
   *  reads for itself, so an expectation must use this and not a second read. */
  head: string;
}

interface FixtureOptions {
  rig?: number;
  poseVersion?: number;
  /** `null` omits `client.commit` — a bake whose git could not answer. Defaults to
   *  the checkout's own commit, read as this fixture is built. */
  commit?: string | null;
}

/** A temp dir holding an index (`pose-cache.json`, `run-params.json`) and a manifest fingerprinting it. */
async function fixture(opts: FixtureOptions = {}): Promise<Fixture> {
  const dir = realTempDir("mb-check-bake-");
  dirs.push(dir);
  const index = join(dir, "index");
  await mkdir(index);
  writeFileSync(join(index, POSE_CACHE_FILE), '{"poses":{"/a.stl":{}}}');
  writeFileSync(join(index, RUN_PARAMS_FILE), '{"views":8,"elevations":[20]}');
  const head = headCommit();
  const commit = opts.commit === undefined ? head : opts.commit;
  const input: ManifestInput = {
    date: "2026-09-15T00:00:00.000Z",
    client: commit === null ? { dirty: false } : { commit, dirty: false },
    recipe: {
      rig: opts.rig ?? RIG,
      poseVersion: opts.poseVersion ?? POSE,
      lighting: "camera",
      size: 256,
    },
    library: { id: "lib", root: "/library" },
    models: 3,
    verify: { renders: { ao: 3, noao: 3 }, posed: 2, unposed: 1 },
    passes: {
      ao: { rendered: 3, elapsed: 1 },
      noao: { rendered: 3, elapsed: 1 },
    },
    index: {
      collectionRoot: "/",
      cacheDir: "/index-cache",
      models: 2,
      views: 8,
      elevations: [20],
      upAxis: "auto",
      ...(await indexFingerprint(index)),
    },
  };
  const manifest = await writeManifest(
    join(dir, "cache"),
    "lib",
    manifestFor(input),
  );
  return { dir, manifest, index, head };
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runArgv(
  shell: string,
  argv: string[],
  env: Record<string, string>,
): Run {
  const r = spawnSync(shell, [SCRIPT, ...argv], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs raw argv under sh, and under dash too when one is installed, asserting agreement. */
function checkArgv(argv: string[], env: Record<string, string> = {}): Run {
  const r = runArgv("sh", argv, env);
  if (HAS_DASH) {
    expect(runArgv("dash", argv, env)).toEqual(r);
  }
  return r;
}

function check(
  manifest: string,
  index?: string,
  env: Record<string, string> = {},
): Run {
  return checkArgv([manifest, ...(index === undefined ? [] : [index])], env);
}

/** A source-file fixture the script is pointed at through its test-only override. */
function sourceCopy(dir: string, name: string, text: string): string {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

const SILENT_OK: Run = { status: 0, stdout: "", stderr: "" };

describe("check-bake.sh", () => {
  it("exits 0 silently when versions, hashes and commit all agree", async () => {
    const f = await fixture();
    expect(check(f.manifest, f.index)).toEqual(SILENT_OK);
  });

  it("names rig when the checkout is one ahead of the bake", async () => {
    const f = await fixture({ rig: RIG - 1 });
    expect(check(f.manifest, f.index)).toEqual({
      status: 1,
      stdout: `rig: checkout ${RIG}, bake ${RIG - 1}\n`,
      stderr: "",
    });
  });

  it("names poseVersion when the pose mapping moved", async () => {
    const f = await fixture({ poseVersion: POSE + 1 });
    expect(check(f.manifest, f.index)).toEqual({
      status: 1,
      stdout: `poseVersion: checkout ${POSE}, bake ${POSE + 1}\n`,
      stderr: "",
    });
  });

  describe("the commit line reports without refusing", () => {
    it("prints checkout and bake commits when they differ, and still exits 0", async () => {
      const f = await fixture({ commit: OTHER_COMMIT });
      expect(check(f.manifest, f.index)).toEqual({
        status: 0,
        stdout: `commit: checkout ${f.head}, bake ${OTHER_COMMIT}\n`,
        stderr: "",
      });
    });

    it("prints nothing when the bake commit equals HEAD", async () => {
      // The default, said out loud: the manifest carries the checkout's own
      // commit, so the line the case above saw has nothing to report.
      const f = await fixture();
      expect(readFileSync(f.manifest, "utf8")).toContain(`"${f.head}"`);
      expect(check(f.manifest, f.index)).toEqual(SILENT_OK);
    });

    it("prints nothing when the manifest carries no client.commit", async () => {
      const f = await fixture({ commit: null });
      expect(readFileSync(f.manifest, "utf8")).not.toContain('"commit"');
      expect(check(f.manifest, f.index)).toEqual(SILENT_OK);
    });

    it("prints nothing when git rev-parse HEAD fails, even at a differing commit", async () => {
      // GIT_DIR names a repository that does not exist, so git stops discovering
      // and fails — confirm that before trusting the silence.
      const env = { GIT_DIR: join(REPO, "no-such-git-dir") };
      const git = spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], {
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      expect(git.status).not.toBe(0);
      const f = await fixture({ commit: OTHER_COMMIT });
      expect(check(f.manifest, f.index, env)).toEqual(SILENT_OK);
    });

    it("does not mask a version disagreement", async () => {
      const f = await fixture({ rig: RIG - 1, commit: OTHER_COMMIT });
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `rig: checkout ${RIG}, bake ${RIG - 1}\ncommit: checkout ${f.head}, bake ${OTHER_COMMIT}\n`,
      );
    });

    it("refuses a manifest whose commit line appears twice", async () => {
      const f = await fixture();
      const text = readFileSync(f.manifest, "utf8");
      const line = text.split("\n").find((l) => l.includes('"commit"'));
      if (line === undefined) throw new Error("no commit line");
      const mutated = text.replace(line, `${line}\n${line}`);
      writeFileSync(f.manifest, mutated);
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `"commit": 2 lines match in ${f.manifest}, expected at most 1\n`,
      );
    });
  });

  describe("the index fingerprint", () => {
    it("refuses a pose cache whose hash differs, naming both hashes", async () => {
      const f = await fixture();
      const baked = await indexFingerprint(f.index);
      writeFileSync(
        join(f.index, POSE_CACHE_FILE),
        '{"poses":{"/a.stl":{},"/b.stl":{}}}',
      );
      const now = await indexFingerprint(f.index);
      expect(check(f.manifest, f.index)).toEqual({
        status: 1,
        stdout: `${POSE_CACHE_FILE}: index ${now.poseCacheSha256}, bake ${baked.poseCacheSha256}\n`,
        stderr: "",
      });
    });

    it("refuses a run-params.json whose hash differs, naming it", async () => {
      const f = await fixture();
      const baked = await indexFingerprint(f.index);
      writeFileSync(
        join(f.index, RUN_PARAMS_FILE),
        '{"views":12,"elevations":[20]}',
      );
      const now = await indexFingerprint(f.index);
      expect(check(f.manifest, f.index)).toEqual({
        status: 1,
        stdout: `${RUN_PARAMS_FILE}: index ${now.runParamsSha256}, bake ${baked.runParamsSha256}\n`,
        stderr: "",
      });
    });

    it("treats a missing index file as a disagreement, not a skip", async () => {
      const f = await fixture();
      unlinkSync(join(f.index, RUN_PARAMS_FILE));
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(
        new RegExp(
          `^${RUN_PARAMS_FILE}: index missing ${join(f.index, RUN_PARAMS_FILE)}, bake [0-9a-f]{64}\n$`,
        ),
      );
    });

    it("compares no hashes when no index directory is given, but says so", async () => {
      const f = await fixture();
      writeFileSync(join(f.index, POSE_CACHE_FILE), "rewritten");
      expect(check(f.manifest)).toEqual({
        status: 0,
        stdout: "index: not checked, no index directory given\n",
        stderr: "",
      });
    });

    it("compares no hashes when the index argument is empty, and says so too", async () => {
      const f = await fixture();
      writeFileSync(join(f.index, POSE_CACHE_FILE), "rewritten");
      expect(check(f.manifest, "")).toEqual({
        status: 0,
        stdout: "index: not checked, no index directory given\n",
        stderr: "",
      });
    });

    it("refuses a poseCacheSha256 that is not 64 hex chars, naming the read", async () => {
      const f = await fixture();
      const text = readFileSync(f.manifest, "utf8");
      const mutated = text.replace(
        /"poseCacheSha256": "[0-9a-f]{64}"/,
        '"poseCacheSha256": "not-a-hash"',
      );
      expect(mutated).not.toBe(text);
      writeFileSync(f.manifest, mutated);
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `"poseCacheSha256": 0 lines match in ${f.manifest}, expected exactly 1\n`,
      );
    });

    it("refuses a manifest whose poseCacheSha256 line appears twice, naming the read", async () => {
      const f = await fixture();
      const text = readFileSync(f.manifest, "utf8");
      const line = text
        .split("\n")
        .find((l) => l.includes('"poseCacheSha256"'));
      if (line === undefined) throw new Error("no poseCacheSha256 line");
      const mutated = text.replace(line, `${line}\n${line}`);
      writeFileSync(f.manifest, mutated);
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `"poseCacheSha256": 2 lines match in ${f.manifest}, expected exactly 1\n`,
      );
    });

    it("refuses a runParamsSha256 that is not 64 hex chars, naming the read", async () => {
      const f = await fixture();
      const text = readFileSync(f.manifest, "utf8");
      const mutated = text.replace(
        /"runParamsSha256": "[0-9a-f]{64}"/,
        '"runParamsSha256": "not-a-hash"',
      );
      expect(mutated).not.toBe(text);
      writeFileSync(f.manifest, mutated);
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `"runParamsSha256": 0 lines match in ${f.manifest}, expected exactly 1\n`,
      );
    });

    it("refuses a manifest whose runParamsSha256 line appears twice, naming the read", async () => {
      const f = await fixture();
      const text = readFileSync(f.manifest, "utf8");
      const line = text
        .split("\n")
        .find((l) => l.includes('"runParamsSha256"'));
      if (line === undefined) throw new Error("no runParamsSha256 line");
      const mutated = text.replace(line, `${line}\n${line}`);
      writeFileSync(f.manifest, mutated);
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `"runParamsSha256": 2 lines match in ${f.manifest}, expected exactly 1\n`,
      );
    });
  });

  it("exits 1 naming the path when the manifest is missing", async () => {
    const f = await fixture();
    const missing = join(f.dir, "nowhere", "bake.json");
    expect(check(missing, f.index)).toEqual({
      status: 1,
      stdout: `no bake manifest at ${missing}\n`,
      stderr: "",
    });
  });

  describe("the exactly-one-line guard", () => {
    it("refuses a renderer.ts whose constant appears on two lines", async () => {
      const f = await fixture();
      const copy = sourceCopy(
        f.dir,
        "renderer.ts",
        `${readFileSync(RENDERER_TS, "utf8")}\nexport const RIG_VERSION = ${RIG}\n`,
      );
      const r = check(f.manifest, f.index, { CHECK_BAKE_RENDERER_TS: copy });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `RIG_VERSION: 2 lines match in ${copy}, expected exactly 1\n`,
      );
    });

    it("refuses a source file from which the constant has gone", async () => {
      const f = await fixture();
      const copy = sourceCopy(
        f.dir,
        "pose.ts",
        readFileSync(POSE_TS, "utf8").replace(
          /^export const POSE_VERSION = /m,
          "export const POSE_MAPPING = ",
        ),
      );
      const r = check(f.manifest, f.index, { CHECK_BAKE_POSE_TS: copy });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(
        `POSE_VERSION: 0 lines match in ${copy}, expected exactly 1\n`,
      );
    });

    it("refuses a manifest re-serialised onto one line, naming each read that matched 0 lines", async () => {
      const f = await fixture();
      writeFileSync(
        f.manifest,
        JSON.stringify(JSON.parse(readFileSync(f.manifest, "utf8"))),
      );
      const r = check(f.manifest, f.index);
      expect(r.status).toBe(1);
      // With the bake hashes unreadable the index files have nothing to disagree
      // with, so the refusals are the whole output.
      expect(r.stdout).toBe(
        [
          `"rig": 0 lines match in ${f.manifest}, expected exactly 1`,
          `"poseVersion": 0 lines match in ${f.manifest}, expected exactly 1`,
          `"poseCacheSha256": 0 lines match in ${f.manifest}, expected exactly 1`,
          `"runParamsSha256": 0 lines match in ${f.manifest}, expected exactly 1`,
          "",
        ].join("\n"),
      );
    });
  });

  describe("two-digit versions", () => {
    // RIG_VERSION and POSE_VERSION are single digits today, so a pattern that
    // only ever took one digit would pass every cell above. These fixtures carry
    // two-digit constants through the test-only overrides.
    it("reads a two-digit constant whole and agrees with a two-digit manifest", async () => {
      const f = await fixture({ rig: 12, poseVersion: 10 });
      const env = {
        CHECK_BAKE_RENDERER_TS: sourceCopy(
          f.dir,
          "renderer.ts",
          "export const RIG_VERSION = 12\n",
        ),
        CHECK_BAKE_POSE_TS: sourceCopy(
          f.dir,
          "pose.ts",
          "export const POSE_VERSION = 10\n",
        ),
      };
      expect(check(f.manifest, f.index, env)).toEqual(SILENT_OK);
    });

    it("compares two-digit values whole", async () => {
      const f = await fixture({ rig: 11 });
      const env = {
        CHECK_BAKE_RENDERER_TS: sourceCopy(
          f.dir,
          "renderer.ts",
          "export const RIG_VERSION = 12\n",
        ),
      };
      expect(check(f.manifest, f.index, env)).toEqual({
        status: 1,
        stdout: "rig: checkout 12, bake 11\n",
        stderr: "",
      });
    });
  });

  describe("usage", () => {
    // check() only ever spawns 1 or 2 argv entries (manifest, optional index);
    // the invalid-argc arm needs a 0- or 3-argv variant, routed through
    // checkArgv so it too runs under dash when one is installed.
    it("exits 2 with a usage line when given no arguments", () => {
      const r = checkArgv([]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`usage: ${SCRIPT} <manifest> [<index dir>]\n`);
    });

    it("exits 2 with a usage line when given three arguments", () => {
      const r = checkArgv(["a", "b", "c"]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`usage: ${SCRIPT} <manifest> [<index dir>]\n`);
    });
  });
});
