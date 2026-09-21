/**
 * `GET /api/model.glb` (server-glb-cache): an STL served as an indexed GLB,
 * converted once and cached, for a loose file and a zip entry; non-STL and
 * unreadable/unparseable sources answer as `/api/file`'s failures do.
 */

import { rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { ThumbCache } from "../src/cache";
import { MeshCache } from "../src/meshCache";
import { LOOPBACK, libraryFor, makeFixtures, realTempDir } from "./helpers";

const fx = makeFixtures();
// A file that parses as neither binary nor ASCII STL.
writeFileSync(join(fx.dir, "bad.stl"), "this is not an stl file");

function appWith(meshCache?: MeshCache) {
  const dir = realTempDir("mb-glb-cache-");
  const lib = libraryFor(fx.dir);
  const cache = new ThumbCache(dir, undefined, undefined, lib);
  const mc = meshCache ?? new MeshCache(dir, lib);
  const app = createApp(
    cache,
    undefined,
    undefined,
    lib,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mc,
  );
  return { app, mc };
}

function get(app: ReturnType<typeof appWith>["app"], path: string) {
  return app.request(path, { headers: LOOPBACK });
}

function isGlb(bytes: ArrayBuffer): boolean {
  return (
    bytes.byteLength >= 4 &&
    new DataView(bytes).getUint32(0, true) === 0x46546c67
  );
}

describe("GET /api/model.glb", () => {
  it("serves an STL as GLB and converts only on the miss", async () => {
    const { app, mc } = appWith();
    const write = vi.spyOn(mc, "write");

    const first = await get(app, "/api/model.glb?path=/loose.stl");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = await first.arrayBuffer();
    expect(isGlb(bytes)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);

    const second = await get(app, "/api/model.glb?path=/loose.stl");
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(
      new Uint8Array(bytes),
    );
    // A hit does not reconvert.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("serves an STL zip entry as GLB, and a hit never reopens the zip", async () => {
    const { app, mc } = appWith();
    const write = vi.spyOn(mc, "write");
    const url = `/api/model.glb?path=${encodeURIComponent("/models.zip!/box.stl")}`;
    const res = await get(app, url);
    expect(res.status).toBe(200);
    expect(isGlb(await res.arrayBuffer())).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    // `write` runs only after an extract + convert, so one write across two
    // requests is the hit path skipping the archive.
    expect((await get(app, url)).status).toBe(200);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for a non-STL path", async () => {
    const { app } = appWith();
    expect((await get(app, "/api/model.glb?path=/model.obj")).status).toBe(404);
    expect((await get(app, "/api/model.glb?path=/notes.txt")).status).toBe(404);
  });

  it("answers 404 for a deleted source and 422 for an unparseable one", async () => {
    const { app } = appWith();
    expect((await get(app, "/api/model.glb?path=/gone.stl")).status).toBe(404);
    expect((await get(app, "/api/model.glb?path=/bad.stl")).status).toBe(422);
  });

  it("serves without persisting when the cache dir is unwritable", async () => {
    // A cache dir under a regular file: mkdir fails with ENOTDIR, root or not.
    const ro = new MeshCache(join(fx.dir, "notes.txt", "nope"));
    const { app } = appWith(ro);
    const res = await get(app, "/api/model.glb?path=/loose.stl");
    expect(res.status).toBe(200);
    expect(isGlb(await res.arrayBuffer())).toBe(true);
  });
});

/**
 * `byte-route-cache-headers`: the GLB route's half. The version is the **source
 * STL's** — the archive's for a zip entry — so the tag moves exactly when the
 * cached GLB goes stale, and never names the converted body.
 */
describe("model byte cacheability (/api/model.glb)", () => {
  const stl = statSync(join(fx.dir, "loose.stl"));
  const zip = statSync(fx.zipPath);
  const tagFor = (s: { mtimeMs: number; size: number }) =>
    `"${s.mtimeMs}-${s.size}"`;

  function getWith(
    app: ReturnType<typeof appWith>["app"],
    path: string,
    headers: Record<string, string>,
  ) {
    return app.request(path, { headers: { ...LOOPBACK, ...headers } });
  }

  it("declares the three tiers over the source STL's mtime", async () => {
    const { app } = appWith();

    const pinned = await get(
      app,
      `/api/model.glb?path=/loose.stl&mtime=${stl.mtimeMs}`,
    );
    expect(pinned.status).toBe(200);
    expect(pinned.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(pinned.headers.get("etag")).toBe(tagFor(stl));
    const bytes = new Uint8Array(await pinned.arrayBuffer());
    expect(isGlb(bytes.buffer)).toBe(true);

    // A version the source no longer has degrades the directive and keeps the tag: a
    // listing blind to an overwrite (issue #34) can leave a caller here indefinitely,
    // and a revalidation is what stops that being a download every time (D3).
    const stale = await get(
      app,
      `/api/model.glb?path=/loose.stl&mtime=${stl.mtimeMs - 1000}`,
    );
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("no-cache");
    expect(new Uint8Array(await stale.arrayBuffer())).toEqual(bytes);

    const plain = await get(app, "/api/model.glb?path=/loose.stl");
    expect(plain.status).toBe(200);
    expect(plain.headers.get("cache-control")).toBe("no-cache");
    expect(new Uint8Array(await plain.arrayBuffer())).toEqual(bytes);

    // One representation, one validator: all three tiers' tags are the same bytes, so
    // the directive is the only thing that moves between them.
    expect([
      pinned.headers.get("etag"),
      stale.headers.get("etag"),
      plain.headers.get("etag"),
    ]).toEqual([tagFor(stl), tagFor(stl), tagFor(stl)]);
  });

  it("keys a zip entry by the archive, not by the entry", async () => {
    const { app } = appWith();
    const url = `/api/model.glb?path=${encodeURIComponent("/models.zip!/box.stl")}`;

    const pinned = await get(app, `${url}&mtime=${zip.mtimeMs}`);
    expect(pinned.status).toBe(200);
    expect(pinned.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(pinned.headers.get("etag")).toBe(tagFor(zip));
    // Both components are the archive's: the entry's own size never appears.
    expect(pinned.headers.get("etag")).not.toBe(
      `"${zip.mtimeMs}-${fx.boxStl.length}"`,
    );
    expect(isGlb(await pinned.arrayBuffer())).toBe(true);

    const stale = await get(app, `${url}&mtime=${zip.mtimeMs - 1000}`);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("no-cache");
    expect(stale.headers.get("etag")).toBe(tagFor(zip));

    const plain = await get(app, url);
    expect(plain.headers.get("cache-control")).toBe("no-cache");
    expect(plain.headers.get("etag")).toBe(tagFor(zip));
  });

  it("answers a zip entry's own validator with a 304, converting nothing", async () => {
    const dir = realTempDir("mb-glb-zip-304-");
    const { app, mc } = appWith(new MeshCache(dir, libraryFor(fx.dir)));
    const write = vi.spyOn(mc, "write");
    const url = `/api/model.glb?path=${encodeURIComponent("/models.zip!/box.stl")}`;

    expect((await get(app, url)).status).toBe(200);
    expect(write).toHaveBeenCalledTimes(1);
    // Drop the cached GLB, so a 304 that never happened is a miss — and a miss on
    // this branch re-extracts the entry and reconverts it.
    rmSync(dir, { recursive: true, force: true });

    const res = await getWith(app, url, { "if-none-match": tagFor(zip) });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(tagFor(zip));
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("answers its own 404s no-store, with no validator", async () => {
    const { app } = appWith();

    const nonStl = await get(app, "/api/model.glb?path=/notes.txt");
    expect(nonStl.status).toBe(404);
    expect(nonStl.headers.get("cache-control")).toBe("no-store");
    expect(nonStl.headers.get("etag")).toBeNull();

    const missing = await get(app, "/api/model.glb?path=/gone.stl");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(missing.headers.get("etag")).toBeNull();
  });

  it("answers an unconvertible source no-store, with no validator", async () => {
    const { app } = appWith();
    // The *current* version on purpose: that is the tier carrying a tag, and it is
    // decided before `stlToGlb` throws. A stray validator is all this can catch —
    // the handler's own `no-store` would replace a staged directive either way.
    const bad = statSync(join(fx.dir, "bad.stl"));
    const res = await get(
      app,
      `/api/model.glb?path=/bad.stl&mtime=${bad.mtimeMs}`,
    );
    expect(res.status).toBe(422);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
  });

  it("answers a matching validator 304 without reconverting", async () => {
    const dir = realTempDir("mb-glb-304-");
    const { app, mc } = appWith(new MeshCache(dir, libraryFor(fx.dir)));
    const write = vi.spyOn(mc, "write");

    const first = await get(app, "/api/model.glb?path=/loose.stl");
    expect(first.status).toBe(200);
    const tag = first.headers.get("etag");
    expect(tag).toBe(tagFor(stl));
    expect(write).toHaveBeenCalledTimes(1);

    // Drop the cached GLB, so a 304 that never happened would be a *miss* and
    // convert a second time rather than being hidden by a live entry.
    rmSync(dir, { recursive: true, force: true });

    const second = await getWith(app, "/api/model.glb?path=/loose.stl", {
      "if-none-match": tag ?? "",
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("honours a matching validator alongside the current version", async () => {
    const { app } = appWith();
    const tag = (await get(app, "/api/model.glb?path=/loose.stl")).headers.get(
      "etag",
    );
    expect(tag).toBe(tagFor(stl));

    const res = await getWith(
      app,
      `/api/model.glb?path=/loose.stl&mtime=${stl.mtimeMs}`,
      { "if-none-match": tag ?? "" },
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("etag")).toBe(tag);
  });

  it("honours a matching validator alongside a stale version", async () => {
    const { app } = appWith();
    const tag = (await get(app, "/api/model.glb?path=/loose.stl")).headers.get(
      "etag",
    );

    // The tag matches the source's current version, which is what the rule turns
    // on, whatever the request claimed.
    const res = await getWith(
      app,
      `/api/model.glb?path=/loose.stl&mtime=${stl.mtimeMs - 1000}`,
      { "if-none-match": tag ?? "" },
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });
});

describe("ThumbCache.maintain leaves mesh/ alone", () => {
  const dir = realTempDir("mb-mesh-sweep-");
  const lib = libraryFor(fx.dir);
  // A tiny cap so maintain runs its full sweep.
  const cache = new ThumbCache(dir, 1, 1, lib);
  const mesh = new MeshCache(dir, lib);

  afterAll(() => vi.restoreAllMocks());

  it("keeps a cached GLB across a maintain sweep", async () => {
    await mesh.write("/kit/x.stl", new Uint8Array([9, 9, 9, 9]).buffer, 1000);
    await cache.maintain();
    expect(await mesh.read("/kit/x.stl", 1000)).not.toBeNull();
  });
});
