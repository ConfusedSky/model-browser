import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { SCENE_FRAMES } from '../../shared/frames'
import { CAMERA_EPSILON, type CameraState, type OrbitAxis } from '../../shared/types'
import {
  applyState,
  boundsOf,
  captureState,
  DEFAULT_CAMERA,
  frameFor,
  statePosition,
  stateTarget,
  type Bounds,
} from '../src/three/camera'

const STATE: CameraState = { az: 0.8, el: 0.4, distR: 3, target: [0.1, -0.2, 0.05] }
const AXES: OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']

/** Camera math reads only center/radius; the box is along for the ride. */
function boundsAt(center: THREE.Vector3, radius: number): Bounds {
  const box = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(radius, radius, radius))
  return { center, radius, box }
}

function roundTrip(state: CameraState, bounds: Bounds, axis: OrbitAxis): CameraState {
  const pos = statePosition(state, bounds, axis)
  const target = stateTarget(state, bounds)
  return captureState(pos, target, bounds, axis)
}

function expectClose(a: CameraState, b: CameraState): void {
  expect(a.az).toBeCloseTo(b.az, 6)
  expect(a.el).toBeCloseTo(b.el, 6)
  expect(a.distR).toBeCloseTo(b.distR, 6)
  for (let i = 0; i < 3; i++) expect(a.target[i]).toBeCloseTo(b.target[i]!, 6)
}

describe('bounds-relative camera state', () => {
  it('capture(apply(state)) round-trips', () => {
    const bounds = boundsAt(new THREE.Vector3(5, 2, -3), 7)
    expectClose(roundTrip(STATE, bounds, 'z'), STATE)
  })

  it('survives a re-scaled re-export: same state, different bounds → same view', () => {
    const mm = boundsAt(new THREE.Vector3(10, 0, 0), 25.4)
    const inches = boundsAt(new THREE.Vector3(0.39, 0, 0), 1)

    // The state is unit-free: capturing from either sized world recovers it.
    expectClose(roundTrip(STATE, mm, 'z'), STATE)
    expectClose(roundTrip(STATE, inches, 'z'), STATE)

    // And the framing is identical: distance-to-target scales with the radius.
    const posMm = statePosition(STATE, mm, 'z')
    const posIn = statePosition(STATE, inches, 'z')
    expect(posMm.distanceTo(stateTarget(STATE, mm)) / mm.radius).toBeCloseTo(
      posIn.distanceTo(stateTarget(STATE, inches)) / inches.radius,
      6,
    )
  })

  it('applyState aims the camera at the state target', () => {
    const bounds = boundsAt(new THREE.Vector3(0, 0, 0), 2)
    const camera = new THREE.PerspectiveCamera(40, 1)
    applyState(camera, STATE, bounds, 'z')
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    const toTarget = stateTarget(STATE, bounds).sub(camera.position).normalize()
    expect(forward.dot(toTarget)).toBeCloseTo(1, 5)
  })

  it('capture(apply(state)) round-trips under every spindle axis', () => {
    const bounds = boundsAt(new THREE.Vector3(5, 2, -3), 7)
    for (const axis of AXES) expectClose(roundTrip(STATE, bounds, axis), STATE)
  })

  it('spindle round-trip survives a re-scaled re-export', () => {
    const mm = boundsAt(new THREE.Vector3(10, 0, 0), 25.4)
    const inches = boundsAt(new THREE.Vector3(0.39, 0, 0), 1)
    for (const axis of AXES) {
      expectClose(roundTrip(STATE, mm, axis), STATE)
      expectClose(roundTrip(STATE, inches, axis), STATE)
    }
  })

  it('the y frame is unchanged from the scene table: the historical world-Y representation', () => {
    // There is no default axis any more (file-frame-spindle D2) — but the `y`
    // frame, which every un-framed model used to be drawn about, is a fixed
    // point of the re-derivation, so an OBJ at its default reads as it always
    // did. Assert it against the pre-bake table the derivation starts from.
    const { s, a, b } = frameFor('y')
    expect([s.toArray(), a.toArray(), b.toArray()]).toEqual([
      SCENE_FRAMES.y.s,
      SCENE_FRAMES.y.a,
      SCENE_FRAMES.y.b,
    ])
    const bounds = boundsAt(new THREE.Vector3(1, 2, 3), 4)
    const explicit = statePosition(STATE, bounds, 'y')
    // The world-Y formula the client used before spindle frames existed:
    const dist = STATE.distR * bounds.radius
    const manual = stateTarget(STATE, bounds).add(
      new THREE.Vector3(
        Math.sin(STATE.az) * Math.cos(STATE.el),
        Math.sin(STATE.el),
        Math.cos(STATE.az) * Math.cos(STATE.el),
      ).multiplyScalar(dist),
    )
    expect(explicit.distanceTo(manual)).toBeLessThan(1e-9)
  })

  it('every frame satisfies a×b = −s with unit vectors (consistent drag feel)', () => {
    for (const axis of AXES) {
      const { s, a, b } = frameFor(axis)
      expect(new THREE.Vector3().crossVectors(a, b).distanceTo(s.clone().negate())).toBeLessThan(1e-12)
      for (const v of [s, a, b]) expect(v.length()).toBeCloseTo(1, 12)
    }
  })

  it('applyState locks camera up to the spindle', () => {
    const bounds = boundsAt(new THREE.Vector3(0, 0, 0), 2)
    for (const axis of AXES) {
      const camera = new THREE.PerspectiveCamera(40, 1)
      applyState(camera, STATE, bounds, axis)
      expect(camera.up.distanceTo(frameFor(axis).s)).toBeLessThan(1e-12)
    }
  })

  it('boundsOf centers a mesh and finds a positive radius', () => {
    const geom = new THREE.BoxGeometry(2, 2, 2)
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial())
    mesh.position.set(10, 10, 10)
    mesh.updateMatrixWorld()
    const bounds = boundsOf(mesh)
    expect(bounds.center.x).toBeCloseTo(10, 5)
    expect(bounds.radius).toBeGreaterThan(0)
  })
})

/*
 * ── The round-trip drift probe behind CAMERA_EPSILON ─────────────────────────
 *
 * `ThumbCache.put` decides whether a PUT *moved* the camera by comparing the
 * incoming `CameraState` against the stored one within `CAMERA_EPSILON`
 * (shared/types.ts), and invalidates the sibling occlusion render when it did
 * (`ao-as-recipe-dimension` D2). The tolerance exists because that comparison
 * is fed a state that has been round-tripped: `persist` re-sends a camera the
 * lightbox's close settled through `captureState`, whether or not the user
 * moved anything, and az/el → cartesian → `asin`/`atan2` → az/el is not
 * bit-exact. Under value equality every close of an oriented model would
 * invalidate its sibling.
 *
 * The constant's doc comment quotes a measurement; this is that measurement,
 * where it can be re-run instead of re-typed. The assertion is deliberately
 * far looser than the drift and far tighter than the constant: it fails long
 * before the tolerance is in danger, and it says nothing about what the right
 * tolerance is — only that what it absorbs is nowhere near it.
 */

const EL_LIMIT = Math.PI / 2 - 0.01
/** `ViewerSession`'s own dolly clamp, in bounding-sphere radii. */
const DIST_MIN = 1.1
const DIST_MAX = 20

/** A seeded LCG (Numerical Recipes), so this sweep is the same sweep every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Signed angular difference wrapped into (−π, π]: `az` comes back from
 *  `atan2`, so a state drawn near ±π returns on the other side of the branch
 *  cut and a raw subtraction would report 2π of "drift" that is not there. */
function angleDelta(a: number, b: number): number {
  return ((a - b + Math.PI) % (2 * Math.PI)) - Math.PI
}

describe('camera round-trip drift (the measurement behind CAMERA_EPSILON)', () => {
  it('survives 200k round trips at each of three scales, orders below the tolerance', () => {
    const rand = lcg(0x5eed)
    const camera = new THREE.PerspectiveCamera(40, 1)
    let worst = 0
    let worstRadius = 0

    for (const radius of [0.01, 1, 137]) {
      // Pivoted to the origin, the way `stageModel` leaves every model.
      const bounds = boundsAt(new THREE.Vector3(0, 0, 0), radius)
      for (let i = 0; i < 200_000; i++) {
        // `target` drawn inside the bounding sphere (radius units): a uniform
        // direction and a radius scaled by the cube root of a uniform, which
        // fills the ball instead of crowding its center.
        const u = 2 * rand() - 1
        const phi = 2 * Math.PI * rand()
        const r = Math.cbrt(rand())
        const rho = Math.sqrt(1 - u * u) * r
        const state: CameraState = {
          az: 2 * Math.PI * rand() - Math.PI,
          el: (2 * rand() - 1) * EL_LIMIT,
          distR: DIST_MIN + rand() * (DIST_MAX - DIST_MIN),
          target: [rho * Math.cos(phi), rho * Math.sin(phi), u * r],
        }

        // The trip a lightbox close makes: place the camera in the world, then
        // recover the state from where it landed.
        applyState(camera, state, bounds, 'y')
        const back = captureState(camera.position, stateTarget(state, bounds), bounds, 'y')

        const drift = Math.max(
          Math.abs(angleDelta(back.az, state.az)),
          Math.abs(back.el - state.el),
          Math.abs(back.distR - state.distR),
          Math.abs(back.target[0] - state.target[0]),
          Math.abs(back.target[1] - state.target[1]),
          Math.abs(back.target[2] - state.target[2]),
        )
        if (drift > worst) {
          worst = drift
          worstRadius = radius
        }
      }
    }

    // MEASURED, this exact sweep, AOD-B's run 2026-08-31: max per-component
    // drift **2.1538e-14**, worst at radius 1. The bound below is 1e-13, so
    // ~4.6× over the measurement and ~46000× under `CAMERA_EPSILON` itself.
    // Deterministic — same seed, same states, same answer — so a changed
    // number means the camera math changed, not that the dice fell differently.
    //
    // Larger than the 7.1e-15 quoted in `CAMERA_EPSILON`'s own doc comment
    // (the fourth reviewer's 2026-08-28 run) because the sweeps are not
    // identical: this one goes through `applyState` rather than
    // `statePosition`, draws `distR` across the session's full [1.1, 20] dolly
    // clamp, and fills the target ball by cube-root radius. Same order, same
    // conclusion — five orders of headroom either way. Re-run this, do not
    // re-type it.
    expect(worst).toBeLessThan(CAMERA_EPSILON / 1e4)
    // Non-trivial: a probe that stopped exercising the round trip — a state
    // generator collapsed onto one value, a `captureState` handing back its
    // input — would read exactly zero and sail through the bound above.
    expect(worst).toBeGreaterThan(0)
    expect([0.01, 1, 137]).toContain(worstRadius)
  }, 120_000)

  it('DEFAULT_CAMERA itself survives the trip, which is the common case', () => {
    // Every unmoved close of an un-oriented model re-sends this state. If it
    // drifted past the tolerance, a close that changed nothing would invalidate
    // the sibling render on every model nobody had ever orbited.
    const bounds = boundsAt(new THREE.Vector3(0, 0, 0), 1)
    const camera = new THREE.PerspectiveCamera(40, 1)
    applyState(camera, DEFAULT_CAMERA, bounds, 'y')
    const back = captureState(camera.position, stateTarget(DEFAULT_CAMERA, bounds), bounds, 'y')
    for (const d of [
      angleDelta(back.az, DEFAULT_CAMERA.az),
      back.el - DEFAULT_CAMERA.el,
      back.distR - DEFAULT_CAMERA.distR,
      ...back.target.map((t, i) => t - DEFAULT_CAMERA.target[i]!),
    ]) {
      expect(Math.abs(d)).toBeLessThan(CAMERA_EPSILON / 1e4)
    }
  })
})
