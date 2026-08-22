// @vitest-environment happy-dom
// Meaning search through App: the mode, the fallback when the index is not
// there, and the reporting that makes an empty grid attributable.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing, SemanticListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  getThumb,
  indexAvailability,
  labels,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  putThumb,
  renderThumbnail,
  searchInput,
  semanticSearch,
  settle,
  tiles,
  type,
  unmountApp,
} from './appHarness'
import { setSearchMode, setSearchTuning, TUNING_DEFAULTS } from '../src/lib/searchOptions'
import { POSE_VERSION } from '../src/three/pose'
import { RIG_VERSION } from '../src/three/renderer'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const scope = (over: Partial<SemanticListing['scope']> = {}) => ({
  path: null,
  status: 'indexed' as const,
  indexed: 2801,
  scanned: 2801,
  covers: ['stl'],
  ...over,
})
const MEANING: SemanticListing = {
  path: '/models',
  entries: [model('Kits/Baal/hero.stl'), model('Kits/Baal/base.stl')],
  poses: {},
  scope: scope(),
  weak: false,
  capped: false,
}

function modeButton(name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
    (b) => b.textContent?.trim().toLowerCase() === name,
  )
}
function searchTab(): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('aside [role="tab"]')).find((b) =>
    b.textContent?.toLowerCase().startsWith('search'),
  )!
}

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
  setSearchTuning({ ...TUNING_DEFAULTS })
})
afterEach(() => unmountApp())

describe('meaning search', () => {
  it('is not offered at all when the index is not running', async () => {
    await mountApp('/models', NESTED)
    await click(searchTab())
    expect(modeButton('meaning')).toBeUndefined()
  })

  it('a phrase returns models whose names never mention it', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)

    await type(searchInput(), 'a winged demon')
    await pressEnter(searchInput())
    await settle()

    // The third argument is the tuning in force — defaults here, and asserted
    // rather than ignored so a silently-dropped parameter cannot pass.
    expect(semanticSearch).toHaveBeenCalledWith(
      'a winged demon',
      '/models',
      TUNING_DEFAULTS,
      // The fourth argument is the abort handle: a superseded query is stopped,
      // not merely ignored.
      expect.any(AbortSignal),
    )
    expect(listDir).not.toHaveBeenCalledWith('/models', expect.objectContaining({ q: 'a winged demon' }))
    // None of the results contain the phrase — the whole point, and the case
    // that would have been hidden if the search input still filtered.
    expect(labels()).toEqual(['hero.stl', 'base.stl'])
    expect(container.textContent).toContain('Meaning matches for "a winged demon".')
    expect(location.search).toContain('mode=meaning')
  })

  it('flipping the mode re-runs the same text against the other corpus', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    // After mount: the harness points listDir at the initial listing, so a
    // no-match name search has to be configured once that is out of the way.
    listDir.mockImplementation(() => Promise.resolve({ path: '/models', entries: [] }))

    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()
    expect(container.textContent).toContain('Nothing matched')

    await click(modeButton('meaning')!)
    await settle()

    expect(semanticSearch).toHaveBeenCalledWith(
      'winged demon',
      '/models',
      TUNING_DEFAULTS,
      expect.any(AbortSignal),
    )
    expect(searchInput().value).toBe('winged demon')
  })

  it('a weak set is marked as a set, with no per-result score on any tile', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue({ ...MEANING, weak: true })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'zzz')
    await pressEnter(searchInput())
    await settle()

    expect(container.textContent).toContain('Nothing stood out')
    expect(container.textContent).not.toMatch(/0\.\d\d/)
  })

  it('distinguishes nothing-matched from nothing-indexed-here', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue({
      ...MEANING,
      entries: [],
      scope: scope({ status: 'unindexed', indexed: 0, scanned: 0 }),
    })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'dragon')
    await pressEnter(searchInput())
    await settle()

    expect(container.textContent).toContain('Nothing here has been indexed yet')
    expect(container.textContent).toContain('stl')
  })

  it('committing and clearing a meaning search push one history entry each', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    const before = history.length

    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()
    expect(location.search).toContain('mode=meaning')

    // Clearing the input is how a search is left, whichever corpus ran it.
    await type(searchInput(), '')
    await settle()

    expect(location.search).not.toContain('mode=meaning')
    expect(location.search).not.toContain('q=')
    expect(history.length).toBe(before + 2)
  })

  it('every committed search names its corpus, so a link never inherits a reader’s default', async () => {
    // The failure this prevents: a name-search link opened by someone whose
    // default is meaning. Absence would have to be read as "name" by every
    // reader forever, including after the default changes — so the URL says it.
    setSearchMode('meaning')
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('name')!)

    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()

    expect(location.search).toContain('mode=name')
    expect(semanticSearch).not.toHaveBeenCalled()
  })

  it('a name link is a name search even where the reader prefers meaning', async () => {
    setSearchMode('meaning')
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=widget&mode=name', NESTED)
    await settle()

    expect(semanticSearch).not.toHaveBeenCalled()
    expect(listDir).toHaveBeenCalledWith(
      '/models',
      expect.objectContaining({ q: 'widget' }),
      expect.any(AbortSignal),
    )
  })

  it('the panel is never empty: meaning mode with no index still explains itself', async () => {
    // The trap this prevents: a link puts the app in meaning mode on a machine
    // with no index, and the panel hides the mode control (meaning cannot run),
    // the status (absent is not worth reporting), and the name options (mode is
    // meaning) — leaving nothing on screen and no way back.
    indexAvailability.mockResolvedValue({ state: 'absent' })
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=demon&mode=meaning', NESTED)
    await settle()
    await click(searchTab())

    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('not running')
    // …and a way out of the mode, which is the part that made it a trap.
    expect(modeButton('name')).toBeDefined()

    await click(modeButton('name')!)
    await settle()
    // Switching to the name corpus brings its options back.
    expect(panel.querySelector('button[aria-label="Match folder names"]')).not.toBeNull()
  })

  it('meaning mode does not show name-search options, running or not', async () => {
    // A submit in meaning mode defers; it does not become a name search. So
    // folder-matching under a mode that says Meaning would describe a search
    // that is not going to happen.
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 4 })
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=demon&mode=meaning', NESTED)
    await settle()
    await click(searchTab())

    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('starting up')
    expect(panel.querySelector('button[aria-label="Match folder names"]')).toBeNull()
    // Still not a trap: the mode is visible and leaving it is one click.
    expect(modeButton('name')).toBeDefined()
  })

  it('tiles render at the index’s pose when nothing is cached', async () => {
    // The grid is where models are looked at, so an orientation that reached
    // only the viewer reached almost nobody.
    const POSE = {
      up: [0, 1, 0] as [number, number, number],
      azimuth_zero: [1, 0, 0] as [number, number, number],
      source: 'siglip',
      confidence: 0.9,
      front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
    }
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue({
      ...MEANING,
      entries: [model('Kits/hero.stl')],
      poses: { '/models/Kits/hero.stl': POSE },
    })
    getThumb.mockResolvedValue({ status: 'miss' })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'hero')
    await pressEnter(searchInput())
    await settle()

    const call = renderThumbnail.mock.calls.at(-1)
    expect(call).toBeDefined()
    const [, camera, axis] = call! as unknown as [unknown, { az: number; el: number }, string]
    // A file Y-up model is the `-z` spindle in the scene (the loader bakes
    // rotateX(-π/2) into STL), and the derived offset puts azimuth 225 at 315°.
    expect(axis).toBe('-z')
    expect((camera.az * 180) / Math.PI).toBeCloseTo(315, 4)
    expect((camera.el * 180) / Math.PI).toBeCloseTo(20, 4)

    // …and the pose is not persisted as the user's orientation: pixels only.
    const put = putThumb.mock.calls.at(-1)?.[0]
    expect(put?.png).toBeDefined()
    expect(put?.camera).toBeUndefined()
    expect(put?.axis).toBeUndefined()
  })

  it('a warming index becomes usable without a navigation or a reload', async () => {
    // "The interactions the app already makes" is an empty set while a user
    // waits for SigLIP: nothing they do changes the path, so an availability
    // read keyed on it never runs again and the mode never appears.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 2 })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    expect(modeButton('meaning')).toBeUndefined()

    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(modeButton('meaning')).toBeDefined()
    vi.useRealTimers()
  })

  it('meaning is not offered outside the collection, nor inside an archive', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/library', covers: ['stl'] })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    // Ready, but this directory is not one the index covers: offering the mode
    // here promises an answer the server will refuse with a 400.
    expect(modeButton('meaning')).toBeUndefined()

    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/library', covers: ['stl'] })
    await mountApp('/library/kit.zip!/parts', NESTED)
    await settle()
    await click(searchTab())
    expect(modeButton('meaning')).toBeUndefined()
  })

  it('a thumbnail cached before the pose existed is re-rendered, not kept', async () => {
    // The symptom this fixes: tiles browsed earlier stay at the default angle
    // because path+mtime still match, and the orientation appears only after
    // opening each model, when the lightbox's close persists a posed snapshot.
    // The pose is an input to the pixels that the key does not carry.
    const POSE = {
      up: [0, 1, 0] as [number, number, number],
      azimuth_zero: [1, 0, 0] as [number, number, number],
      source: 'siglip',
      confidence: 0.9,
      front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
    }
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue({
      ...MEANING,
      entries: [model('Kits/hero.stl')],
      poses: { '/models/Kits/hero.stl': POSE },
    })
    // A cached thumbnail from before: current lighting and rig, no pose.
    getThumb.mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:old',
      lighting: 'axis',
      rig: RIG_VERSION,
      posed: undefined,
    })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'hero')
    await pressEnter(searchInput())
    await settle()

    expect(renderThumbnail).toHaveBeenCalled()
    expect(putThumb.mock.calls.at(-1)?.[0]?.posed).toBe(POSE_VERSION)
  })

  it('a thumbnail the user already aimed is left alone, pose or no pose', async () => {
    // The loop this closes: a model with both an index pose and a stored camera
    // could never satisfy the staleness check. The re-render deliberately poses
    // nothing when a camera is stored (the user's orientation wins), so it PUT
    // the pixels back unlabelled — and every visit to a meaning view rendered
    // and re-uploaded the identical picture.
    const POSE = {
      up: [0, 1, 0] as [number, number, number],
      azimuth_zero: [1, 0, 0] as [number, number, number],
      source: 'siglip',
      confidence: 0.9,
      front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
    }
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue({
      ...MEANING,
      entries: [model('Kits/hero.stl')],
      poses: { '/models/Kits/hero.stl': POSE },
    })
    getThumb.mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:mine',
      lighting: 'axis',
      rig: RIG_VERSION,
      // The user's own orientation, from an earlier orbit — and no pose label,
      // because these pixels were never posed.
      camera: { az: 1, el: 0.2, distR: 2, target: [0, 0, 0] },
      axis: 'y',
      posed: undefined,
    })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'hero')
    await pressEnter(searchInput())
    await settle()

    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(putThumb).not.toHaveBeenCalled()
  })

  it('a typed parameter is one query at the end, never one per keystroke', async () => {
    // Each keystroke used to be a whole meaning query with no debounce and no
    // way to stop it — and clearing the score field asked for the entire
    // collection at score ≥ 0, since `Number('')` is 0.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const scoreBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
      (b) => b.textContent?.trim().startsWith('score'),
    )!
    await click(scoreBtn)
    await settle()
    const firstSignal = semanticSearch.mock.calls.at(-1)?.[3] as AbortSignal
    semanticSearch.mockClear()

    const score = container.querySelector<HTMLInputElement>('input[aria-label="Minimum score"]')!
    await type(score, '')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(semanticSearch).not.toHaveBeenCalled()

    await type(score, '0')
    await type(score, '0.3')
    await type(score, '0.35')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    // Mid-run: 0, and 0.3, are values on the way to the one being asked for.
    expect(semanticSearch).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(semanticSearch).toHaveBeenCalledTimes(1)
    expect(semanticSearch).toHaveBeenLastCalledWith(
      'winged demon',
      '/models',
      { ...TUNING_DEFAULTS, minScore: 0.35 },
      expect.any(AbortSignal),
    )
    // …and the query it supersedes is stopped, not merely ignored on arrival.
    expect(firstSignal.aborted).toBe(true)
    vi.useRealTimers()
  })

  it('a tuning query scheduled for a view the user has left never fires', async () => {
    // A deferred re-run belongs to the view that scheduled it. Arriving after a
    // navigation it would be the newest request, so latest-wins would give it
    // the grid and the URL — dragging the user back to the search they left.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const top = container.querySelector<HTMLInputElement>('input[aria-label="Number of results"]')!
    await type(top, '25')
    semanticSearch.mockClear()

    // Away inside the debounce window, the way a user leaves a search.
    listDir.mockResolvedValue({ path: '/models/Alpha', entries: [dir('Beta')] })
    await type(pathInput(), '/models/Alpha')
    await pressEnter(pathInput())
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(semanticSearch).not.toHaveBeenCalled()
    expect(labels()).toEqual(['Beta'])
    expect(location.search).not.toContain('mode=meaning')
    vi.useRealTimers()
  })

  it('a meaning link renders no stand-in listing while the index is being asked', async () => {
    // `?path=/library&flat=1&q=…&mode=meaning` — the flat flag belongs to the
    // search. Rendering the ordinary listing while waiting flattens the whole
    // volume, and those hundreds of tiles render and cache thumbnails at the
    // default angle moments before the meaning results arrive with
    // orientations for the same models. Nothing is fetched until the one
    // availability call answers.
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    listDir.mockClear()
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=demon&mode=meaning', NESTED)
    await settle()

    expect(listDir).not.toHaveBeenCalled()
    expect(semanticSearch).toHaveBeenCalledWith(
      'demon',
      '/models',
      TUNING_DEFAULTS,
      expect.any(AbortSignal),
    )
  })

  it('changing a parameter re-runs the committed query under it, and sticks', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const maxBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
      (b) => b.textContent?.trim() === 'max',
    )!
    await click(maxBtn)
    await settle()

    // Trying a parameter is the point: it re-runs rather than applying to some
    // later search the user has to remember to make.
    expect(semanticSearch).toHaveBeenLastCalledWith(
      'winged demon',
      '/models',
      { ...TUNING_DEFAULTS, pool: 'max' },
      expect.any(AbortSignal),
    )
    expect(location.search).toContain('pool=max')
    expect(JSON.parse(localStorage.getItem('model-browser:search-tuning')!).pool).toBe('max')
  })

  it('a tuned link reproduces the sender’s parameters, not the reader’s', async () => {
    setSearchTuning({ ...TUNING_DEFAULTS, pool: 'mean', top: 5 })
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=demon&mode=meaning&score-raw=1', NESTED)
    await settle()

    // The link carries `raw` and omits the rest: omitted means default, never
    // the reader's stored setting — the same rule the other options follow.
    expect(semanticSearch).toHaveBeenCalledWith(
      'demon',
      '/models',
      { ...TUNING_DEFAULTS, raw: true },
      expect.any(AbortSignal),
    )
  })

  it('a link opened without the index keeps naming the meaning search', async () => {
    // Substituting a name search would answer a different question unasked, and
    // rewriting the URL to name that answer would destroy the link: no retry
    // after starting the index, no help from a reload, and the substitution
    // passed on to whoever it is copied to.
    indexAvailability.mockResolvedValue({ state: 'absent' })
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=a+winged+demon&mode=meaning', NESTED)
    await settle()

    expect(location.search).toContain('mode=meaning')
    expect(location.search).toContain('q=a+winged+demon')
    expect(semanticSearch).not.toHaveBeenCalled()
    // Not a name search either — the grid is the folder, and says so.
    expect(listDir).not.toHaveBeenCalledWith('/models', expect.objectContaining({ q: 'a winged demon' }))
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
    expect(container.textContent).toContain('meaning search for')
    expect(container.textContent).toContain('not answering')
  })

  it('the deferred query runs itself once the index answers, for the view that deferred it', async () => {
    // The deferral belongs to the view that made it: it runs *there*, and every
    // way of moving on cancels it instead of carrying it along. So the index's
    // own warming poll is what delivers the answer here — this used to press a
    // folder tile, which is a navigation, and a deferral that survived one
    // dragged the user's query into the folder they had just walked into.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 2 })
    semanticSearch.mockResolvedValue(MEANING)
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=a+winged+demon&mode=meaning', NESTED)
    await settle()
    expect(semanticSearch).not.toHaveBeenCalled()

    // The index finishes starting; the next availability read finds it, and the
    // link finally does what it named without the user retyping or reloading.
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(semanticSearch).toHaveBeenCalledWith(
      'a winged demon',
      '/models',
      TUNING_DEFAULTS,
      expect.any(AbortSignal),
    )
    expect(container.textContent).toContain('Meaning matches for "a winged demon".')
    vi.useRealTimers()
  })

  it('offers the name search rather than performing it', async () => {
    indexAvailability.mockResolvedValue({ state: 'absent' })
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=widget&mode=meaning', NESTED)
    await settle()
    listDir.mockClear()

    const escape = Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find(
      (b) => b.textContent?.includes('Search names instead'),
    )!
    await click(escape)
    await settle()

    // A user action, so renaming the view is legitimate now.
    expect(listDir).toHaveBeenCalledWith(
      '/models',
      expect.objectContaining({ q: 'widget' }),
      expect.any(AbortSignal),
    )
    expect(location.search).not.toContain('mode=meaning')
  })

})
