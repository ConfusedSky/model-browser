// @vitest-environment happy-dom
// The record of the 2026-09-11 investigation (`pose-rerender`): a pose reaching
// the sweep over a render drawn without one re-renders it, by every road a pose
// takes — carried at emission over a bare entry, carried over a listing-annotated
// hit, or landed by a fresh navigation's wave. None of these is a hole; the hole
// the change fixes is `poseKey.test.tsx`'s. No cell here waits on the index's
// readiness: a navigation lands a fresh wave, and that is the mechanism.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing, IndexPose, PosesResponse } from '../../shared/types'
import {
  dir,
  getThumb,
  indexAvailability,
  listDir,
  model,
  mountApp,
  pathInput,
  pressEnter,
  putThumb,
  renderThumbnail,
  semanticPosesFor,
  settle,
  tiles,
  type,
  unmountApp,
} from './appHarness'
import { setSearchMode, setSearchTuning, TUNING_DEFAULTS } from '../src/lib/searchOptions'
import { POSE_VERSION } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'
import { setAoEnabled } from '../src/viewer/aoToggle'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const HERO = model('hero.stl')
const LISTING: DirListing = { path: '/models', entries: [HERO] }
const OTHER: DirListing = { path: '/other', entries: [dir('Alpha')] }

const POSE: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}
const WAVE: PosesResponse = { poses: { '/models/hero.stl': POSE } }

/** A cache hit rendered before the index had an opinion: no camera, no `posed`. */
const UNPOSED_HIT = { status: 'hit', pngUrl: 'blob:hero', lighting: THUMB_LIGHTING, rig: RIG_VERSION }

function tileImages(): string[] {
  return tiles().map((t) => t.querySelector('img')?.getAttribute('src') ?? '')
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

describe('a pose reaching an un-posed render re-renders it', () => {
  it('a pose carried at emission over an un-annotated entry re-renders the tile with `posed`', async () => {
    const carried: DirEntry = { ...HERO, pose: POSE }
    await mountApp('/models', { path: '/models', entries: [carried] })
    await settle()
    await settle()

    // The wave has nothing to ask: the entry carried its pose.
    expect(semanticPosesFor).not.toHaveBeenCalled()
    expect(getThumb).toHaveBeenCalledTimes(1)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.posed).toBe(POSE_VERSION)
    expect(tileImages()[0]).toBe('blob:m')
  })

  it('a pose carried at emission over a listing-annotated un-posed hit takes the lookup and re-renders', async () => {
    // The live shape at the library root: `thumb` says `hit` with no `posed`
    // and no camera, and the server's pose layer attaches the orientation.
    const carried: DirEntry = {
      ...HERO,
      pose: POSE,
      thumb: {
        gen: 5,
        framed: false,
        ao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION },
        noao: { state: 'miss' },
      },
    }
    await mountApp('/models', { path: '/models', entries: [carried] })
    await settle()
    await settle()

    expect(getThumb).toHaveBeenCalledTimes(1)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.posed).toBe(POSE_VERSION)
  })

  it('a navigation lands a fresh wave: the index that had nothing to say at the first landing answers the next', async () => {
    // The index is off at the first landing (the server's POST answers `{}`
    // and records nothing), the tile sits on its un-posed hit; the user walks
    // away and back, and the new landing's own wave — asked as every landing's
    // is, with no reading of the index's state in between — stands it up.
    indexAvailability.mockResolvedValue({ state: 'absent' })
    semanticPosesFor.mockResolvedValue({ poses: {} })
    await mountApp('/models', LISTING)
    await settle()
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(tileImages()).toEqual(['blob:hero'])
    expect(renderThumbnail).not.toHaveBeenCalled()

    semanticPosesFor.mockResolvedValue(WAVE)
    listDir.mockResolvedValue(OTHER)
    await type(pathInput(), '/other')
    await pressEnter(pathInput())
    await settle()
    listDir.mockResolvedValue(LISTING)
    await type(pathInput(), '/models')
    await pressEnter(pathInput())
    await settle()
    await settle()

    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    expect(semanticPosesFor).toHaveBeenLastCalledWith(['/models/hero.stl'])
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(lastPut()?.posed).toBe(POSE_VERSION)
    expect(tileImages()).toEqual(['blob:m'])
  })
})
