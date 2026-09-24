import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { ThumbCache } from "../src/cache";
import { resetIndexStatus } from "../src/semantic";
import { LOOPBACK, libraryFor, makeFixtures, realTempDir } from "./helpers";

/**
 * The same-origin guard once it can be told its origins (`public-deployment`
 * D3, task 7.2).
 *
 * The first block pins what the guard allows with no origins configured:
 * loopback in every spelling it accepts — the two literal addresses,
 * `localhost` and any name under it, in any case — and nothing else. Every
 * edge of that set has a cell here, so widening it further fails this block.
 * The second block is what configuring an origin adds, and the cells inside it
 * are as much about what it must *not* add.
 *
 * `/api/dir` is the route; since `listing-tree-cache` §6.9 that means the index
 * gets probed, so `fetch` is stubbed refused (absent index = the plain walk)
 * rather than left to whatever is on :8077.
 */
const fx = makeFixtures();
const cacheDir = realTempDir("mb-guard-cache-");

afterAll(() => {
  rmSync(fx.dir, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
  );
  resetIndexStatus();
});

const library = libraryFor(fx.dir);
const unconfigured = createApp(
  new ThumbCache(cacheDir),
  undefined,
  undefined,
  library,
);
/** The demo's shape: one public origin, and loopback besides it. */
const configured = createApp(
  new ThumbCache(cacheDir),
  undefined,
  undefined,
  library,
  undefined,
  undefined,
  undefined,
  undefined,
  ["https://models.masamaeda.com"],
);

const ask = (app: typeof unconfigured, headers: Record<string, string>) =>
  app.request("/api/dir?path=/", { headers });

describe("the unconfigured guard allows loopback and nothing else", () => {
  it("refuses cross-origin requests", async () => {
    const res = await ask(unconfigured, {
      ...LOOPBACK,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden origin" });
  });

  it("refuses non-loopback Host (DNS rebinding)", async () => {
    const res = await ask(unconfigured, {
      host: "evil.example",
      origin: "http://localhost:5173",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden host" });
  });

  it("allows loopback origins and emits no CORS headers", async () => {
    const res = await ask(unconfigured, {
      ...LOOPBACK,
      origin: "http://localhost:5173",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows an absent Origin, and refuses an absent Host", async () => {
    // Absent Origin passes by design (curl, tests, same-origin GETs); rebinding
    // without one is what the Host check catches.
    expect((await ask(unconfigured, LOOPBACK)).status).toBe(200);
    expect((await ask(unconfigured, { host: "[::1]:3177" })).status).toBe(200);
    expect((await ask(unconfigured, {})).status).toBe(403);
  });

  it("allows a .localhost name nothing configures", async () => {
    // The reserved TLD is loopback whatever the label, and however many: the
    // name resolves to this machine without ever reaching DNS.
    for (const name of ["evil.localhost:5173", "a.b.localhost:5173"]) {
      const res = await ask(unconfigured, {
        host: name,
        origin: `http://${name}`,
      });
      expect(res.status, name).toBe(200);
    }
  });

  it("refuses names that only look like localhost", async () => {
    // The anchors, not the label class: `$` means the name must end at
    // `localhost`, and reaching the word needs a dot or the start of the
    // string before it.
    for (const host of ["localhost.evil.com", "notlocalhost"]) {
      const byHost = await ask(unconfigured, {
        host,
        origin: "http://localhost:5173",
      });
      expect(byHost.status, host).toBe(403);
      expect(await byHost.json()).toEqual({ error: "forbidden host" });

      const byOrigin = await ask(unconfigured, {
        ...LOOPBACK,
        origin: `http://${host}`,
      });
      expect(byOrigin.status, host).toBe(403);
      expect(await byOrigin.json()).toEqual({ error: "forbidden origin" });
    }
  });

  // D3, split in two so each pattern's `i` is falsifiable on its own: a proxy
  // or a hand-written request is where mixed case comes from, since browsers
  // lowercase the host before sending either header.
  it("reads a mixed-case .localhost Host as loopback", async () => {
    expect(
      (await ask(unconfigured, { host: "Build-A.localhost:5173" })).status,
    ).toBe(200);
  });

  it("reads a mixed-case .localhost Origin as loopback", async () => {
    expect(
      (
        await ask(unconfigured, {
          ...LOOPBACK,
          origin: "http://Build-A.localhost:5173",
        })
      ).status,
    ).toBe(200);
  });

  it("refuses the origin a configured deployment would allow", async () => {
    // The control for the block below: nothing about the public origin is
    // special until it is configured, so the 200s there are the configuration's
    // doing and not the request's.
    const res = await ask(unconfigured, {
      host: "models.masamaeda.com",
      origin: "https://models.masamaeda.com",
    });
    expect(res.status).toBe(403);
  });
});

describe("a configured origin", () => {
  it("is allowed, by Origin and by the Host that names it", async () => {
    expect(
      (
        await ask(configured, {
          host: "models.masamaeda.com",
          origin: "https://models.masamaeda.com",
        })
      ).status,
    ).toBe(200);
    // A reverse proxy may pass the scheme's default port; both spellings name
    // the same origin.
    expect(
      (
        await ask(configured, {
          host: "models.masamaeda.com:443",
          origin: "https://models.masamaeda.com",
        })
      ).status,
    ).toBe(200);
    // Case in the header is not a difference.
    expect(
      (
        await ask(configured, {
          host: "Models.MasaMaeda.com",
          origin: "https://Models.MasaMaeda.com",
        })
      ).status,
    ).toBe(200);
  });

  it("keeps loopback allowed besides, so the machine can ask itself", async () => {
    // D8: a health check against the bound port must not be refused by the
    // deployment it is checking, and a reverse proxy rewriting `Host` is the
    // case a local curl cannot simulate.
    expect((await ask(configured, LOOPBACK)).status).toBe(200);
    expect(
      (await ask(configured, { ...LOOPBACK, origin: "http://localhost:5173" }))
        .status,
    ).toBe(200);
    expect(
      (await ask(configured, { host: "build-a.localhost:5173" })).status,
    ).toBe(200);
  });

  it("refuses another public origin", async () => {
    const res = await ask(configured, {
      host: "models.masamaeda.com",
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden origin" });
  });

  it("refuses a Host it does not answer to", async () => {
    // Including two near misses: a suffix of the configured name and a name it
    // is a suffix of. The check is equality, not containment.
    for (const host of [
      "evil.example",
      "models.masamaeda.com.evil.example",
      "masamaeda.com",
    ]) {
      const res = await ask(configured, {
        host,
        origin: "https://models.masamaeda.com",
      });
      expect(res.status, host).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden host" });
    }
    // And a different port on the right name, since the configured origin named
    // none and so means the scheme's default.
    expect(
      (
        await ask(configured, {
          host: "models.masamaeda.com:8443",
          origin: "https://models.masamaeda.com",
        })
      ).status,
    ).toBe(403);
  });

  it("refuses the same name under the wrong scheme", async () => {
    const res = await ask(configured, {
      host: "models.masamaeda.com",
      origin: "http://models.masamaeda.com",
    });
    expect(res.status).toBe(403);
  });

  it("answers two configured names, each by Origin and by Host, and no third", async () => {
    // The applied scenario *A deployment answering two names* (9.11f): a
    // deployment reached at an apex and a `www`, or during a rename, is one
    // server with two origins — `origins` is a list, and the guard's answer
    // must not depend on which entry is first.
    const twoNames = createApp(
      new ThumbCache(cacheDir),
      undefined,
      undefined,
      library,
      undefined,
      undefined,
      undefined,
      undefined,
      ["https://models.masamaeda.com", "https://www.models.masamaeda.com"],
    );
    for (const name of ["models.masamaeda.com", "www.models.masamaeda.com"]) {
      expect(
        (await ask(twoNames, { host: name, origin: `https://${name}` })).status,
        name,
      ).toBe(200);
      // Each name answers on its own too: a Host with no Origin at all (a
      // proxy's health check, a curl) and an Origin whose Host is the *other*
      // configured name, which is still a request this deployment answers.
      expect((await ask(twoNames, { host: name })).status, name).toBe(200);
    }
    expect(
      (
        await ask(twoNames, {
          host: "models.masamaeda.com",
          origin: "https://www.models.masamaeda.com",
        })
      ).status,
    ).toBe(200);
    // And a third name is refused by either header, so admitting two is not
    // admitting any.
    expect(
      (
        await ask(twoNames, {
          host: "models.masamaeda.com",
          origin: "https://other.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await ask(twoNames, {
          host: "other.example",
          origin: "https://models.masamaeda.com",
        })
      ).status,
    ).toBe(403);
  });

  it("never emits a CORS header, on any of these answers", async () => {
    for (const headers of [
      LOOPBACK,
      { host: "models.masamaeda.com", origin: "https://models.masamaeda.com" },
      { host: "models.masamaeda.com", origin: "https://evil.example" },
      { host: "evil.example", origin: "https://models.masamaeda.com" },
    ]) {
      const res = await ask(configured, headers);
      for (const [name] of res.headers) {
        expect(name.toLowerCase().startsWith("access-control-"), name).toBe(
          false,
        );
      }
    }
  });
});
