import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { unzipSync } from "fflate";
import { readGlb } from "../../../shared/glb";
import type { DirEntry, ModelFormat } from "../../../shared/types";

export type { ModelFormat } from "../../../shared/types";

export function formatOf(path: string): ModelFormat | null {
  const m = /\.(stl|3mf|obj)$/i.exec(path);
  return m ? (m[1]!.toLowerCase() as ModelFormat) : null;
}

/** **Throws, never defaults**: the server assigns `kind: 'model'` through the
 *  same three extensions, so an unclassifiable model entry is a programming
 *  error on the wire and a default would hide it (D2). */
export function formatOfEntry(entry: DirEntry): ModelFormat {
  const format = entry.format ?? formatOf(entry.path);
  if (format === null) throw new Error(`not a model: ${entry.path}`);
  return format;
}

function makeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x9aa4b2,
    metalness: 0.1,
    roughness: 0.75,
  });
}

/** So a model self-shadows under the key light and takes its own shadow on the
 *  contact floor (D2). */
function withShadows<T extends THREE.Object3D>(object: T): T {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return object;
}

/** **No rotation is applied to any format here**: models render in their file's
 *  own coordinates, and a model stands upright because its spindle defaults to
 *  its format's up convention (`defaultAxisFor`, shared/frames.ts). */
export function parseModel(
  bytes: ArrayBuffer,
  format: ModelFormat | "glb",
): THREE.Object3D {
  if (format === "stl") {
    const geometry = new STLLoader().parse(bytes);
    // **Shade from winding, always** (D1): the spec makes it authoritative,
    // and files exist whose normal field is zeroed, stale, or rotated into
    // another up-axis convention than the vertices.
    geometry.deleteAttribute("normal");
    geometry.computeVertexNormals();
    return withShadows(new THREE.Mesh(geometry, makeMaterial()));
  }
  if (format === "glb") {
    // The server's derived STL delivery (server-glb-cache): positions and
    // indices only. De-indexing and recomputing winding normals gives the same
    // geometry the `stl` arm produces, so the pixels match by construction.
    const { positions, index } = readGlb(bytes);
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    indexed.setIndex(new THREE.BufferAttribute(index, 1));
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    return withShadows(new THREE.Mesh(geometry, makeMaterial()));
  }
  if (format === "obj") {
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes));
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = makeMaterial();
    });
    return withShadows(group);
  }
  const group = new ThreeMFLoader().parse(bytes);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = makeMaterial();
  });
  return withShadows(group);
}

/** The LRU's accounting unit. */
export function geometryBytes(object: THREE.Object3D): number {
  let bytes = 0;
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      for (const attr of Object.values(g.attributes)) {
        bytes += (attr as THREE.BufferAttribute).array.byteLength;
      }
      if (g.index !== null) bytes += g.index.array.byteLength;
    }
  });
  return bytes;
}

/** **Must be called on LRU eviction**: three.js tracks GPU buffers in a
 *  WeakMap, so dropping the reference frees heap but leaks VRAM. */
export function disposeModel(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      (o.geometry as THREE.BufferGeometry).dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}

/** Embedded 3MF preview (`/Metadata/thumbnail.png`) as an object URL, if present. */
export function embedded3mfThumbnail(bytes: ArrayBuffer): string | null {
  try {
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => /^\/?Metadata\/thumbnail\.png$/i.test(f.name),
    });
    const png = Object.values(files)[0];
    if (png === undefined) return null;
    return URL.createObjectURL(
      new Blob([new Uint8Array(png)], { type: "image/png" }),
    );
  } catch {
    return null;
  }
}
