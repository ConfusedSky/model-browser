import type { ModelFormat, OrbitAxis } from "./types";

/**
 * Spindle frames as plain arithmetic. No `three` import: the server project
 * compiles `shared/` and has no `three`.
 */

export type Triple = readonly [number, number, number];

/**
 * `s` is the spindle (yaw axis, also camera up); (a, b) span the yaw plane with
 * a × b = −s, so a rightward drag spins the same way under every spindle.
 * Azimuth is measured from `b` toward `a`.
 */
export interface FrameTriples {
  s: Triple;
  a: Triple;
  b: Triple;
}

/**
 * The scene-axis convention — the frames angles were measured in while STL
 * geometry was baked Y-up. Kept because `FILE_FRAMES` is derived from it and
 * the frame-ab harness reproduces it (file-frame-spindle D3/D6).
 */
export const SCENE_FRAMES: Record<OrbitAxis, FrameTriples> = {
  y: { s: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  "-y": { s: [0, -1, 0], a: [0, 0, 1], b: [1, 0, 0] },
  x: { s: [1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  "-x": { s: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
  z: { s: [0, 0, 1], a: [0, 1, 0], b: [1, 0, 0] },
  "-z": { s: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },
};

/** R⁻¹, the inverse of the bake `rotateX(-π/2)`, which took (x, y, z) to (x, z, −y). */
export function unbake(v: Triple): Triple {
  // `0 - x` rather than `-x`: a unary minus turns a 0 component into −0, and
  // the derived table would then not compare equal to hand-typed triples.
  return [v[0], 0 - v[2], v[1]];
}

const AXIS_VECTORS: readonly { axis: OrbitAxis; v: Triple }[] = [
  { axis: "x", v: [1, 0, 0] },
  { axis: "-x", v: [-1, 0, 0] },
  { axis: "y", v: [0, 1, 0] },
  { axis: "-y", v: [0, -1, 0] },
  { axis: "z", v: [0, 0, 1] },
  { axis: "-z", v: [0, 0, -1] },
];

/** The axis a unit axis vector names — by exact lookup; anything else throws. */
export function axisOfTriple(v: Triple): OrbitAxis {
  const match = AXIS_VECTORS.find(
    ({ v: u }) => u[0] === v[0] && u[1] === v[1] && u[2] === v[2],
  );
  if (match === undefined)
    throw new Error(`not a unit axis vector: [${v.join(", ")}]`);
  return match.axis;
}

/**
 * The frames every camera is measured in, geometry being rendered as its file
 * describes it. Derived, never typed: each scene frame under R⁻¹, re-keyed by
 * the axis its spindle then names (D3). `y` and `-y` are fixed points, and
 * every row keeps a × b = −s since R⁻¹ is a proper rotation.
 */
export const FILE_FRAMES: Record<OrbitAxis, FrameTriples> = Object.fromEntries(
  (Object.values(SCENE_FRAMES) as FrameTriples[]).map(({ s, a, b }) => [
    axisOfTriple(unbake(s)),
    { s: unbake(s), a: unbake(a), b: unbake(b) },
  ]),
) as Record<OrbitAxis, FrameTriples>;

/**
 * A scene-convention axis in the file convention, for the one baked format
 * (STL; 3MF never was, and converts like OBJ via `swapOffset`): the spindle's
 * image under R⁻¹, derived so it cannot drift from the tables.
 */
export function migrateAxis(sceneAxis: OrbitAxis): OrbitAxis {
  return axisOfTriple(unbake(SCENE_FRAMES[sceneAxis].s));
}

function dot(u: Triple, v: Triple): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

/**
 * Radians to add to a scene-convention `az` for a format that was never baked
 * (OBJ, 3MF): the spindle keeps its name, but the frame that name selects moved
 * from `SCENE_FRAMES[axis]` to `FILE_FRAMES[axis]`. The offset is the θ = 0
 * direction (`b_old`) re-measured in the new frame.
 */
export function swapOffset(axis: OrbitAxis): number {
  const old = SCENE_FRAMES[axis];
  const next = FILE_FRAMES[axis];
  return Math.atan2(dot(old.b, next.a), dot(old.b, next.b));
}

/**
 * The spindle a model with no stored axis turns about — its format's up
 * convention: STL and 3MF Z-up, OBJ Y-up (D2). The one definition every surface
 * drawing an un-framed model reads.
 */
export function defaultAxisFor(format: ModelFormat): OrbitAxis {
  return format === "obj" ? "y" : "z";
}
