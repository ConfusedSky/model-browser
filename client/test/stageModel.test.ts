import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { makeScene, stageModel, unstage, type LitScene } from '../src/three/renderer'
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

/** Stage a cube of the given half-diagonal (= bounding-sphere radius). */
function stageRadius(radius: number): { lit: LitScene; key: THREE.DirectionalLight; radius: number } {
  const side = (2 * radius) / Math.sqrt(3)
  const lit = makeScene()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, side, side), new THREE.MeshBasicMaterial())
  const staged = stageModel(lit, mesh, 'y')
  const key = lit.rig.getObjectByName('key') as THREE.DirectionalLight
  return { lit, key, radius: staged.bounds.radius }
}

describe('key-light shadow fit', () => {
  it("makes the key the rig's only caster, at a 2048² map", () => {
    const { lit, key } = stageRadius(1)
    const casters = lit.rig.children.filter((l) => l.castShadow)
    expect(casters).toEqual([key])
    expect(key.shadow.mapSize.toArray()).toEqual([2048, 2048])
  })

  it('scales frustum, depth range and bias with the model — freezing the tuned multiples', () => {
    // Frozen fit constants (D2), in radius units: distance 3, half-extent 2,
    // depth margin 0.5, normalBias 0.02. Changing them changes every model's
    // pixels and needs a RIG_VERSION bump.
    const small = stageRadius(1)
    const r = small.radius // float32 vertices: 1 to within ~1e-8
    expect(r).toBeCloseTo(1, 6)
    expect(small.key.position.length()).toBeCloseTo(3 * r, 9)
    const cam = small.key.shadow.camera
    expect([cam.left, cam.right, cam.bottom, cam.top]).toEqual([-2 * r, 2 * r, -2 * r, 2 * r])
    expect(cam.near).toBeCloseTo(0.5 * r, 9)
    expect(cam.far).toBeCloseTo(5.5 * r, 9)
    expect(small.key.shadow.normalBias).toBeCloseTo(0.02 * r, 9)

    // A model 100× bigger gets the same fit 100× out — the shadow camera is
    // unitless, so miniatures and busts land identically in the map.
    const big = stageRadius(100)
    expect(big.radius / small.radius).toBeCloseTo(100, 4)
    const bigCam = big.key.shadow.camera
    expect(bigCam.right / cam.right).toBeCloseTo(100, 4)
    expect(bigCam.top / cam.top).toBeCloseTo(100, 4)
    expect(bigCam.near / cam.near).toBeCloseTo(100, 4)
    expect(bigCam.far / cam.far).toBeCloseTo(100, 4)
    expect(big.key.shadow.normalBias / small.key.shadow.normalBias).toBeCloseTo(100, 4)
    expect(big.key.position.length() / small.key.position.length()).toBeCloseTo(100, 4)
  })

  it('moves the key along its own direction, so the shading is untouched', () => {
    const tuned = (makeScene().rig.getObjectByName('key') as THREE.DirectionalLight).position
      .clone()
      .normalize()
    for (const radius of [1, 100]) {
      const { key } = stageRadius(radius)
      expect(key.position.clone().normalize().distanceTo(tuned)).toBeLessThan(1e-9)
    }
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
