// @vitest-environment happy-dom
// A render made under one pose records which (`pose-rerender` D2). Before the
// key, a posed render carried `posed: POSE_VERSION` — the mapping's version,
// not the pose's value — so when the index later held a different opinion of
// the model the pixels were never stale: two waves, zero renders (the first
// cell, failing on main). A posed render without a key is stale, the rule the
// lighting and rig labels already follow, so the posed renders already in
// every cache are re-rendered once and gain their key (the third cell).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraState, DirListing, IndexPose, OrbitAxis, PosesResponse } from '../../shared/types'
import {
  dir,
  getThumb,
  listDir,
  model,
  mountApp,
  pathInput,
  pressEnter,
  putThumb,
  renderThumbnail,
  semanticPosesFor,
  settle,
  type,
  unmountApp,
} from './appHarness'
import { setSearchMode, setSearchTuning, TUNING_DEFAULTS } from '../src/lib/searchOptions'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose, POSE_VERSION, poseKeyOf } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'
import { setAoEnabled } from '../src/viewer/aoToggle'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const HERO = model('hero.stl')
const LISTING: DirListing = { path: '/models', entries: [HERO] }
const OTHER: DirListing = { path: '/other', entries: [dir('Alpha')] }

const POSE_A: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}
/** The same model re-classified: a different front. */
const POSE_B: IndexPose = { ...POSE_A, front: { view: 1, azimuth_deg: 45, elevation_deg: 20 } }
const WAVE_A: PosesResponse = { poses: { '/models/hero.stl': POSE_A } }
const WAVE_B: PosesResponse = { poses: { '/models/hero.stl': POSE_B } }
/** What a render drawn under each pose records. */
const KEY_A = poseKeyOf(cameraForPose(POSE_A, DEFAULT_CAMERA)!)
const KEY_B = poseKeyOf(cameraForPose(POSE_B, DEFAULT_CAMERA)!)

const UNPOSED_HIT = { status: 'hit', pngUrl: 'blob:hero', lighting: THUMB_LIGHTING, rig: RIG_VERSION }
/** A render drawn under pose A by this client: the version and the key. */
const HIT_UNDER_A = { ...UNPOSED_HIT, posed: POSE_VERSION, poseKey: KEY_A }
/** A render drawn under some pose before the key existed: the version alone,
 *  which cannot say what orientation it was drawn under. */
const HIT_PRE_KEY = { ...UNPOSED_HIT, posed: POSE_VERSION }

async function awayAndBack(): Promise<void> {
  listDir.mockResolvedValue(OTHER)
  await type(pathInput(), '/other')
  await pressEnter(pathInput())
  await settle()
  listDir.mockResolvedValue(LISTING)
  await type(pathInput(), '/models')
  await pressEnter(pathInput())
  await settle()
  await settle()
}
function lastPut(): Record<string, unknown> | undefined {
  const calls = putThumb.mock.calls
  return calls.length === 0 ? undefined : (calls[calls.length - 1]![0] as Record<string, unknown>)
}

beforeEach(() => {
  localStorage.clear()
  setAoEnabled(true)
  setSearchMode('name')
  setSearchTuning({ ...TUNING_DEFAULTS })
  getThumb.mockReset()
  getThumb.mockImplementation(() => Promise.resolve(UNPOSED_HIT))
  renderThumbnail.mockClear()
})
afterEach(() => unmountApp())

describe('a render made under a different pose', () => {
  it('a hit keyed under pose A is re-rendered when the index now says pose B, and records B', async () => {
    expect(KEY_A).not.toBe(KEY_B)
    getThumb.mockImplementation(() => Promise.resolve(HIT_UNDER_A))
    semanticPosesFor.mockResolvedValueOnce(WAVE_A)
    await mountApp('/models', LISTING)
    await settle()
    await settle()
    // Pixels drawn under this mapping and this opinion: a hit.
    expect(renderThumbnail).not.toHaveBeenCalled()

    // Re-classified. The next landing's wave answers a different front.
    semanticPosesFor.mockResolvedValueOnce(WAVE_B)
    await awayAndBack()

    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.posed).toBe(POSE_VERSION)
    expect(lastPut()?.poseKey).toBe(KEY_B)
  })

  it('the same key under a rebuilt answer is a hit: nothing is drawn', async () => {
    // The by-value half: a second landing answering the same pose — a fresh
    // object off the wire — derives the same key, and the render stands.
    getThumb.mockImplementation(() => Promise.resolve(HIT_UNDER_A))
    semanticPosesFor.mockResolvedValueOnce(WAVE_A).mockResolvedValueOnce({
      poses: { '/models/hero.stl': { ...POSE_A, front: { ...POSE_A.front! } } },
    })
    await mountApp('/models', LISTING)
    await settle()
    await awayAndBack()

    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it('a posed render without a key is re-rendered once and gains its key', async () => {
    // The 92 posed sidecars on the investigating machine, and every cache
    // written before this change: a `posed` label with no key cannot say what
    // the pixels were drawn under, so it is stale the way a render missing its
    // rig label is (Masa, 2026-09-11: "rerender if the key doesn't exist
    // instead of ignoring it") — one render, recording the key.
    getThumb.mockImplementation(() => Promise.resolve(HIT_PRE_KEY))
    semanticPosesFor.mockResolvedValueOnce(WAVE_A)
    await mountApp('/models', LISTING)
    await settle()
    await settle()

    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.posed).toBe(POSE_VERSION)
    expect(lastPut()?.poseKey).toBe(KEY_A)

    // The server echoes what was written; the next landing under the same
    // opinion is a hit — once, not on every visit.
    getThumb.mockImplementation(() => Promise.resolve({ ...HIT_PRE_KEY, poseKey: lastPut()?.poseKey }))
    semanticPosesFor.mockResolvedValueOnce(WAVE_A)
    await awayAndBack()

    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
  })

  it('control: the same shape with the hit un-posed does re-render on the second landing', async () => {
    semanticPosesFor.mockResolvedValueOnce({ poses: {} }).mockResolvedValueOnce(WAVE_B)
    await mountApp('/models', LISTING)
    await settle()
    await awayAndBack()
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.poseKey).toBe(KEY_B)
  })
})

describe('the source settled to hold nothing (`pose-rerender` D5)', () => {
  // Three pose states reach `usable`: a pose, `null` (settled: asked and none,
  // or the index known absent) and `undefined` (unsettled: warming, or an ask
  // nobody answered). A render drawn under an orientation is stale under a
  // settle — the live view opens at the default, so the tile redraws there,
  // recording no orientation — and stands while nobody knows.
  const NONE: PosesResponse = { poses: { '/models/hero.stl': null } }
  const shot = (i: number): [CameraState, OrbitAxis] => {
    const call = renderThumbnail.mock.calls[i] as unknown as [unknown, CameraState, OrbitAxis]
    return [call[1], call[2]]
  }

  it('a posed hit under a settled absence is re-rendered at the default, recording no orientation, then is a hit', async () => {
    getThumb.mockImplementation(() => Promise.resolve(HIT_UNDER_A))
    semanticPosesFor.mockResolvedValueOnce(NONE)
    await mountApp('/models', LISTING)
    await settle()
    await settle()

    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    const [camera, axis] = shot(0)
    expect(camera.az).toBeCloseTo(DEFAULT_CAMERA.az)
    expect(camera.el).toBeCloseTo(DEFAULT_CAMERA.el)
    expect(axis).toBe('z') // the STL default, no pose in force
    // The render site writes no `posed` and no `poseKey` when nothing framed
    // it — the default render is unlabelled, and no camera rides along.
    expect(lastPut()?.posed).toBeUndefined()
    expect(lastPut()?.poseKey).toBeUndefined()
    expect(lastPut()?.camera).toBeUndefined()

    // The server echoes the unlabelled render; the same settle again is a hit.
    getThumb.mockImplementation(() => Promise.resolve(UNPOSED_HIT))
    semanticPosesFor.mockResolvedValueOnce(NONE)
    await awayAndBack()

    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
  })

  it('a posed hit with no answer stands — unsettled is not none', async () => {
    // The index warming, or the ask unanswered: the wave's map has no key for
    // the model, and a render that says what it was drawn under keeps saying it.
    getThumb.mockImplementation(() => Promise.resolve(HIT_UNDER_A))
    semanticPosesFor.mockResolvedValueOnce({ poses: {} })
    await mountApp('/models', LISTING)
    await settle()
    await settle()

    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it('an unlabelled hit under a settled absence is a hit', async () => {
    getThumb.mockImplementation(() => Promise.resolve(UNPOSED_HIT))
    semanticPosesFor.mockResolvedValueOnce(NONE)
    await mountApp('/models', LISTING)
    await settle()
    await settle()

    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it('control: the default render is re-rendered posed once the source holds an orientation again', async () => {
    // The existing mechanism (*An image that predates the source's current
    // mapping is re-rendered*): the settle above leaves an unlabelled render,
    // and the next landing whose wave carries a pose redraws it under that pose.
    getThumb.mockImplementation(() => Promise.resolve(UNPOSED_HIT))
    semanticPosesFor.mockResolvedValueOnce(NONE).mockResolvedValueOnce(WAVE_A)
    await mountApp('/models', LISTING)
    await settle()
    await awayAndBack()

    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.posed).toBe(POSE_VERSION)
    expect(lastPut()?.poseKey).toBe(KEY_A)
  })
})
