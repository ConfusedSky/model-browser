/**
 * The derived-GLB store (`meshCache.ts`, server-glb-cache D5): hit only while
 * the cache file's mtime matches the source's.
 */

import { describe, expect, it } from "vitest";
import { MeshCache } from "../src/meshCache";
import { realTempDir } from "./helpers";

const glb = new Uint8Array([1, 2, 3, 4]).buffer;

describe("MeshCache", () => {
  it("reads back a written GLB, and only while the mtime matches", async () => {
    const cache = new MeshCache(realTempDir("mb-mesh-"));
    const mtime = 1_700_000_000_000;
    await cache.write("/kit/x.stl", glb, mtime);

    const hit = await cache.read("/kit/x.stl", mtime);
    expect(hit).not.toBeNull();
    expect(new Uint8Array(hit!)).toEqual(new Uint8Array(glb));

    // A different source mtime is a stale entry, reported as a miss.
    expect(await cache.read("/kit/x.stl", mtime + 1000)).toBeNull();
    // A path never written is a miss.
    expect(await cache.read("/kit/other.stl", mtime)).toBeNull();
  });

  it("re-hits after the source is rewritten at the new mtime", async () => {
    const cache = new MeshCache(realTempDir("mb-mesh-"));
    await cache.write("/kit/x.stl", glb, 1000);
    expect(await cache.read("/kit/x.stl", 2000)).toBeNull(); // stale
    await cache.write("/kit/x.stl", glb, 2000);
    expect(await cache.read("/kit/x.stl", 2000)).not.toBeNull();
  });
});
