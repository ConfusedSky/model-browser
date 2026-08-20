// @vitest-environment happy-dom
// Meaning search through App: the mode, the fallback when the index is not
// there, and the reporting that makes an empty grid attributable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing, SemanticListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  indexAvailability,
  labels,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pressEnter,
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

  it('a linked meaning search on a machine without the index falls back and says so', async () => {
    indexAvailability.mockResolvedValue({ state: 'absent' })
    listDir.mockImplementation(() => Promise.resolve(NESTED))
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=dragon&mode=meaning', NESTED)
    await settle()

    expect(semanticSearch).not.toHaveBeenCalled()
    expect(container.textContent).toContain('searching by name instead')
  })
})
