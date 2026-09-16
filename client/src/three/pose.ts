import type { CameraState, IndexPose, OrbitAxis } from "../../../shared/types";
import { frameFor } from "./camera";

const AXES: { axis: OrbitAxis; v: [number, number, number] }[] = [
  { axis: "x", v: [1, 0, 0] },
  { axis: "-x", v: [-1, 0, 0] },
  { axis: "y", v: [0, 1, 0] },
  { axis: "-y", v: [0, -1, 0] },
  { axis: "z", v: [0, 0, 1] },
  { axis: "-z", v: [0, 0, -1] },
];

const EXACT = 1e-6;

/** `RIG_VERSION`'s contract for the pose→camera mapping: **bump it whenever the
 *  mapping changes what a posed thumbnail looks like**. Which orientation a
 *  render was drawn under is `poseKey` (`pose-rerender` D2). */
export const POSE_VERSION = 2;

/** By **exact lookup, never a nearest-axis snap** (D5): the index answers from
 *  a fixed set of six unit vectors, so anything else is a fault upstream — and
 *  a rounded one is persisted to the sidecar by the next orbit. */
export function axisOf(up: [number, number, number]): OrbitAxis | null {
  const match = AXES.find(({ v }) =>
    v.every((c, i) => Math.abs(c - up[i]!) < EXACT),
  );
  return match?.axis ?? null;
}

/**
 * The azimuth offset is **derived** from `azimuth_zero`, not tabulated: the
 * index measures after rotating the mesh to +Z up and this app rotates no mesh,
 * so the rotation is paid for in the azimuth — `azimuth_deg` unmodified is a
 * quarter turn out for three of the six axes.
 */
export function cameraForPose(
  pose: IndexPose | null | undefined,
  base: CameraState,
): { camera: CameraState; axis: OrbitAxis } | null {
  // Telling a settled absence from an unsettled one is the sweep's business.
  if (pose == null) return null;
  const axis = axisOf(pose.up);
  if (axis === null) return null;
  const { s, a, b } = frameFor(axis);
  const u0 = pose.azimuth_zero;
  // Perpendicular to `up` by construction; one that is not is malformed the
  // way an off-axis `up` is, and gets the same answer.
  if (Math.abs(s.x * u0[0] + s.y * u0[1] + s.z * u0[2]) > 1e-3) return null;
  const offset = Math.atan2(
    a.x * u0[0] + a.y * u0[1] + a.z * u0[2],
    b.x * u0[0] + b.y * u0[1] + b.z * u0[2],
  );
  // No front view cached: the index prescribes azimuth 0 at the first
  // elevation. The orientation is still worth keeping.
  const azDeg = pose.front?.azimuth_deg ?? 0;
  const elDeg = pose.front?.elevation_deg ?? 0;
  return {
    axis,
    camera: {
      ...base,
      az: (azDeg * Math.PI) / 180 + offset,
      el: (elDeg * Math.PI) / 180,
    },
  };
}

/** Over `cameraForPose`'s answer, not the pose's raw fields: the answer is what
 *  the pixels depended on, so two opinions deriving one view do not re-render.
 *  Four decimals is far below what a thumbnail can show. */
export function poseKeyOf(resolved: {
  camera: CameraState;
  axis: OrbitAxis;
}): string {
  return `${resolved.axis}:${resolved.camera.az.toFixed(4)}:${resolved.camera.el.toFixed(4)}`;
}
