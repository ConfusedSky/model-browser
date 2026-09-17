/**
 * The STL→GLB converter and its matched reader (`shared/glb.ts`,
 * server-glb-cache D3/D4). Both halves are pure and DOM-free, so they run here
 * under vitest; the client render-parity cell lives in client/test.
 */

import { describe, expect, it } from "vitest";
import { GlbError, readGlb, stlToGlb } from "../../shared/glb";

/** Binary STL of the given triangles; each triangle is nine coords (three
 *  vertices). The facet-normal field is left zero — the pipeline ignores it. */
function binaryStl(triangles: number[][]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50 * triangles.length);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => {
    let p = 84 + i * 50 + 12; // skip the normal
    for (let k = 0; k < 9; k++, p += 4) view.setFloat32(p, t[k]!, true);
  });
  return buf;
}

/** ASCII STL of the same triangles, integer coords so each parses to the exact
 *  float32 the binary form stored. */
function asciiStl(triangles: number[][]): ArrayBuffer {
  let s = "solid test\n";
  for (const t of triangles) {
    s += "facet normal 0 0 0\nouter loop\n";
    for (let k = 0; k < 9; k += 3)
      s += `vertex ${t[k]!} ${t[k + 1]!} ${t[k + 2]!}\n`;
    s += "endloop\nendfacet\n";
  }
  s += "endsolid test\n";
  return new TextEncoder().encode(s).buffer;
}

/** A triangle fan: apex plus a rim, so the welded vertex count is exactly
 *  `T + 2` — the only shape that hits an arbitrary count on the nose. */
function fan(triangleCount: number): number[][] {
  const apex = [0, 0, 0];
  const tris: number[][] = [];
  for (let i = 0; i < triangleCount; i++) {
    // Rim vertices r_i, r_{i+1}, distinct and float32-exact.
    const a = [i + 1, 0, 1];
    const b = [i + 2, 0, 1];
    tris.push([...apex, ...a, ...b]);
  }
  return tris;
}

/** Every original vertex is reproduced bit-for-bit through the index. */
function expectVerticesReproduced(
  triangles: number[][],
  positions: Float32Array,
  index: Uint16Array | Uint32Array,
): void {
  triangles.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const vi = index[ti * 3 + k]!;
      expect(positions[vi * 3]).toBe(Math.fround(t[k * 3]!));
      expect(positions[vi * 3 + 1]).toBe(Math.fround(t[k * 3 + 1]!));
      expect(positions[vi * 3 + 2]).toBe(Math.fround(t[k * 3 + 2]!));
    }
  });
}

// A quad from two triangles sharing an edge: 6 input vertices, 4 welded.
const quad: number[][] = [
  [0, 0, 0, 1, 0, 0, 1, 1, 0],
  [0, 0, 0, 1, 1, 0, 0, 1, 0],
];

describe("stlToGlb", () => {
  it("converts binary and ASCII of the same triangles to byte-identical GLB", () => {
    const fromBinary = stlToGlb(binaryStl(quad));
    const fromAscii = stlToGlb(asciiStl(quad));
    expect(new Uint8Array(fromAscii)).toEqual(new Uint8Array(fromBinary));
  });

  it("writes a valid GLB container", () => {
    const glb = stlToGlb(binaryStl(quad));
    const view = new DataView(glb);
    expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(view.getUint32(4, true)).toBe(2); // version
    expect(view.getUint32(8, true)).toBe(glb.byteLength); // total length
    // 12-byte header + JSON chunk (8 + len) + BIN chunk (8 + len) = total.
    const jsonLen = view.getUint32(12, true);
    const binLen = view.getUint32(20 + jsonLen, true);
    expect(12 + 8 + jsonLen + 8 + binLen).toBe(glb.byteLength);
  });

  it("welds shared corners and never moves a coordinate", () => {
    const glb = stlToGlb(binaryStl(quad));
    const { positions, index } = readGlb(glb);
    expect(positions.length / 3).toBeLessThan(quad.length * 3); // < 6 verts
    expect(positions.length / 3).toBe(4);
    // Every original vertex position is reproduced bit-for-bit through the index.
    expectVerticesReproduced(quad, positions, index);
  });

  it("round-trips positions and triangle order through readGlb", () => {
    const tris = fan(10);
    const { positions, index } = readGlb(stlToGlb(binaryStl(tris)));
    expect(index.length).toBe(tris.length * 3);
    expectVerticesReproduced(tris, positions, index);
  });

  it("picks the index width at count <= 65536, not <", () => {
    // fan(T) welds to exactly T + 2 vertices.
    const u16 = readGlb(stlToGlb(binaryStl(fan(65534)))); // 65536 verts
    expect(u16.index).toBeInstanceOf(Uint16Array);
    const u32 = readGlb(stlToGlb(binaryStl(fan(65535)))); // 65537 verts
    expect(u32.index).toBeInstanceOf(Uint32Array);
  });

  it("parses a binary STL padded past its face count, as STLLoader does", () => {
    const padded = new Uint8Array(84 + 50 * quad.length + 2);
    padded.set(new Uint8Array(binaryStl(quad)));
    const { index } = readGlb(stlToGlb(padded.buffer));
    expect(index.length).toBe(quad.length * 3);
  });

  it("parses a binary STL whose header happens to start with 'solid'", () => {
    const buf = binaryStl(quad);
    new Uint8Array(buf).set(new TextEncoder().encode("solid "), 0);
    expect(readGlb(stlToGlb(buf)).index.length).toBe(quad.length * 3);
  });

  it("rejects an ASCII coordinate that is not a number", () => {
    const bad = new TextEncoder().encode(
      "solid x\nfacet normal 0 0 0\nouter loop\nvertex a b c\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n",
    ).buffer;
    expect(() => stlToGlb(bad)).toThrow(GlbError);
  });

  it("throws on empty, truncated, and non-STL bytes", () => {
    expect(() => stlToGlb(new ArrayBuffer(0))).toThrow(GlbError);
    // A binary header claiming two faces but carrying one triangle's bytes.
    const truncated = binaryStl([quad[0]!]);
    new DataView(truncated).setUint32(80, 2, true);
    expect(() => stlToGlb(truncated)).toThrow(GlbError);
    expect(() =>
      stlToGlb(new TextEncoder().encode("not an stl").buffer),
    ).toThrow(GlbError);
    // Long enough to reach the binary branch, no `solid`, header claims more
    // facets than the bytes hold.
    const lying = new Uint8Array(100);
    new DataView(lying.buffer).setUint32(80, 5, true);
    expect(() => stlToGlb(lying.buffer)).toThrow(GlbError);
  });
});

describe("readGlb", () => {
  it("throws GlbError, not RangeError, on a GLB cut short", () => {
    const glb = stlToGlb(binaryStl(quad));
    const view = new DataView(glb);
    const jsonLen = view.getUint32(12, true);
    // Keep the header, JSON and BIN chunk header; drop half the BIN payload.
    const cut = glb.slice(0, 20 + jsonLen + 8 + 8);
    expect(() => readGlb(cut)).toThrow(GlbError);
    // Cut inside the JSON chunk itself.
    expect(() => readGlb(glb.slice(0, 20 + jsonLen - 4))).toThrow(GlbError);
  });
});
