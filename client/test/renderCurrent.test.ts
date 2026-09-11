import { describe, expect, it } from 'vitest'
import type { CameraState, IndexPose, ThumbRenderInfo } from '../../shared/types'
import { isCurrentRender } from '../src/hooks/useThumbnails'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose, POSE_VERSION, poseKeyOf } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

// ─── bulk-thumbnail-jobs 1.1 / thumbnail-image-serving 2.2 ──────────────────
// The staleness test the sweep, the bulk generate derivation and the listing
// annotation all ask, extracted so they cannot drift. Every label below is
// asserted through the constant it comes from, never a literal
// (`client/test/CLAUDE.md`): a literal keeps passing across a bump while
// asserting a value nothing writes any more.

/** A render carrying exactly what this build writes. */
const current = (extra: Partial<ThumbRenderInfo> = {}): ThumbRenderInfo => ({
  state: 'hit',
  lighting: THUMB_LIGHTING,
  rig: RIG_VERSION,
  ...extra,
})

const CAM: CameraState = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] }

/** The same shape `thumbnailQueue.test.tsx` drives the hook with. */
const POSE: IndexPose = {
  up: [0, 0, 1],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}

describe('isCurrentRender', () => {
  it('a hit at this build’s labels is current', () => {
    expect(isCurrentRender(current(), undefined, undefined, undefined)).toBe(true)
  })

  it('a stale or missing render is not', () => {
    // Both non-hit states, so a predicate that only excluded `miss` would be
    // caught: `stale` is what the cache answers for pixels whose file moved.
    expect(isCurrentRender(current({ state: 'stale' }), undefined, undefined, undefined)).toBe(false)
    expect(isCurrentRender(current({ state: 'miss' }), undefined, undefined, undefined)).toBe(false)
  })

  it('the retired axis lighting label is not current', () => {
    // `'axis'` is the retired spindle-aligned rig's label and reads as stale —
    // never as "the current mode" (client/test/CLAUDE.md).
    expect(isCurrentRender(current({ lighting: 'axis' }), undefined, undefined, undefined)).toBe(
      false,
    )
    // A pre-lighting entry carries no label at all, and is stale for the same
    // reason.
    expect(
      isCurrentRender({ state: 'hit', rig: RIG_VERSION }, undefined, undefined, undefined),
    ).toBe(false)
  })

  it('a render from another rig is not current', () => {
    expect(isCurrentRender(current({ rig: RIG_VERSION - 1 }), undefined, undefined, undefined)).toBe(
      false,
    )
    expect(
      isCurrentRender({ state: 'hit', lighting: THUMB_LIGHTING }, undefined, undefined, undefined),
    ).toBe(false)
  })

  it('an unowned entry behind the pose recipe is stale', () => {
    // Nothing of the user's stored and an index opinion in hand: pixels drawn
    // before that opinion existed keep a default angle for ever unless this
    // clause calls them stale.
    expect(isCurrentRender(current(), undefined, undefined, POSE)).toBe(false)
    // …and at the current recipe, recording this very pose, they are current again.
    const poseKey = poseKeyOf(cameraForPose(POSE, DEFAULT_CAMERA)!)
    expect(
      isCurrentRender(current({ posed: POSE_VERSION, poseKey }), undefined, undefined, POSE),
    ).toBe(true)
    // A posed render that cannot say which orientation it was drawn under is
    // stale, like one missing its rig label (`pose-rerender` D2).
    expect(isCurrentRender(current({ posed: POSE_VERSION }), undefined, undefined, POSE)).toBe(false)
  })

  it('an owned entry ignores the pose entirely', () => {
    // A stored camera wins over the index's opinion (semantic-search D5), and
    // a re-render of an owned entry writes no `posed` label at all — so a
    // predicate that read the pose here would re-render and re-upload the same
    // picture on every visit, for ever.
    expect(isCurrentRender(current(), CAM, undefined, POSE)).toBe(true)
    // A stored axis alone is ownership too.
    expect(isCurrentRender(current(), undefined, '-z', POSE)).toBe(true)
  })

  it('an absent render is not current', () => {
    // What an annotation carrying no block for the variant in force means.
    expect(isCurrentRender(undefined, CAM, '-z', undefined)).toBe(false)
  })
})
