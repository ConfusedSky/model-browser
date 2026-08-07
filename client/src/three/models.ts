import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { unzipSync } from 'fflate'

export type ModelFormat = 'stl' | '3mf' | 'obj'

export function formatOf(path: string): ModelFormat | null {
  const m = /\.(stl|3mf|obj)$/i.exec(path)
  return m ? (m[1]!.toLowerCase() as ModelFormat) : null
}

function makeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.75 })
}

/** Parse model bytes into an Object3D with consistent materials. */
export function parseModel(bytes: ArrayBuffer, format: ModelFormat): THREE.Object3D {
  if (format === 'stl') {
    const geometry = new STLLoader().parse(bytes)
    if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals()
    return new THREE.Mesh(geometry, makeMaterial())
  }
  if (format === 'obj') {
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes))
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = makeMaterial()
    })
    return group
  }
  const group = new ThreeMFLoader().parse(bytes)
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = makeMaterial()
  })
  return group
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
