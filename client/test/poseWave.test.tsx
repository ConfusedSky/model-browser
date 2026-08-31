// @vitest-environment happy-dom
// The pose wave through App (pose-for-every-model D3): a plain listing lands
// carrying no orientations, asks for them in a second request, and merges the
// answer into the same `poses` state a meaning landing populates — so the
// thumbnail sweep re-evaluates the tiles already on screen, keeps their images,
// and re-renders only the ones the index actually spoke about.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraState, DirListing, IndexPose, PosesResponse } from '../../shared/types'
import {
  container,
  dir,
  fetchModel,
  getThumb,
  indexAvailability,
  library,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  putThumb,
  renderThumbnail,
  searchInput,
  semanticPoses,
  semanticSearch,
  settle,
  tiles,
  tinyStl,
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
// The viewer is out of scope here except for what App hands it: this stub keeps
// the last props so the lightbox cell can read the `pose` that reached it, and
// draws nothing. No cell below opens a viewer except that one, so every other
// cell runs against a grid with no overlay over it.
const viewerProps = vi.hoisted(() => ({
  last: null as { pose?: IndexPose; camera?: CameraState; axis?: string } | null,
}))
vi.mock('../src/viewer/ViewerLayer', () => ({
  default: (props: { pose?: IndexPose; camera?: CameraState; axis?: string }) => {
    viewerProps.last = props
    return null
  },
}))

const HERO = model('hero.stl')
const AIMED = model('aimed.stl')
const FRESH = model('fresh.stl')
const QUIET = model('quiet.stl')
const LISTING: DirListing = { path: '/models', entries: [HERO, AIMED, FRESH, QUIET] }
const OTHER: DirListing = { path: '/other', entries: [dir('Alpha')] }

/** The user's own orientation, stored on `aimed.stl` from an earlier orbit. */
const CAM: CameraState = { az: 1, el: 0.25, distR: 3, target: [0, 0, 0] }
const POSE: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}
/** What the wave answers with: three of the four models, `quiet.stl` left out —
 *  an index that holds no orientation for a model simply omits it. */
const WAVE: PosesResponse = {
  poses: {
    '/models/hero.stl': POSE,
    '/models/aimed.stl': POSE,
    '/models/fresh.stl': POSE,
  },
}

/**
 * Every tile a cache hit, each with a URL of its own so "this image was kept"
 * and "this image was replaced" cannot read alike (the harness's
 * `createObjectURL` answers one constant string, which a re-render's URL is).
 *
 * The four states the wave has to tell apart: nothing stored and no pose label
 * (`hero` — the case the wave exists for), the user's own camera (`aimed`),
 * pixels already drawn under the current pose recipe (`fresh`), and a model the
 * index says nothing about (`quiet`).
 */
function cached(path: string): Record<string, unknown> {
  const base = { status: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION }
  if (path === '/models/aimed.stl') return { ...base, pngUrl: 'blob:aimed', camera: CAM }
  if (path === '/models/fresh.stl') return { ...base, pngUrl: 'blob:fresh', posed: POSE_VERSION }
  if (path === '/models/quiet.stl') return { ...base, pngUrl: 'blob:quiet' }
  return { ...base, pngUrl: 'blob:hero' }
}

/** A promise a cell resolves by hand — how a wave is made to land *after* the
 *  grid it is about is already drawn, which is the case the delta describes. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Each tile's image source, in grid order — '' where a tile draws no image. */
function tileImages(): string[] {
  return tiles().map((t) => t.querySelector('img')?.getAttribute('src') ?? '')
}
/** Which paths the cache was asked about since the last `mockClear`. */
function lookedUp(): string[] {
  return getThumb.mock.calls.map((c) => c[0] as string)
}

beforeEach(() => {
  localStorage.clear()
  setAoEnabled(true)
  setSearchMode('name')
  setSearchTuning({ ...TUNING_DEFAULTS })
  // The shared stubs keep whatever the last file installed (client/test/CLAUDE.md
  // — `mountApp` clears the calls, not the implementation).
  getThumb.mockReset()
  getThumb.mockImplementation((path: string) => Promise.resolve(cached(path)))
  renderThumbnail.mockClear()
  viewerProps.last = null
})
afterEach(() => unmountApp())

describe('a listing asks for its poses', () => {
  it('re-renders the tiles the index spoke about and keeps every image meanwhile', async () => {
    // The wave lands over a grid that is already drawn: `hero` was cached
    // before the index had an opinion, so its pixels are stale under a recipe
    // input the cache key does not carry — and it alone is re-rendered.
    const wave = deferred<PosesResponse>()
    semanticPoses.mockReturnValue(wave.promise)
    // Held open so the re-render is still in flight when the images are read:
    // "keeps its image until the replacement exists" is a claim about the
    // window, and a render that resolves inside the same tick has none.
    const bytes = deferred<ArrayBuffer>()
    fetchModel.mockImplementation((path: string) =>
      path === '/models/hero.stl' ? bytes.promise : Promise.resolve(tinyStl()),
    )

    await mountApp('/models', LISTING)
    await settle()
    expect(tileImages()).toEqual(['blob:hero', 'blob:aimed', 'blob:fresh', 'blob:quiet'])
    expect(semanticPoses).toHaveBeenCalledTimes(1)
    expect(semanticPoses).toHaveBeenCalledWith('/models')
    getThumb.mockClear()

    await act(async () => {
      wave.resolve(WAVE)
    })
    await settle()

    // Only the three the index named are re-evaluated; the tile it said
    // nothing about is not touched at all.
    expect(lookedUp().sort()).toEqual([
      '/models/aimed.stl',
      '/models/fresh.stl',
      '/models/hero.stl',
    ])
    // The grid is unchanged while `hero`'s replacement is being drawn — its own
    // image included.
    expect(tileImages()).toEqual(['blob:hero', 'blob:aimed', 'blob:fresh', 'blob:quiet'])

    await act(async () => {
      bytes.resolve(tinyStl())
    })
    await settle()

    // One render, one PUT, and it is `hero`'s — labelled with the pose recipe
    // so the next visit reads it as fresh instead of drawing it again.
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(putThumb).toHaveBeenCalledTimes(1)
    const put = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.path).toBe('/models/hero.stl')
    expect(put.posed).toBe(POSE_VERSION)
    // Still not the user's orientation: pixels only (semantic-search D5).
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
    // The tile the user aimed himself keeps its pixels — a stored camera wins
    // over the index's opinion, so there is nothing stale about them — and so
    // does the one whose pixels were already drawn under this pose recipe.
    expect(tileImages().slice(1)).toEqual(['blob:aimed', 'blob:fresh', 'blob:quiet'])
    expect(tileImages()[0]).not.toBe('blob:hero')
  })

  it('an index with nothing to say costs the listing nothing, and is asked once', async () => {
    // The harness default is the answer an index that is not running gives.
    // Nothing may follow from it: no lookups, no renders, no second request —
    // an empty answer that re-armed the wave would be a request loop.
    await mountApp('/models', LISTING)
    await settle()
    const drawn = tileImages()
    getThumb.mockClear()
    await settle()
    await settle()

    expect(semanticPoses).toHaveBeenCalledTimes(1)
    expect(lookedUp()).toEqual([])
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(tileImages()).toEqual(drawn)
  })

  it('a wave that fails says nothing at all', async () => {
    semanticPoses.mockRejectedValue(new Error('index exploded'))
    await mountApp('/models', LISTING)
    await settle()
    getThumb.mockClear()
    await settle()

    expect(semanticPoses).toHaveBeenCalledTimes(1)
    // The listing stays as it is, and the failure reaches no surface: the
    // index's absence costs the listing nothing, and a sentence about it would
    // be a cost.
    expect(container.textContent).not.toContain('index exploded')
    expect(tiles()).toHaveLength(4)
    expect(lookedUp()).toEqual([])
    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it('waits for the library, and does not give up on it', async () => {
    // A library that is not `ready` has no path route to answer this, so the
    // wave is not spent on it. And the readiness is a *dependency*, not a bare
    // guard: the boot listing goes out beside the probe and can land first, so
    // a guard alone would mean the wave never goes out at all on a healthy
    // start that happened to answer in that order.
    const probe = deferred<{ state: string; id: string; top: string; root: string }>()
    library.mockReturnValue(probe.promise)
    await mountApp('/models', LISTING)
    await settle()
    expect(semanticPoses).not.toHaveBeenCalled()

    await act(async () => {
      probe.resolve({ state: 'ready', id: 'test', top: '/lib', root: '/' })
    })
    await settle()

    expect(semanticPoses).toHaveBeenCalledTimes(1)
    expect(semanticPoses).toHaveBeenCalledWith('/models')
  })

  it('asks nothing at all while the library is not there', async () => {
    library.mockResolvedValue({ state: 'missing', root: '/nope' })
    await mountApp('/models', LISTING)
    await settle()
    await settle()
    expect(semanticPoses).not.toHaveBeenCalled()
  })

  it('a meaning answer is not asked again — its hits carried their poses', async () => {
    indexAvailability.mockResolvedValue({
      state: 'ready',
      collectionRoot: '/models',
      covers: ['stl'],
    })
    semanticSearch.mockResolvedValue({
      path: '/models',
      entries: [model('Kits/hero.stl')],
      poses: { '/models/Kits/hero.stl': POSE },
      scores: {},
      scope: { path: null, status: 'indexed', indexed: 2, scanned: 2, covers: ['stl'] },
      weak: false,
      capped: false,
    })
    // Before the mount: the boot view takes the profile's own options, so this
    // is how the app comes up in meaning mode without a click.
    setSearchMode('meaning')
    await mountApp('/models', LISTING)
    await settle()
    // The boot listing's own wave, and the only one this cell may see.
    expect(semanticPoses).toHaveBeenCalledTimes(1)

    await type(searchInput(), 'hero')
    await pressEnter(searchInput())
    await settle()

    expect(semanticSearch).toHaveBeenCalled()
    expect(semanticPoses).toHaveBeenCalledTimes(1)
  })
})

describe('a wave belongs to the landing that fired it', () => {
  it('is dropped when it answers about a view the user has left', async () => {
    // Left *and returned to*, deliberately: a wave for another folder could not
    // apply anyway — its keys name models this listing does not have — so the
    // case that can actually go wrong is the one where the paths are identical
    // and only the landing differs. The drop is by asking event (`Result.id`),
    // not by path, which is exactly what this asserts.
    const stale = deferred<PosesResponse>()
    semanticPoses.mockReturnValueOnce(stale.promise)
    await mountApp('/models', LISTING)
    await settle()

    listDir.mockResolvedValue(OTHER)
    await type(pathInput(), '/other')
    await pressEnter(pathInput())
    await settle()
    listDir.mockResolvedValue(LISTING)
    await type(pathInput(), '/models')
    await pressEnter(pathInput())
    await settle()
    expect(tileImages()).toEqual(['blob:hero', 'blob:aimed', 'blob:fresh', 'blob:quiet'])
    getThumb.mockClear()
    renderThumbnail.mockClear()

    // The first listing's wave, home at last. Its poses are for paths that are
    // on screen again — and it still says nothing, because the answer it
    // belongs to is gone.
    await act(async () => {
      stale.resolve(WAVE)
    })
    await settle()

    expect(lookedUp()).toEqual([])
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(tileImages()).toEqual(['blob:hero', 'blob:aimed', 'blob:fresh', 'blob:quiet'])
  })
})

describe('the lightbox reads a wave-supplied pose', () => {
  it('hands the viewer the orientation a plain listing was given', async () => {
    // `App` passes `poses[viewer.entry.path]` to the layer, and before the wave
    // that resolved only under a meaning or similarity answer. The handoff is
    // the same one — the pose is advisory, the tile's stored camera and axis
    // are what they were — and this is the plain listing finally reaching it.
    semanticPoses.mockResolvedValue(WAVE)
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Ffresh.stl', LISTING)
    await settle()

    expect(viewerProps.last).not.toBeNull()
    expect(viewerProps.last!.pose).toEqual(POSE)
    // Nothing of the user's is stored for this model, so the layer opens at the
    // pose rather than at a camera — the parity the orbit-handoff cells pin.
    expect(viewerProps.last!.camera).toBeUndefined()
    expect(viewerProps.last!.axis).toBeUndefined()
  })
})
