// @vitest-environment happy-dom
// Meaning search through App: the mode, the fallback when the index is not
// there, and the reporting that makes an empty grid attributable.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RESULT_COUNT, type DirListing, type SemanticListing } from '../../shared/types'
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
/** Text-query cosines really do run this low, and these two are D4's argument
 *  made concrete: identical at two decimal places (both `0.11`) and distinct at
 *  three (`0.112`, `0.107`). At the shorter width a grid of genuinely different
 *  results asserts a tie that does not exist — which is what the third place is
 *  for. The pair used to be 0.1074/0.1068, which both render `0.107` and so
 *  illustrated nothing. */
const HERO_SCORE = { score: 0.1121, z: 3.916 }
const BASE_SCORE = { score: 0.1074, z: 2.404 }
const MEANING: SemanticListing = {
  path: '/models',
  entries: [model('Kits/Baal/hero.stl'), model('Kits/Baal/base.stl')],
  poses: {},
  // Keyed by the tile path, as the server keys them. Carried by the fixture
  // rather than left empty: a fixture with no scores lets every assertion about
  // badges pass while badges render nowhere at all.
  scores: {
    '/models/Kits/Baal/hero.stl': HERO_SCORE,
    '/models/Kits/Baal/base.stl': BASE_SCORE,
  },
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

  it('a weak set is marked as a set, whatever any one tile reports', async () => {
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
    // What this test was really guarding: the verdict is about the SET. It is
    // read off the best result before any cut, so it stands whatever the tiles
    // say — and now that they say something, that is worth asserting rather
    // than assuming. `base.stl` sits at z 2.40, above the index's own 2.0, and
    // the set is still marked weak; no tile restates or contradicts the notice.
    expect(tiles().length).toBe(2)
    expect(container.textContent).toContain('z 2.40')
  })

  it('shows each meaning result’s cosine and z, labelled `k`, and neither in a plain listing', async () => {
    // The numbers the index computed and this app used to discard. Three places
    // for the cosine because text-query values cluster near 0.1 and these two
    // hits differ in the third — at two places both would print `0.11`,
    // asserting a tie that does not exist (D4).
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const [hero, base] = tiles()
    expect(hero!.textContent).toContain('k 0.112')
    expect(hero!.textContent).toContain('z 3.92')
    // The third place is doing work, and this is where it shows: these two
    // round to the SAME `0.11` at two places and to different values at three.
    expect(base!.textContent).toContain('k 0.107')
    expect(base!.textContent).toContain('z 2.40')
    expect(hero!.textContent).not.toContain('k 0.107')
    // Spelled out where it is read aloud, never `k` on its own (D8).
    expect(hero!.getAttribute('aria-label')).toContain('cosine 0.112')
    expect(hero!.getAttribute('aria-label')).toContain('z 3.92')

    // Leaving the search returns to a listing nobody scored: no badge, and
    // nothing held in reserve for one.
    await click(searchTab())
    await click(modeButton('name')!)
    await mountApp('/models', NESTED)
    await settle()
    for (const tile of tiles()) {
      expect(tile.textContent).not.toMatch(/\bk \d/)
      expect(tile.textContent).not.toMatch(/\bz \d/)
    }
  })

  it('a tile being orbited keeps its own badges, raised above the overlay', async () => {
    // The orbit overlay is a `z-orbit-overlay` layer with an opaque background drawn
    // over the tile, so at the default z it covered the numbers for exactly as
    // long as the user was looking at the model. The tile keeps drawing them
    // and outranks it: no ancestor of a tile creates a stacking context, so the
    // badge's z and the overlay's resolve against the same root context.
    //
    // The paint order itself is not observable here — happy-dom lays nothing
    // out — so this asserts the two things that are: the tile does not yield
    // its badges, and they carry a z above the overlay's. The stacking-context
    // walk that licenses the second is recorded in `BADGE_CLASS`.
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const [hero] = tiles()
    expect(hero!.querySelectorAll('span[aria-hidden]').length).toBe(2)

    // Promote it to an orbit overlay: pointerdown on the tile is what mounts it.
    await act(async () => {
      hero!.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }),
      )
    })
    await settle()

    const overlay = container.querySelector('.fixed.z-orbit-overlay')
    expect(overlay).not.toBeNull()
    // Still drawn by the tile — one pair, the same element, never moved or
    // re-created by the press.
    const badges = hero!.querySelectorAll('span[aria-hidden]')
    expect(badges.length).toBe(2)
    for (const badge of badges) expect(badge.className).toContain('z-tile-badge')
    // The overlay draws none of its own: a second pair could not line up with
    // this one anyway, its rect being the image's square rather than the tile's.
    expect(overlay!.querySelectorAll('span[aria-hidden]').length).toBe(0)
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

  it('a running index out of range says so, rather than claiming it is stopped', async () => {
    // The bug this pins: `ready` matched none of the named states and fell to
    // the arm written for `absent`, so an index that was up — merely covering
    // another collection — reported itself as not running and told the user to
    // start it. Observed live 2026-08-26 one directory above `collectionRoot`.
    indexAvailability.mockResolvedValue({
      state: 'ready',
      collectionRoot: '/models/library',
      covers: ['stl'],
    })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())

    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('does not cover this folder')
    // Names what it *does* cover, so "why not here" is answerable from the line.
    expect(panel.textContent).toContain('/models/library')
    // The whole point: the false claim, and the advice that would do nothing.
    expect(panel.textContent).not.toContain('not running')
    expect(panel.textContent).not.toContain('start the index')
  })

  it('names the collection as a library path, which is a place the user can go', async () => {
    // library-root D6: what the index publishes is its own absolute root, and
    // what reaches the client is that root as a library path — so the sentence
    // names somewhere the path bar accepts rather than a mount point.
    indexAvailability.mockResolvedValue({
      state: 'ready',
      collectionRoot: '/kits',
      covers: ['stl'],
    })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())

    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('It covers /kits.')
  })

  it('says what the index covers when it covers nothing here, and names no path', async () => {
    // A collection outside the library has no library path at all. The server
    // sends the reason instead of an absolute root, and the panel says it —
    // naming a path nothing in this app could navigate to is the thing being
    // avoided (D6).
    indexAvailability.mockResolvedValue({
      state: 'ready',
      covers: ['stl'],
      detail: 'the index covers a location outside the library',
    })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())

    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('the index covers a location outside the library')
    // No root, so nothing to point at — the "It covers …" clause is withheld
    // rather than rendered around an undefined.
    expect(panel.textContent).not.toContain('It covers')
    // And with it every scope affordance: `indexCovers` is false without a
    // root, so meaning search is not offered here or anywhere.
    expect(modeButton('meaning')).toBeUndefined()
  })

  it('inside an archive it blames archives, not the folder', async () => {
    // `indexCovers` refuses `!/` outright, so a zip interior is out of range
    // even within the collection — a different fact from being outside it, and
    // one no `collectionRoot` would explain.
    indexAvailability.mockResolvedValue({
      state: 'ready',
      collectionRoot: '/models',
      covers: ['stl'],
    })
    await mountApp('/models/kit.zip!/parts', NESTED)
    await settle()
    await click(searchTab())

    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('does not cover the inside of archives')
    expect(panel.textContent).not.toContain('not running')
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

  it('the bounds switch independently, and a bound sent away keeps its value', async () => {
    // Three states, not two: count only, floor only, both. The old control was
    // exclusive and disabled the loser's field, which drew a relationship the
    // index no longer has (design D6).
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    setSearchTuning({ ...TUNING_DEFAULTS, top: 42 })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const topBtn = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
        (b) => b.textContent?.trim() === 'top',
      )!
    const scoreBtn = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
        (b) => b.textContent?.trim().startsWith('score'),
      )!
    const topField = () =>
      container.querySelector<HTMLInputElement>('input[aria-label="Number of results"]')!
    const scoreField = () =>
      container.querySelector<HTMLInputElement>('input[aria-label="Minimum score"]')!

    // Resting state: both in force, both fields live.
    expect(topBtn().getAttribute('aria-pressed')).toBe('true')
    expect(scoreBtn().getAttribute('aria-pressed')).toBe('true')
    expect(topField().disabled).toBe(false)
    expect(scoreField().disabled).toBe(false)

    // Send the count away: floor only, and the query re-runs without a `top`.
    await click(topBtn())
    await settle()
    expect(semanticSearch).toHaveBeenLastCalledWith(
      'winged demon',
      '/models',
      { raw: false, pool: 'softmax', minScore: TUNING_DEFAULTS.minScore },
      expect.any(AbortSignal),
    )
    expect(topField().disabled).toBe(true)
    // Remembered, not discarded — the spec asks for the value back.
    expect(topField().value).toBe('42')
    // And the floor's own button is now inert: an unbounded meaning search is
    // the whole collection, which no control here should be able to ask for.
    expect(scoreBtn().disabled).toBe(true)

    // Bring it back and the remembered count is what returns.
    await click(topBtn())
    await settle()
    expect(semanticSearch).toHaveBeenLastCalledWith(
      'winged demon',
      '/models',
      { raw: false, pool: 'softmax', top: 42, minScore: TUNING_DEFAULTS.minScore },
      expect.any(AbortSignal),
    )

    // The other direction: floor away, count alone.
    await click(scoreBtn())
    await settle()
    expect(semanticSearch).toHaveBeenLastCalledWith(
      'winged demon',
      '/models',
      { raw: false, pool: 'softmax', top: 42 },
      expect.any(AbortSignal),
    )
    expect(scoreField().disabled).toBe(true)
    expect(scoreField().value).toBe(String(TUNING_DEFAULTS.minScore))

    // Reported from the running app: with one bound in force, which one was
    // unreadable. The sole survivor's button is inert (it cannot be switched
    // off) and the first version dimmed it for being disabled, so the bound
    // actually in force rendered fainter than the one that was not — and the
    // focus ring left on the just-clicked button read as the selection. The
    // in-force button must carry the on-state and never the dimming, whether
    // or not it is inert.
    expect(topBtn().className).toContain('bg-zinc-800')
    expect(topBtn().className).toContain('text-zinc-100')
    expect(topBtn().className).not.toContain('opacity-60')
    expect(scoreBtn().className).not.toContain('bg-zinc-800')
    expect(scoreBtn().className).toContain('text-zinc-500')
  })

  it('a typed bound reaches the URL, once, when the typing stops', async () => {
    // Found in the E2E pass: typing a count re-ran the query and relabelled the
    // grid while the URL kept saying nothing, so the view was bounded by a count
    // its own link did not carry. The record rule is not substrate-specific —
    // a bound in force is named wherever the view is recorded.
    //
    // Both halves matter and they pull against each other: the value has to
    // land, and it must not land once per keystroke (R3's fence). That is why
    // the deferred path records first and commits later, and why the fix was to
    // stop the *record* from being mistaken for a projection.
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

    const entriesBefore = history.length
    const top = container.querySelector<HTMLInputElement>('input[aria-label="Number of results"]')!
    for (const v of ['1', '12', '125']) {
      await type(top, v)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
    }
    // Mid-typing the URL says nothing yet — the fence holding.
    expect(new URLSearchParams(location.search).get('top')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    await settle()
    expect(new URLSearchParams(location.search).get('top')).toBe('125')
    // The floor is in force too, so the link names it as well.
    expect(new URLSearchParams(location.search).get('min')).toBe(String(TUNING_DEFAULTS.minScore))
    // Three keystrokes, one entry.
    expect(history.length).toBe(entriesBefore + 1)
  })

  it('Back returns the bounds the entry was written under', async () => {
    // The other half of the typed-bound fix: an entry is only worth writing if
    // going back to it restores what it named. Plays the browser the way the
    // lightbox history tests do — rewind the address bar, then fire popstate.
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

    const top = () => container.querySelector<HTMLInputElement>('input[aria-label="Number of results"]')!
    const restingUrl = location.search
    await type(top(), '15')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    await settle()
    expect(new URLSearchParams(location.search).get('top')).toBe('15')

    // Blur first: while the field is focused it shows the text being typed, not
    // the bound in force, and that override would mask what the view holds.
    await act(async () => {
      top().focus()
      top().blur()
    })
    window.history.replaceState(null, '', restingUrl)
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await settle()
    expect(top().value).toBe(String(TUNING_DEFAULTS.top))
    // The discriminating half. Before the count became part of the question,
    // this restore took `restore`'s patch branch: the field updated and no
    // re-ask went out, so the grid kept the previous count's results under a URL
    // naming the new one — the exact failure the `similar` branch already
    // guarded `k` and `pool` against.
    expect(semanticSearch.mock.calls.at(-1)?.[2]).toMatchObject({ top: TUNING_DEFAULTS.top })
  })

  it('offers the reset exactly when a bound or a parameter is off its default', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()

    const resetLink = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find((b) =>
        b.textContent?.trim().startsWith('Reset tuning'),
      )
    // Resting state is both bounds at their defaults, so there is nothing to
    // reset — the affordance is the answer to "is this view tuned?".
    expect(resetLink()).toBeUndefined()

    // A bound going out of force is off-default even though the bound that
    // remains still sits at its own default value.
    const topBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
      (b) => b.textContent?.trim() === 'top',
    )!
    await click(topBtn)
    await settle()
    expect(resetLink()).toBeDefined()

    await click(resetLink()!)
    await settle()
    expect(resetLink()).toBeUndefined()
    expect(semanticSearch).toHaveBeenLastCalledWith(
      'winged demon',
      '/models',
      { ...TUNING_DEFAULTS },
      expect.any(AbortSignal),
    )
  })

  it('a count past the index’s ceiling is clamped in the field, not just on the wire', async () => {
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
    await type(top, '5000')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await settle()
    expect(semanticSearch.mock.calls.at(-1)?.[2]).toMatchObject({ top: MAX_RESULT_COUNT })
    // The field shows what was stored rather than what was typed: a count above
    // the ceiling names a set the index will not return.
    await act(async () => {
      top.focus()
      top.blur()
    })
    expect(top.value).toBe(String(MAX_RESULT_COUNT))
  })

  it('says what the count cut from, and says nothing when the index did not report it', async () => {
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    semanticSearch.mockResolvedValue({ ...MEANING, matched: 875 })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'winged demon')
    await pressEnter(searchInput())
    await settle()
    expect(container.textContent).toContain(`Showing ${MEANING.entries.length} of 875`)

    // Absent `matched` is the index not saying, which is not a zero and not a
    // number this app may compute: what arrived has already been cut.
    semanticSearch.mockResolvedValue(MEANING)
    await type(searchInput(), 'winged demon two')
    await pressEnter(searchInput())
    await settle()
    expect(container.textContent).not.toContain('above the floor')

    // And with no count in force it stays silent even though `matched` exceeds
    // what came back: in the floor-only state the set is short because the
    // index's cap bit, the notice above already says so, and repeating it here
    // would credit that cut to a bound nobody set. Caught in the E2E pass,
    // where both sentences appeared side by side.
    semanticSearch.mockResolvedValue({ ...MEANING, matched: 755, capped: true })
    const boundBtn = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find((b) =>
        b.textContent?.trim().startsWith(label),
      )!
    await click(boundBtn('top'))
    await settle()
    expect(container.textContent).toContain('The index returned fewer than asked for')
    expect(container.textContent).not.toContain('above the floor')

    // The other single-bound state, and the cell this test used to leave out.
    // With the count in force and no floor, `matched` is not a floor set at
    // all: the index reports it on every response, and floorless it counts
    // everything it scored. Speaking here would name a floor nobody set and
    // call the whole collection its result.
    //
    // The mock is armed *before* the clicks, not after: each click re-asks, so
    // a response staged afterwards is never fetched and the assertion below
    // would be checking the previous landing — true, and vacuously so.
    semanticSearch.mockResolvedValue({ ...MEANING, matched: 2165 })
    await click(boundBtn('top'))
    await settle()
    await click(boundBtn('score'))
    await settle()
    // Count-only reached, asserted off the controls rather than off the last
    // request: the re-ask is issued a tick later than the state change, so
    // reading `mock.calls` here races it (it passed only while a `console.log`
    // sat in front of it, which is the tell).
    expect(boundBtn('top').getAttribute('aria-pressed')).toBe('true')
    expect(boundBtn('score').getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toContain('above the floor')
    expect(container.textContent).not.toContain('2165')
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
