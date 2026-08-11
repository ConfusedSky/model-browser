import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { frameFor } from '../src/three/camera'
import {
  makeScene,
  stageModel,
  unstage,
  type LitScene,
  type StagedModel,
} from '../src/three/renderer'
import { ViewerSession } from '../src/viewer/session'
import type { OrbitAxis } from '../../shared/types'

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

/** The rig's two rim lights, found the way stageModel and the session find them. */
function rimsOf(lit: LitScene): THREE.DirectionalLight[] {
  return lit.rig.children.filter(
    (l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight && l.name === 'rim',
  )
}

describe('rim shadow fit', () => {
  it("gives each rim the key's fit, so an enabled rim shadow is well-formed", () => {
    const { lit, key } = stageRadius(1)
    const rims = rimsOf(lit)
    expect(rims).toHaveLength(2)
    const cam = key.shadow.camera
    for (const rim of rims) {
      const rimCam = rim.shadow.camera
      expect([rimCam.left, rimCam.right, rimCam.bottom, rimCam.top]).toEqual([
        cam.left,
        cam.right,
        cam.bottom,
        cam.top,
      ])
      expect(rimCam.near).toBeCloseTo(cam.near, 9)
      expect(rimCam.far).toBeCloseTo(cam.far, 9)
      expect(rim.shadow.normalBias).toBeCloseTo(key.shadow.normalBias, 9)
      expect(rim.shadow.mapSize.toArray()).toEqual([2048, 2048])
      expect(rim.position.length()).toBeCloseTo(key.position.length(), 9)
    }
  })

  it('leaves the rims lit, aimed as tuned, and not casting — fitting is configuration only', () => {
    const tuned = rimsOf(makeScene()).map((l) => l.position.clone().normalize())
    const rims = rimsOf(stageRadius(1).lit)
    rims.forEach((rim, i) => {
      expect(rim.castShadow).toBe(false)
      expect(rim.visible).toBe(true)
      expect(rim.position.clone().normalize().distanceTo(tuned[i]!)).toBeLessThan(1e-9)
    })
  })
})

const AXES: OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']
/** makeMesh's half-extents: distinct per axis, so every spindle rests on a different face. */
const HALF = new THREE.Vector3(1, 2, 3)
/** Frozen floor constants (D3): opacity, sink ε·radius, size 8·radius. */
const FLOOR_OPACITY = 0.35
const FLOOR_SINK_R = 0.002
const FLOOR_SIZE_R = 8

/** Stage an asymmetric, off-center box and hand back its scene + floor. */
function stageFloor(axis: OrbitAxis): LitScene & StagedModel {
  const lit = makeScene()
  // Off-center raw geometry: staging recenters it and the floor must follow.
  const staged = stageModel(lit, makeMesh(new THREE.Vector3(7, -3, 11)), axis)
  lit.scene.updateMatrixWorld(true)
  return { ...lit, ...staged }
}

/** The unit plane's +z normal, carried into world space. */
function floorNormal(floor: THREE.Mesh): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(floor.getWorldQuaternion(new THREE.Quaternion()))
}

/** The floor mesh a live session staged, found the way the renderer parents it. */
function sessionFloor(session: ViewerSession): THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> {
  const floor = session.rig.parent?.children.find(
    (child): child is THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> =>
      child instanceof THREE.Mesh && child.material instanceof THREE.ShadowMaterial,
  )
  if (floor === undefined) throw new Error('session scene has no contact floor')
  return floor
}

describe('contact floor', () => {
  it('rests on the face the spindle points away from, for every spindle', () => {
    for (const axis of AXES) {
      const { floor, bounds } = stageFloor(axis)
      const s = frameFor(axis).s
      // The face minimizing dot(p, s): on an origin-centered box that is the
      // half-extent along |s|, and each spindle gets a different one.
      const half = Math.abs(s.x) * HALF.x + Math.abs(s.y) * HALF.y + Math.abs(s.z) * HALF.z
      const expected = s.clone().multiplyScalar(-half - FLOOR_SINK_R * bounds.radius)
      expect(floor.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-6)
      // Normal along +s: the plane faces the model, not away from it.
      expect(floorNormal(floor).distanceTo(s)).toBeLessThan(1e-6)
    }
  })

  it('sinks ε·radius under the resting face and spans 8·radius', () => {
    const { floor, bounds } = stageFloor('y')
    const depth = -floor.getWorldPosition(new THREE.Vector3()).y - HALF.y
    expect(depth).toBeCloseTo(FLOOR_SINK_R * bounds.radius, 9)
    expect(depth).toBeGreaterThan(0) // under the model, never intersecting it
    expect(floor.scale.toArray()).toEqual([
      FLOOR_SIZE_R * bounds.radius,
      FLOOR_SIZE_R * bounds.radius,
      FLOOR_SIZE_R * bounds.radius,
    ])
  })

  it('catches shadows without casting or showing, at the frozen opacity', () => {
    const { floor } = stageFloor('z')
    expect(floor.receiveShadow).toBe(true)
    expect(floor.castShadow).toBe(false)
    expect(floor.material.transparent).toBe(true)
    expect(floor.material.opacity).toBe(FLOOR_OPACITY)
  })

  it('hangs from the scene, outside the measured bounds', () => {
    const { scene, floor, pivot, bounds } = stageFloor('y')
    expect(floor.parent).toBe(scene)
    // Not under the pivot: an 8·radius plane there would swallow the bounds.
    const measured = new THREE.Box3().setFromObject(pivot)
    expect(measured.min.distanceTo(bounds.box.min)).toBeLessThan(1e-6)
    expect(measured.max.distanceTo(bounds.box.max)).toBeLessThan(1e-6)
  })

  it('snaps to the new spindle the moment the session changes axis', () => {
    const session = new ViewerSession(makeMesh(new THREE.Vector3()), 'y')
    const floor = sessionFloor(session)
    const sink = FLOOR_SINK_R * Math.sqrt(HALF.x ** 2 + HALF.y ** 2 + HALF.z ** 2)
    expect(floor.position.distanceTo(new THREE.Vector3(0, -HALF.y - sink, 0))).toBeLessThan(1e-6)

    session.setAxis('-z')
    // Mid-tween — the camera is still easing, the floor is already there.
    expect(session.animating).toBe(true)
    const snapped = new THREE.Vector3(0, 0, HALF.z + sink)
    expect(floor.position.distanceTo(snapped)).toBeLessThan(1e-6)
    expect(floorNormal(floor).distanceTo(frameFor('-z').s)).toBeLessThan(1e-6)
  })

  it('disposes its geometry and material when the session closes', () => {
    const session = new ViewerSession(makeMesh(new THREE.Vector3(1, 2, 3)))
    const floor = sessionFloor(session)
    const geometry = vi.spyOn(floor.geometry, 'dispose')
    const material = vi.spyOn(floor.material, 'dispose')
    session.close()
    expect(geometry).toHaveBeenCalledOnce()
    expect(material).toHaveBeenCalledOnce()
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
