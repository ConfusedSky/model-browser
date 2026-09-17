/**
 * The `MeshLru` loader routes STL geometry through the derived-GLB endpoint and
 * every other format through the raw file (server-glb-cache D7).
 */

import { describe, expect, it, vi } from "vitest";
import { stlToGlb } from "../../shared/glb";
import { meshLoader } from "../src/three/meshLoader";

/** A one-facet binary STL, valid input for `stlToGlb`. */
function tinyStl(): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50);
  const dv = new DataView(buf);
  dv.setUint32(80, 1, true);
  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) =>
    dv.setFloat32(84 + i * 4, v, true),
  );
  return buf;
}

function stubApi() {
  return {
    fetchModel: vi.fn(async () => tinyStl()),
    fetchModelGlb: vi.fn(async () => stlToGlb(tinyStl())),
  };
}

const placeholderRef = { current: () => {} };

describe("meshLoader", () => {
  it("loads an STL through fetchModelGlb and never fetchModel", async () => {
    const api = stubApi();
    const load = meshLoader(api, placeholderRef);
    const { object } = await load("/kit/part.stl");
    expect(api.fetchModelGlb).toHaveBeenCalledWith("/kit/part.stl");
    expect(api.fetchModel).not.toHaveBeenCalled();
    expect(object).toBeTruthy();
  });

  it("loads a 3MF through fetchModel", async () => {
    const api = stubApi();
    // A 3MF is a zip; an empty one parses to an empty group, which is enough
    // to prove the route taken.
    api.fetchModel.mockResolvedValueOnce(emptyZip());
    const load = meshLoader(api, placeholderRef);
    // Parsing an empty 3MF may throw; the route taken is what this asserts, and
    // the fetch happens before any parse.
    await load("/kit/part.3mf").catch(() => {});
    expect(api.fetchModel).toHaveBeenCalledWith("/kit/part.3mf");
    expect(api.fetchModelGlb).not.toHaveBeenCalled();
  });
});

/** A minimal empty zip (end-of-central-directory record only). */
function emptyZip(): ArrayBuffer {
  return new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])
    .buffer;
}
