import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FeatureReport } from "../../shared/types";
import { DEFAULT_FEATURES, createApp } from "../src/app";
import { ThumbCache } from "../src/cache";
import { ConfigError, loadConfig } from "../src/config";
import { createLibrary } from "../src/library";
import { LOOPBACK, libraryFor, realTempDir } from "./helpers";

/**
 * The deployment's configuration file (`public-deployment` D1/D2, tasks 1.1–1.4
 * and 7.1).
 *
 * The distinction every cell here is about: **absent is silent, authored is
 * loud.** Running with no configuration is the ordinary case; a file someone
 * wrote and this server cannot use is a startup failure naming it, because a
 * misread file may have been the one carrying the origin and the capabilities.
 */
describe("loadConfig", () => {
  function at(dir: string, contents: string): NodeJS.ProcessEnv {
    const file = join(dir, "config.json");
    writeFileSync(file, contents);
    return { MODEL_BROWSER_CONFIG: file };
  }

  it("is silent about an absent file and yields the defaults", async () => {
    const tmp = realTempDir("mb-config-absent-");
    await expect(
      loadConfig({ MODEL_BROWSER_CONFIG: join(tmp, "nothing.json") }),
    ).resolves.toEqual({});
    // And with no variable at all: the XDG location, which is not there either.
    await expect(
      loadConfig({ HOME: tmp, XDG_CONFIG_HOME: join(tmp, "config") }),
    ).resolves.toEqual({});
  });

  it("reads the file the environment selects, from the XDG location by default", async () => {
    const tmp = realTempDir("mb-config-select-");
    const xdg = join(tmp, "config");
    mkdirSync(join(xdg, "model-browser"), { recursive: true });
    writeFileSync(
      join(xdg, "model-browser", "config.json"),
      JSON.stringify({ root: "/from-xdg" }),
    );
    await expect(
      loadConfig({ HOME: tmp, XDG_CONFIG_HOME: xdg }),
    ).resolves.toEqual({ root: "/from-xdg" });

    // MODEL_BROWSER_CONFIG wins over that location, and it is the file named
    // there that is read — not both, and not the default one.
    const elsewhere = join(tmp, "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify({ root: "/from-elsewhere" }));
    await expect(
      loadConfig({
        HOME: tmp,
        XDG_CONFIG_HOME: xdg,
        MODEL_BROWSER_CONFIG: elsewhere,
      }),
    ).resolves.toEqual({ root: "/from-elsewhere" });
  });

  it("fails naming the file when it cannot be parsed", async () => {
    const tmp = realTempDir("mb-config-malformed-");
    const env = at(tmp, '{ "root": ');
    const file = env.MODEL_BROWSER_CONFIG as string;
    // The file is named, because "the configuration is bad" without a path is
    // a search — and this message is the whole of what the operator sees
    // before the process exits.
    await expect(loadConfig(env)).rejects.toThrow(ConfigError);
    await expect(loadConfig(env)).rejects.toThrow(file);
  });

  it("fails on a file that is present but unreadable", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return; // root reads anything
    const tmp = realTempDir("mb-config-unreadable-");
    const env = at(tmp, JSON.stringify({ root: "/x" }));
    chmodSync(env.MODEL_BROWSER_CONFIG as string, 0o000);
    try {
      // Treated as malformed rather than as absent: the file was authored.
      await expect(loadConfig(env)).rejects.toThrow(ConfigError);
      await expect(loadConfig(env)).rejects.toThrow(
        env.MODEL_BROWSER_CONFIG as string,
      );
    } finally {
      chmodSync(env.MODEL_BROWSER_CONFIG as string, 0o600);
    }
  });

  it("refuses an unknown key rather than ignoring it", async () => {
    const tmp = realTempDir("mb-config-unknown-");
    // A typo silently dropped is the disease the loud failure exists to cure:
    // `orgins` read as "unset" would leave a public box answering nothing.
    // There is no free-text key either — JSON has no comments and this file
    // does not invent one (D10).
    await expect(
      loadConfig(at(tmp, JSON.stringify({ orgins: ["https://a.example"] }))),
    ).rejects.toThrow(/unknown key "orgins"/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ features: { thumbWrties: false } }))),
    ).rejects.toThrow(/unknown key "thumbWrties"/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ listen: { hostname: "x" } }))),
    ).rejects.toThrow(/unknown key "hostname"/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ $comment: "a note" }))),
    ).rejects.toThrow(/unknown key "\$comment"/);
  });

  it("refuses a wrong type anywhere", async () => {
    const tmp = realTempDir("mb-config-types-");
    await expect(loadConfig(at(tmp, "[]"))).rejects.toThrow(/JSON object/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ root: 42 }))),
    ).rejects.toThrow(/root must be/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ root: "" }))),
    ).rejects.toThrow(/root must be/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ origins: "https://a.example" }))),
    ).rejects.toThrow(/origins must be an array/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ features: { thumbWrites: "no" } }))),
    ).rejects.toThrow(/features.thumbWrites must be a boolean/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ listen: { port: 0 } }))),
    ).rejects.toThrow(/listen.port must be/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ listen: { port: 3177.5 } }))),
    ).rejects.toThrow(/listen.port must be/);
  });

  it("refuses an origin that is not scheme://host[:port]", async () => {
    const tmp = realTempDir("mb-config-origins-");
    for (const bad of [
      "https://models.example/app", // a path
      "https://models.example/", // a trailing slash is a path
      "models.example", // no scheme
      "ftp://models.example", // not a web origin
      "https://user:pw@models.example", // credentials
      "https://models.example?a=b", // a query
    ]) {
      await expect(
        loadConfig(at(tmp, JSON.stringify({ origins: [bad] }))),
      ).rejects.toThrow(/is not scheme:\/\/host/);
    }
    // The shapes that are origins, including an explicit port.
    await expect(
      loadConfig(
        at(
          tmp,
          JSON.stringify({
            origins: ["https://models.example", "http://box:8080"],
          }),
        ),
      ),
    ).resolves.toEqual({
      origins: ["https://models.example", "http://box:8080"],
    });
  });

  it("accepts every field of the default report, `intro` among them, and still refuses a misspelling", async () => {
    // `FEATURE_KEYS` is `Object.keys(DEFAULT_FEATURES)`, so a field is
    // declarable the moment it has a default — asserted over the whole set
    // rather than over one name, which is what makes this cell fail when a
    // field reaches `FeatureReport` without reaching `DEFAULT_FEATURES`
    // (`landing-page` 1.1). The values alternate so no field is read as the
    // parser's own idea of a default.
    const tmp = realTempDir("mb-config-featurekeys-");
    const keys = Object.keys(DEFAULT_FEATURES);
    expect(keys).toContain("intro");
    const declared = Object.fromEntries(keys.map((k, i) => [k, i % 2 === 0]));
    await expect(
      loadConfig(at(tmp, JSON.stringify({ features: declared }))),
    ).resolves.toEqual({
      features: declared,
    });
    // The demo's own shape, on its own, as the file writes it.
    await expect(
      loadConfig(at(tmp, JSON.stringify({ features: { intro: true } }))),
    ).resolves.toEqual({
      features: { intro: true },
    });
    // And a misspelling is still refused by name — the reason the parse is
    // strict is a capability silently left at its default.
    await expect(
      loadConfig(at(tmp, JSON.stringify({ features: { intor: true } }))),
    ).rejects.toThrow(/unknown key "intor"/);
    await expect(
      loadConfig(at(tmp, JSON.stringify({ features: { intro: "yes" } }))),
    ).rejects.toThrow(/features.intro must be a boolean/);
  });

  it("refuses a public listen.host with no origins, which would answer nobody", async () => {
    // 9.11a. The guard admits loopback and the configured origins, so a box
    // bound past loopback with no origin starts clean and 403s every visitor
    // for its `Host`, with nothing anywhere saying why. It is a configuration
    // error, and it is one at start, where the operator is still watching.
    const tmp = realTempDir("mb-config-listen-");
    for (const listen of [
      { host: "0.0.0.0" },
      { host: "::" },
      { host: "192.168.1.10", port: 3177 },
    ]) {
      await expect(
        loadConfig(at(tmp, JSON.stringify({ listen }))),
      ).rejects.toThrow(
        new RegExp(
          `listen.host ${listen.host.replace(/\./g, "\\.")} is not loopback`,
        ),
      );
    }
    // An empty list is no origins, not "a list was written so it is fine".
    await expect(
      loadConfig(
        at(tmp, JSON.stringify({ listen: { host: "0.0.0.0" }, origins: [] })),
      ),
    ).rejects.toThrow(/no origins are configured/);

    // The two controls, one on each half of the rule. A public host **with** an
    // origin is the deployment shape this project runs behind a proxy...
    await expect(
      loadConfig(
        at(
          tmp,
          JSON.stringify({
            listen: { host: "0.0.0.0" },
            origins: ["https://models.example"],
          }),
        ),
      ),
    ).resolves.toMatchObject({ listen: { host: "0.0.0.0" } });
    // ...and loopback with no origins at all is the ordinary local install,
    // which must not start failing to start.
    for (const host of ["127.0.0.1", "::1", "localhost"]) {
      await expect(
        loadConfig(at(tmp, JSON.stringify({ listen: { host } }))),
      ).resolves.toMatchObject({
        listen: { host },
      });
    }
  });

  it("expands a leading ~/ in root, and only that spelling", async () => {
    // 9.11b: `root` is written by hand in a file no shell ever expanded.
    const tmp = realTempDir("mb-config-tilde-");
    const home = join(tmp, "home");
    const env = {
      ...at(tmp, JSON.stringify({ root: "~/models/kits" })),
      HOME: home,
    };
    await expect(loadConfig(env)).resolves.toEqual({
      root: join(home, "models", "kits"),
    });

    // `~user` needs a passwd lookup this app does not do, and a bare `~` is a
    // directory whose name is a tilde: both stay exactly as written, so a path
    // that is not expanded is not silently pointed somewhere else either.
    for (const root of ["~other/models", "~", "~models", "/srv/~/models"]) {
      await expect(
        loadConfig({ ...at(tmp, JSON.stringify({ root })), HOME: home }),
      ).resolves.toEqual({
        root,
      });
    }

    // And the environment's root is left alone: the shell already expanded it,
    // and a second pass would rewrite a real path that begins with a tilde.
    await expect(
      loadConfig({
        ...at(tmp, JSON.stringify({ root: "/from-the-file" })),
        HOME: home,
        MODEL_BROWSER_ROOT: "~/literal",
      }),
    ).resolves.toEqual({ root: "~/literal" });
  });

  it("lets MODEL_BROWSER_ROOT override the root alone, the rest of the file still taking effect", async () => {
    const tmp = realTempDir("mb-config-envroot-");
    const env = at(
      tmp,
      JSON.stringify({
        root: "/from-the-file",
        origins: ["https://models.example"],
        features: { chatTab: true },
      }),
    );
    // The inversion 1.2 is about: the variable used to return *before* the file
    // was read, so `bun run dev` never parsed it at all.
    const config = await loadConfig({
      ...env,
      MODEL_BROWSER_ROOT: "/from-the-environment",
    });
    expect(config).toEqual({
      root: "/from-the-environment",
      origins: ["https://models.example"],
      features: { chatTab: true },
    });
  });
});

/**
 * The second **named configuration** (D10, tasks 6.1/6.2): the file the public
 * deployment actually runs, committed to the repository and exercised here, so
 * what is deployed cannot drift from what CI proves. Loaded through the same
 * loader the server uses, then read the two ways a server reads it — the report
 * it publishes, and the origins its guard admits.
 */
describe("the shipped demo configuration", () => {
  const file = fileURLToPath(
    new URL("../../deploy/demo/config.json", import.meta.url),
  );

  it("parses, and states every capability rather than inheriting one", async () => {
    // The parse is strict, so a typo in the file this repository ships is a box
    // that does not boot — and the deploy is the first place that shows.
    //
    // The capability *values* are not asserted: they are the deployment's
    // posture, not this suite's business, and mirroring them here would make
    // every deliberate change an edit in two places. What is asserted is that
    // each is stated, since an omitted field silently takes a default and would
    // change posture the next time a default moves.
    const config = await loadConfig({ MODEL_BROWSER_CONFIG: file });
    expect(Object.keys(config).sort()).toEqual([
      "features",
      "listen",
      "origins",
      "root",
    ]);
    expect(Object.keys(config.features ?? {}).sort()).toEqual(
      Object.keys(DEFAULT_FEATURES).sort(),
    );
  });
});

describe("the loaded configuration reaches the library", () => {
  it("carries the file root through to the library state", async () => {
    // The one cell composing the two: `loadConfig`'s shape is what
    // `createLibrary` is handed at start, and a `root` that parses but does not
    // reach the library is a server that answers `unconfigured` with a
    // configuration file sitting right there.
    const tmp = realTempDir("mb-config-tolib-");
    const root = join(tmp, "lib");
    mkdirSync(root);
    const file = join(tmp, "config.json");
    writeFileSync(file, JSON.stringify({ root }));

    const config = await loadConfig({ MODEL_BROWSER_CONFIG: file });
    const state = await createLibrary({}, config).state();
    expect(state.state === "ready" && state.top).toBe(root);
  });
});

describe("a deployment that declares an origin", () => {
  it("answers that origin and loopback, and refuses any other", async () => {
    // Its own configuration file rather than the shipped one: this is the
    // guard's rule, and pinning it to the demo's posture would make a change of
    // posture look like a change of behaviour.
    const tmp = realTempDir("mb-config-origin-");
    const env = {
      MODEL_BROWSER_CONFIG: join(tmp, "config.json"),
    } as NodeJS.ProcessEnv;
    writeFileSync(
      env.MODEL_BROWSER_CONFIG as string,
      JSON.stringify({
        origins: ["https://demo.example"],
        features: { thumbWrites: false, appLaunch: false },
      }),
    );
    const config = await loadConfig(env);
    const features: FeatureReport = { ...DEFAULT_FEATURES, ...config.features };
    const app = createApp(
      new ThumbCache(realTempDir("mb-config-origin-cache-")),
      undefined,
      undefined,
      libraryFor(realTempDir("mb-config-origin-lib-")),
      undefined,
      features,
      undefined,
      undefined,
      config.origins ?? [],
    );

    // What the file declares is what the report says.
    expect(
      await (await app.request("/api/features", { headers: LOOPBACK })).json(),
    ).toEqual(features);

    // `/api/library` rather than a listing: the guard runs before every
    // /api/* route alike, and this one asks the filesystem nothing.
    const ask = (headers: Record<string, string>) =>
      app.request("/api/library", { headers });
    expect(
      (await ask({ host: "demo.example", origin: "https://demo.example" }))
        .status,
    ).toBe(200);
    // Loopback is in the set whatever is configured (D8): a health check
    // against the bound port must not be refused by the deployment it checks.
    expect((await ask(LOOPBACK)).status).toBe(200);
    expect(
      (await ask({ host: "demo.example", origin: "https://evil.example" }))
        .status,
    ).toBe(403);
  });
});
