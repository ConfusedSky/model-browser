// @vitest-environment happy-dom
// Meaning search through App: the mode, the fallback when the index is not
// there, and the reporting that makes an empty grid attributable.
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
  pressEnter,
  putThumb,
  renderThumbnail,
  searchInput,
  semanticSearch,
  settle,
  type,
  unmountApp,
} from './appHarness'
import { setSearchMode } from '../src/lib/searchOptions'

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

    expect(semanticSearch).toHaveBeenCalledWith('a winged demon', '/models')
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

    expect(semanticSearch).toHaveBeenCalledWith('winged demon', '/models')
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
    expect(listDir).toHaveBeenCalledWith('/models', expect.objectContaining({ q: 'widget' }))
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
    // y-up: the derived offset puts azimuth 225 at 315°, not at 225°.
    expect(axis).toBe('y')
    expect((camera.az * 180) / Math.PI).toBeCloseTo(315, 4)
    expect((camera.el * 180) / Math.PI).toBeCloseTo(20, 4)

    // …and the pose is not persisted as the user's orientation: pixels only.
    const put = putThumb.mock.calls.at(-1)?.[0]
    expect(put?.png).toBeDefined()
    expect(put?.camera).toBeUndefined()
    expect(put?.axis).toBeUndefined()
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

  it('the deferred query runs itself once the index answers', async () => {
    indexAvailability.mockResolvedValue({ state: 'absent' })
    semanticSearch.mockResolvedValue(MEANING)
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=a+winged+demon&mode=meaning', NESTED)
    await settle()
    expect(semanticSearch).not.toHaveBeenCalled()

    // The index starts; the next availability read finds it, and the link
    // finally does what it named without the user retyping or reloading.
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    await click(container.querySelector<HTMLButtonElement>('main .grid button')!)
    await settle()

    expect(semanticSearch).toHaveBeenCalledWith('a winged demon', expect.any(String))
    expect(container.textContent).toContain('Meaning matches for "a winged demon".')
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
    expect(listDir).toHaveBeenCalledWith('/models', expect.objectContaining({ q: 'widget' }))
    expect(location.search).not.toContain('mode=meaning')
  })

})
