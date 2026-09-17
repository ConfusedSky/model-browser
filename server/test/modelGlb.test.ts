/**
 * `GET /api/model.glb` (server-glb-cache): an STL served as an indexed GLB,
 * converted once and cached, for a loose file and a zip entry; non-STL and
 * unreadable/unparseable sources answer as `/api/file`'s failures do.
 */

import { writeFileSync } from "node:fs";
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

  it("serves an STL zip entry as GLB", async () => {
    const { app } = appWith();
    const res = await get(
      app,
      `/api/model.glb?path=${encodeURIComponent("/models.zip!/box.stl")}`,
    );
    expect(res.status).toBe(200);
    expect(isGlb(await res.arrayBuffer())).toBe(true);
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
