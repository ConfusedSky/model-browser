// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  deepButton,
  dir,
  getThumb,
  labels,
  listDir,
  model,
  mountApp,
  pathInput,
  pressEnter,
  searchInput,
  settle,
  tiles,
  type,
  unmountApp,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), dir('Bravo'), model('widget.stl')],
}
const SEARCH_RESULT: DirListing = {
  path: '/models',
  entries: [model('a/found.stl'), model('b/foundation.stl')],
  truncated: true,
}
// A folder search's results: containers named by relative path, like the models.
const FOLDER_RESULT: DirListing = {
  path: '/models',
  entries: [dir('Sets/Sandy Dunes'), model('Sets/Sandy Dunes/base.stl')],
  truncated: true,
}
const NO_MATCHES: DirListing = { path: '/models', entries: [] }
const NO_MATCHES_TRUNCATED: DirListing = { path: '/models', entries: [], truncated: true }

beforeEach(() => mountApp('/models', NESTED))
afterEach(() => unmountApp())

describe('file name search', () => {
  it('typing filters every entry kind by full name, with no requests; erasing restores', async () => {
    listDir.mockClear()

    await type(searchInput(), 'ravo')
    expect(labels()).toEqual(['Bravo'])
    expect(listDir).not.toHaveBeenCalled()

    await type(searchInput(), '')
    expect(labels()).toEqual(['Alpha', 'Bravo', 'widget.stl'])
    expect(listDir).not.toHaveBeenCalled()
  })

  it('thumbnails are not reset by typing a filter keystroke', async () => {
    await settle()
    const before = getThumb.mock.calls.length

    await type(searchInput(), 'ravo')
    await settle()

    expect(getThumb.mock.calls.length).toBe(before)
  })

  it('deep search submits q and renders relative-path results with the truncation notice', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) =>
      Promise.resolve(target === '/models' && opts?.flat === true && opts?.q === 'found' ? SEARCH_RESULT : NESTED),
    )

    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models', { flat: true, q: 'found' })
    expect(labels()).toEqual(['found.stl', 'foundation.stl'])
    expect(container.textContent).toContain('omitted')
    expect(container.textContent).toContain('Search results for "found".')
  })

  it('the Deep button also submits the committed query', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) =>
      Promise.resolve(target === '/models' && opts?.flat === true && opts?.q === 'found' ? SEARCH_RESULT : NESTED),
    )

    await type(searchInput(), 'found')
    await click(deepButton())
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models', { flat: true, q: 'found' })
    expect(labels()).toEqual(['found.stl', 'foundation.stl'])
  })

  it('editing text over deep-search results filters them client-side, without a new request', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) =>
      Promise.resolve(target === '/models' && opts?.flat === true && opts?.q === 'found' ? SEARCH_RESULT : NESTED),
    )
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    listDir.mockClear()

    await type(searchInput(), 'a/found')

    expect(labels()).toEqual(['found.stl'])
    expect(listDir).not.toHaveBeenCalled()
  })

  it('clearing a committed query re-requests the plain listing for the flat toggle in effect', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) =>
      Promise.resolve(target === '/models' && opts?.flat === true && opts?.q === 'found' ? SEARCH_RESULT : NESTED),
    )
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    listDir.mockClear()

    await type(searchInput(), '')
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models', { flat: false })
    expect(labels()).toEqual(['Alpha', 'Bravo', 'widget.stl'])
    expect(container.textContent).not.toContain('Search results for')
  })

  it('a search submitted mid-navigation targets the in-flight destination', async () => {
    let resolveNav!: (v: DirListing) => void
    const pendingNav = new Promise<DirListing>((resolve) => {
      resolveNav = resolve
    })
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) => {
      if (target === '/models/Alpha' && opts?.flat !== true) return pendingNav
      if (target === '/models/Alpha' && opts?.flat === true && opts?.q === 'found')
        return Promise.resolve({ path: '/models/Alpha', entries: [model('found.stl')] })
      return Promise.reject(new Error(`unexpected listDir(${target}, ${JSON.stringify(opts)})`))
    })

    await click(container.querySelector<HTMLButtonElement>('main button')!) // navigate into Alpha — left pending
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models/Alpha', { flat: true, q: 'found' })
    expect(labels()).toEqual(['found.stl'])

    resolveNav(NESTED) // the abandoned nested navigation finally lands — superseded
    await settle()
    expect(labels()).toEqual(['found.stl'])
  })

  it('a superseding navigation discards a late search response', async () => {
    let resolveSearch!: (v: DirListing) => void
    const pendingSearch = new Promise<DirListing>((resolve) => {
      resolveSearch = resolve
    })
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) => {
      if (target === '/models' && opts?.q === 'found') return pendingSearch
      if (target === '/models/Alpha') return Promise.resolve({ path: '/models/Alpha', entries: [dir('sub')] })
      return Promise.reject(new Error(`unexpected listDir(${target}, ${JSON.stringify(opts)})`))
    })

    await type(searchInput(), 'found')
    await pressEnter(searchInput()) // search left pending
    // Navigate away via the path bar rather than a tile click: the stale
    // grid's tiles do not match 'found' and are themselves hidden by the
    // still-typed filter text while the search is in flight.
    await type(pathInput(), '/models/Alpha')
    await pressEnter(pathInput())
    await settle()

    expect(labels()).toEqual(['sub'])
    expect(container.textContent).not.toContain('Search results for')

    resolveSearch(SEARCH_RESULT) // the abandoned search finally lands — must not clobber the new grid
    await settle()

    expect(labels()).toEqual(['sub'])
    expect(container.textContent).not.toContain('Search results for')
  })

  it('a deep-search folder tile is labeled by its own name, with the path in the title', async () => {
    // Containers used to be root children with bare names; a folder match now
    // carries a relative path, and truncating that in a tile shows the head of
    // the path rather than the folder the user searched for.
    listDir.mockImplementation((_t: string, opts?: { q?: string }) =>
      Promise.resolve(opts?.q === 'sandy' ? FOLDER_RESULT : NESTED),
    )

    await type(searchInput(), 'sandy')
    await pressEnter(searchInput())
    await settle()

    expect(labels()).toEqual(['Sandy Dunes', 'base.stl'])
    expect(tiles().map((b) => b.getAttribute('title'))).toEqual([
      'Sets/Sandy Dunes',
      'Sets/Sandy Dunes/base.stl',
    ])
  })

  it('the truncation notice counts containers too, so folders-only truncation is not a claim about models', async () => {
    listDir.mockImplementation((_t: string, opts?: { q?: string }) =>
      Promise.resolve(opts?.q === 'sandy' ? FOLDER_RESULT : NESTED),
    )

    await type(searchInput(), 'sandy')
    await pressEnter(searchInput())
    await settle()

    expect(container.textContent).toContain('Showing 1 models and 1 folders; some entries were omitted.')
  })

  it('a deep search with no matches says so, distinct from a filter hiding everything', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) =>
      Promise.resolve(target === '/models' && opts?.flat === true && opts?.q === 'zzz' ? NO_MATCHES : NESTED),
    )

    await type(searchInput(), 'zzz')
    await pressEnter(searchInput())
    await settle()

    expect(container.textContent).toContain('Nothing matched "zzz".')
    expect(container.textContent).not.toContain('The filter is hiding')

    // Clear the no-match search and instead filter the original listing down
    // to nothing — a different sentence, since the entries are still loaded.
    await type(searchInput(), '')
    await settle()
    listDir.mockClear()
    await type(searchInput(), 'zzz')

    expect(listDir).not.toHaveBeenCalled()
    expect(container.textContent).toContain('The filter is hiding everything below.')
    expect(container.textContent).not.toContain('Nothing matched "zzz".')
  })

  it('a failed search leaves no results label over the listing it never replaced', async () => {
    listDir.mockImplementation((_target: string, opts?: { q?: string }) =>
      opts?.q === undefined ? Promise.resolve(NESTED) : Promise.reject(new Error('walk exploded')),
    )

    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()

    // The grid is still the pre-search listing (narrowed by the live filter
    // text, which is the filter working) — so nothing may call it results.
    expect(container.textContent).toContain('walk exploded')
    expect(container.textContent).not.toContain('Search results for')
    expect(labels()).toEqual(['widget.stl'])
  })

  it('a failed search reverts the label to the results still on screen', async () => {
    listDir.mockImplementation((_target: string, opts?: { q?: string }) => {
      if (opts?.q === 'found') return Promise.resolve(SEARCH_RESULT)
      if (opts?.q === undefined) return Promise.resolve(NESTED)
      return Promise.reject(new Error('walk exploded'))
    })

    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(container.textContent).toContain('Search results for "found".')

    // A second search fails: the first search's results are what remains on
    // screen, so the label goes back to naming them — not to naming nothing.
    await type(searchInput(), 'boom')
    await pressEnter(searchInput())
    await settle()

    expect(container.textContent).toContain('walk exploded')
    expect(container.textContent).toContain('Search results for "found".')
    expect(container.textContent).not.toContain('Search results for "boom"')
  })

  it('a truncated empty search says it ran out, never "no models matched"', async () => {
    listDir.mockImplementation((_target: string, opts?: { q?: string }) =>
      Promise.resolve(opts?.q === undefined ? NESTED : NO_MATCHES_TRUNCATED),
    )

    await type(searchInput(), 'buried')
    await pressEnter(searchInput())
    await settle()

    // The walk never finished, so "no match" would be a false claim (D5) —
    // and the generic "some were omitted" notice stays out of the way too.
    expect(container.textContent).toContain('ran out of budget')
    // Both empty states now open with "Nothing matched" — the completed-search
    // one ends the sentence at the query, the truncated one keeps going.
    expect(container.textContent).not.toContain('Nothing matched "buried".')
    expect(container.textContent).not.toContain('omitted')
  })

  it('overlapping failed searches revert the label to the search that actually landed', async () => {
    let failB!: (e: Error) => void
    let failC!: (e: Error) => void
    listDir.mockImplementation((_target: string, opts?: { q?: string }) => {
      if (opts?.q === 'found') return Promise.resolve(SEARCH_RESULT)
      if (opts?.q === 'bee') return new Promise<DirListing>((_res, rej) => (failB = rej))
      if (opts?.q === 'cee') return new Promise<DirListing>((_res, rej) => (failC = rej))
      return Promise.resolve(NESTED)
    })

    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(container.textContent).toContain('Search results for "found".')

    // Two searches go up while "found"'s results are on screen; both fail.
    // The superseded first failure must be a no-op, and the second must revert
    // the label to the search that landed — never to the optimistic "bee".
    await type(searchInput(), 'bee')
    await pressEnter(searchInput())
    await type(searchInput(), 'cee')
    await pressEnter(searchInput())
    failB(new Error('b exploded'))
    await settle()
    expect(container.textContent).not.toContain('b exploded') // superseded error stays buried

    failC(new Error('c exploded'))
    await settle()
    expect(container.textContent).toContain('c exploded')
    expect(container.textContent).toContain('Search results for "found".')
    expect(container.textContent).not.toContain('Search results for "bee"')
    expect(container.textContent).not.toContain('Search results for "cee"')
  })

  it('a whitespace-only filter is no filter, not a filter that hides everything', async () => {
    listDir.mockClear()

    await type(searchInput(), '   ')
    await settle()

    expect(labels()).toEqual(['Alpha', 'Bravo', 'widget.stl'])
    expect(container.textContent).not.toContain('The filter is hiding')
    expect(listDir).not.toHaveBeenCalled()
  })

  it('ignores whitespace around a filter, so a trailing space keeps matching', async () => {
    await type(searchInput(), 'ravo ')
    expect(labels()).toEqual(['Bravo'])
  })
})
