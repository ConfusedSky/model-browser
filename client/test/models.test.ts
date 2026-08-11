import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { parseModel } from '../src/three/models'

/** One-triangle binary STL: 80-byte header, uint32 count, 50 bytes per facet. */
function stlBytes(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50)
  const view = new DataView(buffer)
  view.setUint32(80, 1, true)
  const floats = [0, 0, 1, /* normal */ 0, 0, 0, 1, 0, 0, 0, 1, 0]
  floats.forEach((f, i) => view.setFloat32(84 + i * 4, f, true))
  return buffer
}

describe('parseModel', () => {
  it('gives every mesh both shadow flags, so models self-shadow (D2)', () => {
    const object = parseModel(stlBytes(), 'stl')
    const meshes: THREE.Mesh[] = []
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o)
    })
    expect(meshes).toHaveLength(1)
    expect(meshes.map((m) => [m.castShadow, m.receiveShadow])).toEqual([[true, true]])
  })
})
