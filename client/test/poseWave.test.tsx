// @vitest-environment happy-dom
// The pose wave through App (pose-for-every-model D3): a listing lands carrying
// no orientations, asks for its own models' in a second request, and merges the
// answer into the same `poses` state a meaning landing populates — so the
// thumbnail sweep re-evaluates the tiles already on screen, keeps their images,
// and re-renders only the ones the index actually spoke about.
//
// The wave asks **by path**, about the models the landing put on screen, which
// is what makes a flat listing and a name search work: their models are drawn
// from a subtree, so the directory they were asked at describes a different set
// of tiles from the ones displayed.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraState, DirListing, IndexPose, PosesResponse } from '../../shared/types'
import {
  click,
  container,
  dir,
  fetchModel,
  flatButton,
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
  semanticPosesFor,
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
/** What the wave asks about: the landing's models, in grid order. */
const MODEL_PATHS = LISTING.entries.map((e) => e.path)
const OTHER: DirListing = { path: '/other', entries: [dir('Alpha')] }

/**
 * The same four models as `LISTING`, reached the way a *flat* listing or a name
 * search reaches them: named by relative path, living in subfolders, and not a
 * single one of them a direct child of `/models`. A wave that described this
 * grid by the folder it was opened at would answer about `/models`' own three
 * files — none of which are here.
 */
const NESTED: DirListing = {
  path: '/models',
  entries: [
    model('Kits/hero.stl'),
    model('Kits/aimed.stl'),
    model('Spares/fresh.stl'),
    model('Spares/quiet.stl'),
  ],
}
const NESTED_PATHS = NESTED.entries.map((e) => e.path)

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
 * `WAVE` rebuilt, every object and array of it fresh — which is what a *second*
 * round trip really hands the app, since each response is parsed anew. A cell
 * that asserts "the duplicate answer costs nothing" has to deliver one of these
 * rather than the same object twice, or the map's identity never changes, the
 * sweep never re-runs, and the by-value compare it means to exercise is never
 * reached.
 */
const rebuiltPose = (p: IndexPose): IndexPose => ({
  ...p,
  up: [p.up[0], p.up[1], p.up[2]],
  azimuth_zero: [p.azimuth_zero[0], p.azimuth_zero[1], p.azimuth_zero[2]],
  front: p.front === null ? null : { ...p.front },
})
const freshWave = (): PosesResponse => ({
  poses: Object.fromEntries(
    Object.entries(WAVE.poses).map(([path, pose]) => [path, rebuiltPose(pose)]),
  ),
})

/** The same answer over `NESTED`, with `quiet` left out for the same reason. */
const NESTED_WAVE: PosesResponse = {
  poses: {
    '/models/Kits/hero.stl': POSE,
    '/models/Kits/aimed.stl': POSE,
    '/models/Spares/fresh.stl': POSE,
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
 *
 * Keyed on the file's own name rather than its whole path, so the same four
 * states describe `LISTING` and `NESTED` alike — a flat listing's `hero` is the
 * same model in the same state, reached down a folder.
 */
function cached(path: string): Record<string, unknown> {
  const base = { status: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION }
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name === 'aimed.stl') return { ...base, pngUrl: 'blob:aimed', camera: CAM }
  if (name === 'fresh.stl') return { ...base, pngUrl: 'blob:fresh', posed: POSE_VERSION }
  if (name === 'quiet.stl') return { ...base, pngUrl: 'blob:quiet' }
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
    semanticPosesFor.mockReturnValue(wave.promise)
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
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(semanticPosesFor).toHaveBeenCalledWith(MODEL_PATHS)
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

    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(lookedUp()).toEqual([])
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(tileImages()).toEqual(drawn)
  })

  it('a wave that fails says nothing at all', async () => {
    semanticPosesFor.mockRejectedValue(new Error('index exploded'))
    await mountApp('/models', LISTING)
    await settle()
    getThumb.mockClear()
    await settle()

    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
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
    expect(semanticPosesFor).not.toHaveBeenCalled()

    await act(async () => {
      probe.resolve({ state: 'ready', id: 'test', top: '/lib', root: '/' })
    })
    await settle()

    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(semanticPosesFor).toHaveBeenCalledWith(MODEL_PATHS)
  })

  it('asks nothing at all while the library is not there', async () => {
    library.mockResolvedValue({ state: 'missing', root: '/nope' })
    await mountApp('/models', LISTING)
    await settle()
    await settle()
    expect(semanticPosesFor).not.toHaveBeenCalled()
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
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)

    await type(searchInput(), 'hero')
    await pressEnter(searchInput())
    await settle()

    expect(semanticSearch).toHaveBeenCalled()
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
  })
})

describe('every listing shape asks, not only a directory', () => {
  it('a flat listing gets the poses of the models it actually shows', async () => {
    // The gap this closes: the wave used to describe the grid by the folder the
    // user opened, so a flat listing of a library root asked about the handful
    // of files sitting at the top and was answered about none of the hundreds
    // on screen. It asks about the entries instead — every one of which lives a
    // folder down here.
    const wave = deferred<PosesResponse>()
    await mountApp('/models', LISTING)
    await settle()
    // After the mount, which resets `listDir` to the boot listing (the harness's
    // rule) — a walk installed before it would be the one that got wiped.
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      Promise.resolve(opts?.flat === true ? NESTED : LISTING),
    )
    semanticPosesFor.mockReturnValue(wave.promise)

    await click(flatButton())
    await settle()
    expect(flatButton().getAttribute('aria-pressed')).toBe('true')
    // The boot listing's wave, then the flat landing's — one apiece, and the
    // second names the nested models by the paths the grid is drawn from.
    expect(semanticPosesFor).toHaveBeenLastCalledWith(NESTED_PATHS)
    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    // None of those paths is a child of the directory the wave used to name,
    // which is what makes the old request unable to answer this grid.
    expect(NESTED_PATHS.some((path: string) => MODEL_PATHS.includes(path))).toBe(false)
    getThumb.mockClear()

    await act(async () => {
      wave.resolve(NESTED_WAVE)
    })
    await settle()

    // The tiles re-render: the three the index named are re-looked-up, and the
    // one it said nothing about is not touched.
    expect(lookedUp().sort()).toEqual([
      '/models/Kits/aimed.stl',
      '/models/Kits/hero.stl',
      '/models/Spares/fresh.stl',
    ])
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    const put = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(put.path).toBe('/models/Kits/hero.stl')
    expect(put.posed).toBe(POSE_VERSION)
  })

  it("a name search's wave carries the matches, wherever they were found", async () => {
    // A name search is a `listing` answer too, and its matches are drawn from a
    // whole subtree — so the folder it was run at describes its grid no better
    // than a flat listing's does.
    await mountApp('/models', LISTING)
    await settle()
    listDir.mockResolvedValue(NESTED)

    await type(searchInput(), 'stl')
    await pressEnter(searchInput())
    await settle()

    expect(tiles()).toHaveLength(4)
    expect(semanticPosesFor).toHaveBeenLastCalledWith(NESTED_PATHS)
    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
  })

  it('a listing of folders alone asks nothing at all', async () => {
    // No models, nothing to ask about: an empty batch would be a round trip
    // spent to be told `{}`.
    await mountApp('/other', OTHER)
    await settle()
    await settle()

    expect(tiles()).toHaveLength(1)
    expect(semanticPosesFor).not.toHaveBeenCalled()
  })

  it('asks about the models a mixed listing holds, and about nothing else', async () => {
    // Folders are not models and have no orientation; the wave names the
    // entries the sweep would draw a thumbnail for and no others.
    const mixed: DirListing = { path: '/models', entries: [dir('Alpha'), HERO, dir('Beta'), QUIET] }
    await mountApp('/models', mixed)
    await settle()

    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(semanticPosesFor).toHaveBeenCalledWith(['/models/hero.stl', '/models/quiet.stl'])
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
    semanticPosesFor.mockReturnValueOnce(stale.promise)
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

describe('the library going away and coming back re-asks the same landing', () => {
  it('re-fires the wave for a landing that never moved — accepted, not desired', async () => {
    // **This pins current behaviour, and the behaviour is a wart.** The wave's
    // effect takes `libraryReady` as a *dependency* rather than a bare guard, so
    // that a boot listing landing before the probe answers still gets its wave
    // (the cell above). The cost is that the readiness is a boolean the effect
    // re-runs on in BOTH directions: a library that goes away and comes back
    // under a listing that never moved asks the index a second time about the
    // very same paths.
    //
    // Accepted rather than fixed. The duplicate costs one request that the
    // reducer overwrites the slot with and the sweep then no-ops on by value —
    // no lookups, no renders, no images dropped — and the alternatives (a
    // fired-for-this-id ref, or re-arming the guard on every landing) put a
    // second piece of state beside `Result.id`, which is already the one thing
    // that says which listing an answer belongs to. If a future change makes
    // the duplicate cost anything, this is the cell to change.
    //
    // Driven through two *failed* navigations, because a successful one lands
    // and the new landing would fire the wave for its own reasons: a failure
    // keeps `state.result` — and so `landedListing`'s id and entries array —
    // exactly as they were, which is what makes this the same landing.
    // Imported from the *mocked module*, not by calling `apiClientModule()`
    // again: the factory mints a fresh class per call, so a second one is a
    // different constructor and `App`'s `err instanceof HttpError` — the whole
    // reason this cell can move the library at all — would quietly be false.
    const { HttpError } = (await import('../src/api/client')) as unknown as {
      HttpError: new (status: number, message: string, state?: string) => Error
    }
    semanticPosesFor.mockImplementation(() => Promise.resolve(freshWave()))
    await mountApp('/models', LISTING)
    await settle()
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(semanticPosesFor).toHaveBeenCalledWith(MODEL_PATHS)
    const drawn = tileImages()
    getThumb.mockClear()
    renderThumbnail.mockClear()

    // The volume goes away: a path route 503s naming the library's state, App
    // re-probes, and the answer is `missing`.
    listDir.mockRejectedValue(new HttpError(503, 'the library is not available', 'missing'))
    library.mockResolvedValue({ state: 'missing', root: '/nope' })
    await type(pathInput(), '/other')
    await pressEnter(pathInput())
    await settle()
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)

    // And comes back. The navigation fails again, so nothing lands and the
    // listing on screen is still the boot one.
    library.mockResolvedValue({ state: 'ready', id: 'test', top: '/lib', root: '/' })
    await type(pathInput(), '/elsewhere')
    await pressEnter(pathInput())
    await settle()

    // The wart: a second POST, about the same paths, for the same landing.
    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    expect(semanticPosesFor).toHaveBeenLastCalledWith(MODEL_PATHS)
    // And the reason it is affordable: the reducer overwrites the slot with an
    // equal map, the sweep re-runs on its identity and finds every pose
    // unchanged by value, so not one tile is even looked up again.
    expect(lookedUp()).toEqual([])
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(tileImages()).toEqual(drawn)
  })
})

describe('the lightbox reads a wave-supplied pose', () => {
  it('hands the viewer the orientation a plain listing was given', async () => {
    // `App` passes `poses[viewer.entry.path]` to the layer, and before the wave
    // that resolved only under a meaning or similarity answer. The handoff is
    // the same one — the pose is advisory, the tile's stored camera and axis
    // are what they were — and this is the plain listing finally reaching it.
    semanticPosesFor.mockResolvedValue(WAVE)
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
