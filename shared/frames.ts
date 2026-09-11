import type { ModelFormat, OrbitAxis } from './types'

/**
 * Spindle frames as plain arithmetic, shared by the client (`three/camera.ts`
 * lifts them into `Vector3`s) and the frame-ab harness. No `three` import: the
 * server project compiles `shared/` and has no `three`.
 */

export type Triple = readonly [number, number, number]

/**
 * A turntable frame: `s` is the spindle (yaw axis, also camera up); (a, b)
 * span the yaw plane with a × b = −s, so a rightward drag spins the same
 * visual direction under every spindle. Azimuth is measured from `b` toward
 * `a` (`captureState`'s `atan2(dir·a, dir·b)`).
 */
export interface FrameTriples {
  s: Triple
  a: Triple
  b: Triple
}

/**
 * The frames camera angles were measured in while STL geometry was baked Y-up
 * (`geometry.rotateX(-π/2)` in `parseModel`, removed by file-frame-spindle):
 * the scene-axis convention. Kept as the table `FILE_FRAMES` is derived from,
 * and as the legacy convention the compare pill and the frame-ab harness
 * reproduce (D3/D6/D7).
 */
export const SCENE_FRAMES: Record<OrbitAxis, FrameTriples> = {
  y: { s: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  '-y': { s: [0, -1, 0], a: [0, 0, 1], b: [1, 0, 0] },
  x: { s: [1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  '-x': { s: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
  z: { s: [0, 0, 1], a: [0, 1, 0], b: [1, 0, 0] },
  '-z': { s: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },
}

/**
 * R⁻¹, the inverse of the bake `rotateX(-π/2)`: a scene direction back to the
 * file direction it was the image of. The bake took (x, y, z) to (x, z, −y);
 * this takes it back.
 */
export function unbake(v: Triple): Triple {
  // `0 - x` rather than `-x`: a unary minus turns a 0 component into −0, and
  // the derived table would then not compare equal to hand-typed triples.
  return [v[0], 0 - v[2], v[1]]
}

const AXIS_VECTORS: readonly { axis: OrbitAxis; v: Triple }[] = [
  { axis: 'x', v: [1, 0, 0] },
  { axis: '-x', v: [-1, 0, 0] },
  { axis: 'y', v: [0, 1, 0] },
  { axis: '-y', v: [0, -1, 0] },
  { axis: 'z', v: [0, 0, 1] },
  { axis: '-z', v: [0, 0, -1] },
]

/** The axis a unit axis vector names — by exact lookup; anything else throws. */
export function axisOfTriple(v: Triple): OrbitAxis {
  const match = AXIS_VECTORS.find(({ v: u }) => u[0] === v[0] && u[1] === v[1] && u[2] === v[2])
  if (match === undefined) throw new Error(`not a unit axis vector: [${v.join(', ')}]`)
  return match.axis
}

/**
 * The frames in file coordinates — the table the app measures every camera in
 * now that geometry is rendered as its file describes it. Derived, never
 * typed: each scene frame's image under R⁻¹, re-keyed by the axis its spindle
 * vector then names (D3). Two fixed points fall out: `y` equals the scene
 * table's `y`, and `-y` equals the scene table's `-y`. Every row keeps
 * a × b = −s since R⁻¹ is a proper rotation.
 */
export const FILE_FRAMES: Record<OrbitAxis, FrameTriples> = Object.fromEntries(
  (Object.values(SCENE_FRAMES) as FrameTriples[]).map(({ s, a, b }) => [
    axisOfTriple(unbake(s)),
    { s: unbake(s), a: unbake(a), b: unbake(b) },
  ]),
) as Record<OrbitAxis, FrameTriples>

/**
 * A scene-convention axis converted to the file convention, for the one format
 * that was baked (STL — 3MF never was, despite an old comment; it converts
 * like OBJ, by `swapOffset`): the spindle vector's image under R⁻¹. y→z,
 * -y→-z, z→-y, -z→y, x→x, -x→-x — derived, so the two tables cannot drift
 * apart from this. Used by the frame-ab harness to render the spike's recorded
 * scene-convention framings under the file convention.
 */
export function migrateAxis(sceneAxis: OrbitAxis): OrbitAxis {
  return axisOfTriple(unbake(SCENE_FRAMES[sceneAxis].s))
}

function dot(u: Triple, v: Triple): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
}

/**
 * Radians to add to a scene-convention `az` to express it in the file
 * convention, for a format that was never baked (OBJ, 3MF): its spindle keeps
 * its name, but the frame that name selects moved from `SCENE_FRAMES[axis]` to
 * `FILE_FRAMES[axis]`. Used where `migrateAxis` is. A direction at old azimuth θ is
 * `a_old sinθ cosφ + b_old cosθ cosφ + s sinφ`; re-measured in the new frame,
 * `θ' = atan2(d·a_new, d·b_new)`, and the difference is the θ = 0 direction
 * (`b_old`) re-measured there. `x` −90°, `-x` +90°, `z` +90°, `-z` −90°, `y`
 * and `-y` 0 (the fixed points).
 */
export function swapOffset(axis: OrbitAxis): number {
  const old = SCENE_FRAMES[axis]
  const next = FILE_FRAMES[axis]
  return Math.atan2(dot(old.b, next.a), dot(old.b, next.b))
}

/**
 * The spindle a model with no stored axis turns about: its format's up
 * convention (D2). STL and 3MF are Z-up (print bed; 3MF by specification), OBJ
 * is Y-up. The one definition every surface that draws an un-framed model
 * reads; `null` or `undefined` here is a type error, never a default.
 */
export function defaultAxisFor(format: ModelFormat): OrbitAxis {
  return format === 'obj' ? 'y' : 'z'
}
