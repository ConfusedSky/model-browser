import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { unzipSync } from 'fflate'
import type { DirEntry, ModelFormat } from '../../../shared/types'

export type { ModelFormat } from '../../../shared/types'

export function formatOf(path: string): ModelFormat | null {
  const m = /\.(stl|3mf|obj)$/i.exec(path)
  return m ? (m[1]!.toLowerCase() as ModelFormat) : null
}

/**
 * A model entry's format, from the wire field when the listing carried it and
 * from the path otherwise. Throws, never defaults, when neither classifies:
 * the server assigns `kind: 'model'` only through the same three extensions
 * `formatOf` matches (`MODEL_EXT`, server/src/listing.ts), so a model entry
 * with an unclassifiable path is a programming error on the wire, and a silent
 * default would be exactly the hidden convention `file-frame-spindle` removed
 * (D2).
 */
export function formatOfEntry(entry: DirEntry): ModelFormat {
  const format = entry.format ?? formatOf(entry.path)
  if (format === null) throw new Error(`not a model: ${entry.path}`)
  return format
}

function makeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.75 })
}

/**
 * Every mesh both casts and receives, so a model self-shadows under the key
 * light (D2) and takes its own shadow on the contact floor.
 */
function withShadows<T extends THREE.Object3D>(object: T): T {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return object
}

/**
 * Parse model bytes into an Object3D with consistent materials.
 *
 * Models render in their file's own coordinates: no rotation is applied to
 * any format here. A model stands upright because its spindle defaults to its
 * format's up convention (`defaultAxisFor`, shared/frames.ts) — STL and 3MF
 * are Z-up (print bed; 3MF by specification) and get `z`, OBJ is Y-up and gets
 * `y`. The 3MF loader applies no rotation either (an earlier comment here
 * claimed it did; `3MFLoader.js` in node_modules rotates nothing).
 *
 * `bake` is TEMPORARY (`file-frame-spindle` D7): true applies the retired STL
 * bake for the compare pill's second LRU instance. Deleted by task 5.2.
 */
export function parseModel(bytes: ArrayBuffer, format: ModelFormat, bake = false): THREE.Object3D {
  if (format === 'stl') {
    const geometry = new STLLoader().parse(bytes)
    // Stored STL facet normals are exporter-asserted and redundant with the
    // triangle winding, which the spec makes authoritative — and files exist
    // whose normal field is zeroed, stale, or rotated into another up-axis
    // convention than the vertices. Shade from winding, always (D1).
    geometry.deleteAttribute('normal')
    geometry.computeVertexNormals()
    // TEMPORARY — legacy compare path, D7: the retired Z-up bake, verbatim,
    // for the pill's second LRU instance. Deleted by task 5.2.
    if (bake) geometry.rotateX(-Math.PI / 2)
    return withShadows(new THREE.Mesh(geometry, makeMaterial()))
  }
  if (format === 'obj') {
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes))
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = makeMaterial()
    })
    return withShadows(group)
  }
  const group = new ThreeMFLoader().parse(bytes)
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = makeMaterial()
  })
  return withShadows(group)
}

/** Byte size of all geometry attribute arrays — the LRU accounting unit. */
export function geometryBytes(object: THREE.Object3D): number {
  let bytes = 0
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry
      for (const attr of Object.values(g.attributes)) {
        bytes += (attr as THREE.BufferAttribute).array.byteLength
      }
      if (g.index !== null) bytes += g.index.array.byteLength
    }
  })
  return bytes
}

/**
 * Dispose all geometries and materials. Must be called on LRU eviction:
 * three.js tracks GPU buffers in a WeakMap, so dropping the reference frees
 * heap but leaks VRAM.
 */
export function disposeModel(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      ;(o.geometry as THREE.BufferGeometry).dispose()
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) (m as THREE.Material).dispose()
    }
  })
}

/** Embedded 3MF preview (`/Metadata/thumbnail.png`) as an object URL, if present. */
export function embedded3mfThumbnail(bytes: ArrayBuffer): string | null {
  try {
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => /^\/?Metadata\/thumbnail\.png$/i.test(f.name),
    })
    const png = Object.values(files)[0]
    if (png === undefined) return null
    return URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
  } catch {
    return null
  }
}
