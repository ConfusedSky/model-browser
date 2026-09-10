import type { CameraState, IndexPose, OrbitAxis } from '../../../shared/types'
import { frameFor } from './camera'

const AXES: { axis: OrbitAxis; v: [number, number, number] }[] = [
  { axis: 'x', v: [1, 0, 0] },
  { axis: '-x', v: [-1, 0, 0] },
  { axis: 'y', v: [0, 1, 0] },
  { axis: '-y', v: [0, -1, 0] },
  { axis: 'z', v: [0, 0, 1] },
  { axis: '-z', v: [0, 0, -1] },
]

const EXACT = 1e-6

/**
 * Version of the mapping from an index pose to a camera. Bumped whenever that
 * mapping changes what a posed thumbnail looks like — the same contract as
 * `RIG_VERSION`, and for the same reason: the pixels depend on an input the
 * cache key does not carry, so without a version a wrong render stays wrong
 * while looking fresh.
 *
 * 1 = read the index's axes as scene axes while STL geometry was baked
 * `rotateX(-π/2)` on load, which put the spindle 90° from the model's actual
 * up and rendered models lying down. 2 = the index's axes and the spindle are
 * the same file frame. That was first achieved by mapping the pose into scene
 * space (`toSceneSpace`, now gone); `file-frame-spindle` removed the bake and
 * the mapping together, and the rendered picture is unchanged (design D4: the
 * spindle frames are the bake's image, and the offset derived below is
 * invariant under a rotation applied to both the frame and `azimuth_zero`), so
 * no bump.
 */
export const POSE_VERSION = 2

/**
 * The index's up axis as one of the six spindles — by **exact lookup**, never a
 * nearest-axis snap (D5). The index measures in the file's coordinates and so
 * does the spindle, so the up axis *is* the spindle: `[0,0,1]` is `z`.
 *
 * Pose resolution picks its winner from a fixed set of six unit axis vectors
 * and returns it unchanged, so anything else is a fault upstream. Rounding it
 * would absorb that fault into a plausible-looking spindle, and because a
 * subsequent orbit persists the axis to the thumbnail sidecar, the rounding
 * would then be durable and invisible. Returns null so the caller can ignore
 * the orientation and say why.
 */
export function axisOf(up: [number, number, number]): OrbitAxis | null {
  const match = AXES.find(({ v }) => v.every((c, i) => Math.abs(c - up[i]!) < EXACT))
  return match?.axis ?? null
}

/**
 * Camera state for an index pose, or null when the pose is not one this app can
 * express.
 *
 * The azimuth offset is **derived** from `azimuth_zero`, not tabulated. The
 * index measures its angles after rotating the mesh so `up` points at +Z; this
 * app never rotates a mesh — the spindle is how it expresses a non-Z-up model —
 * so the rotation has to be paid for in the azimuth instead. Since `az = 0`
 * points along the spindle frame's `b`, the offset is the angle from `b` to the
 * index's zero direction about the spindle.
 *
 * Deriving it rather than hard-coding the six constants means a change to the
 * index's rotation arrives as a different value in a field already being read.
 * Passing `azimuth_deg` through unmodified is a quarter turn out for three of
 * the six axes — 1,520 of 2,945 models in the primary cache, `y` (the library's
 * commonest up axis) among them.
 */
export function cameraForPose(
  pose: IndexPose | undefined,
  base: CameraState,
): { camera: CameraState; axis: OrbitAxis } | null {
  if (pose === undefined) return null
  const axis = axisOf(pose.up)
  if (axis === null) return null
  const { s, a, b } = frameFor(axis)
  const u0 = pose.azimuth_zero
  // `azimuth_zero` is perpendicular to `up` by construction; a pose where it is
  // not is malformed in the same way an off-axis `up` is, and gets the same
  // answer rather than a best-effort projection.
  if (Math.abs(s.x * u0[0] + s.y * u0[1] + s.z * u0[2]) > 1e-3) return null
  const offset = Math.atan2(
    a.x * u0[0] + a.y * u0[1] + a.z * u0[2],
    b.x * u0[0] + b.y * u0[1] + b.z * u0[2],
  )
  // No front view cached for this view config: the index prescribes azimuth 0
  // at the first elevation, which is what view 0 always is. The orientation is
  // still worth keeping — only the angles are missing.
  const azDeg = pose.front?.azimuth_deg ?? 0
  const elDeg = pose.front?.elevation_deg ?? 0
  return {
    axis,
    camera: {
      ...base,
      az: (azDeg * Math.PI) / 180 + offset,
      el: (elDeg * Math.PI) / 180,
    },
  }
}
