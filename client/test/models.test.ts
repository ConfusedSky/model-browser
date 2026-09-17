import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DirEntry } from "../../shared/types";
import { stlToGlb } from "../../shared/glb";
import { defaultAxisFor } from "../../shared/frames";
import {
  formatOf,
  formatOfEntry,
  geometryBytes,
  parseModel,
} from "../src/three/models";

type V3 = [number, number, number];

/** Binary STL: 80-byte header, uint32 count, 50 bytes per facet. */
function stlBytes(facets: [V3, V3, V3][]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50 * facets.length);
  const view = new DataView(buffer);
  view.setUint32(80, facets.length, true);
  facets.forEach((tri, f) => {
    const floats = [0, 0, 0, ...tri[0], ...tri[1], ...tri[2]];
    floats.forEach((x, i) => view.setFloat32(84 + f * 50 + i * 4, x, true));
  });
  return buffer;
}

const ONE_TRIANGLE: [V3, V3, V3][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
];

/** Two facets whose extents are X 1, Y 2, Z 3 — distinguishable under any axis swap. */
const EXTENTS_123: [V3, V3, V3][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
  ],
  [
    [0, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ],
];

describe("parseModel", () => {
  it("gives every mesh both shadow flags, so models self-shadow (D2)", () => {
    const object = parseModel(stlBytes(ONE_TRIANGLE), "stl");
    const meshes: THREE.Mesh[] = [];
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes.map((m) => [m.castShadow, m.receiveShadow])).toEqual([
      [true, true],
    ]);
  });

  it("renders an STL in its file's coordinates: the parsed bounding box is the file's", () => {
    // file-frame-spindle: no rotation at parse time. Under the retired
    // rotateX(−π/2) bake the max would read (1, 3, 0) and the min (0, 0, −2).
    const object = parseModel(stlBytes(EXTENTS_123), "stl");
    const box = new THREE.Box3().setFromObject(object);
    expect(box.min.toArray()).toEqual([0, 0, 0]);
    expect(box.max.toArray()).toEqual([1, 2, 3]);
  });
});

/** The one mesh's position and normal attribute arrays. */
function attrs(object: THREE.Object3D): {
  position: Float32Array;
  normal: Float32Array;
} {
  let mesh: THREE.Mesh | null = null;
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) mesh = o;
  });
  const g = (mesh as unknown as THREE.Mesh).geometry as THREE.BufferGeometry;
  return {
    position: g.getAttribute("position").array as Float32Array,
    normal: g.getAttribute("normal").array as Float32Array,
  };
}

/** ASCII STL of the same facets, integer coords so each parses to the exact
 *  float32 the binary form stores. */
function asciiStl(facets: [V3, V3, V3][]): ArrayBuffer {
  let s = "solid t\n";
  for (const tri of facets) {
    s += "facet normal 0 0 0\nouter loop\n";
    for (const v of tri) s += `vertex ${v[0]} ${v[1]} ${v[2]}\n`;
    s += "endloop\nendfacet\n";
  }
  s += "endsolid t\n";
  return new TextEncoder().encode(s).buffer;
}

describe("parseModel glb arm matches the stl arm", () => {
  // The ASCII cell pins that the converter's ASCII triangle order matches
  // STLLoader's, which the binary cell alone cannot.
  for (const [label, make] of [
    ["binary", stlBytes],
    ["ascii", asciiStl],
  ] as const) {
    it(`${label} STL served as GLB shades identically`, () => {
      // Each form's reference is STLLoader's own parse of *that* form, so the
      // ASCII cell runs STLLoader's ASCII path against the converter's.
      const direct = parseModel(make(EXTENTS_123), "stl");
      const viaGlb = parseModel(stlToGlb(make(EXTENTS_123)), "glb");
      const a = attrs(direct);
      const b = attrs(viaGlb);
      expect(Array.from(b.position)).toEqual(Array.from(a.position));
      expect(Array.from(b.normal)).toEqual(Array.from(a.normal));
      expect(geometryBytes(viaGlb)).toBe(geometryBytes(direct));
    });
  }
});

describe("STL stays an STL for classification despite GLB delivery", () => {
  it("keeps its format and its default spindle", () => {
    // GLB is only the wire form; the model is still `.stl` everywhere else.
    expect(formatOf("/kit/part.stl")).toBe("stl");
    expect(defaultAxisFor("stl")).toBe("z");
  });
});

describe("formatOfEntry", () => {
  const entry = (path: string, format?: DirEntry["format"]): DirEntry => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    kind: "model",
    size: 1,
    mtime: 0,
    ...(format === undefined ? {} : { format }),
  });

  it("resolves from the wire field when the listing carried it", () => {
    expect(formatOfEntry(entry("/kit/part.stl", "obj"))).toBe("obj");
  });

  it("resolves from the path when the field is absent", () => {
    expect(formatOfEntry(entry("/kit/part.3MF"))).toBe("3mf");
    expect(formatOfEntry(entry("/kit/inner.zip!/part.stl"))).toBe("stl");
  });

  it("throws, naming the path, when neither classifies — never a default", () => {
    expect(() => formatOfEntry(entry("/kit/notes.txt"))).toThrow(
      "not a model: /kit/notes.txt",
    );
  });
});
