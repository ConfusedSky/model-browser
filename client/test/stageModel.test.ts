import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { makeScene, stageModel, unstage } from '../src/three/renderer'
import { ViewerSession } from '../src/viewer/session'

function makeMesh(offset: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshBasicMaterial())
  mesh.position.copy(offset)
  return mesh
}

const OFFSETS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(120, -35, 7.5),
  new THREE.Vector3(-0.004, 0.001, -0.002),
]

describe('stageModel', () => {
  it('centers staged bounds at the origin whatever the raw geometry offset', () => {
    for (const offset of OFFSETS) {
      const mesh = makeMesh(offset)
      const { bounds, pivot } = stageModel(makeScene(), mesh, 'y')
      expect(bounds.center.length()).toBeLessThan(1e-9)
      expect(bounds.box.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-9)
      // The pivot carries the whole offset; the model keeps its own transform.
      expect(pivot.position.distanceTo(offset.clone().negate())).toBeLessThan(1e-9)
      expect(mesh.position.distanceTo(offset)).toBeLessThan(1e-9)
    }
  })

  it('reports the size the raw geometry had (centering rescales nothing)', () => {
    const staged = stageModel(makeScene(), makeMesh(new THREE.Vector3(9, 9, 9)), 'z')
    expect(staged.bounds.box.getSize(new THREE.Vector3()).toArray()).toEqual([2, 4, 6])
    expect(staged.bounds.radius).toBeCloseTo(Math.sqrt(1 + 4 + 9), 9)
  })

  it('parents the model to a pivot that lives in the scene', () => {
    const lit = makeScene()
    const mesh = makeMesh(new THREE.Vector3(1, 2, 3))
    const { pivot } = stageModel(lit, mesh, 'y')
    expect(mesh.parent).toBe(pivot)
    expect(pivot.parent).toBe(lit.scene)
  })
})

describe('unstage', () => {
  it('returns a thumbnail-borrowed object to the live session that owns it', () => {
    const mesh = makeMesh(new THREE.Vector3(5, 0, -2))
    const session = new ViewerSession(mesh)
    const sessionPivot = mesh.parent

    // What renderThumbnail does: remember the parent, stage into its own
    // scene, then restore in a finally block.
    const originalParent = mesh.parent
    const borrowed = stageModel(makeScene(), mesh, 'y')
    expect(mesh.parent).toBe(borrowed.pivot)
    unstage(mesh, borrowed.pivot, originalParent)

    expect(mesh.parent).toBe(sessionPivot)
    // The live view still frames the model: back on the session pivot, its
    // world bounds are centered again.
    sessionPivot!.updateMatrixWorld(true)
    const world = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3())
    expect(world.length()).toBeLessThan(1e-9)

    session.close()
    expect(mesh.parent).toBeNull()
  })

  it('leaves a parentless object detached', () => {
    const mesh = makeMesh(new THREE.Vector3(0, 3, 0))
    const { pivot } = stageModel(makeScene(), mesh, 'y')
    unstage(mesh, pivot, null)
    expect(mesh.parent).toBeNull()
    expect(pivot.children).toHaveLength(0)
  })
})
