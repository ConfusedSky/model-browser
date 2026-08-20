// @vitest-environment happy-dom
// Search options end to end through App: persistence, the URL, the re-issue
// asymmetry (matching is a server predicate, kind is a view filter), and the
// rule that a shared link governs its view without rewriting your settings.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import { setFolderMatchingEnabled, setSearchKinds } from '../src/lib/searchOptions'
import {
  click,
  container,
  dir,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
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

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const RESULTS: DirListing = {
  path: '/models',
  entries: [dir('Sets/Sandy'), model('Sets/Sandy/base.stl'), model('Sets/Sandy/body.stl')],
}

function panelButton(label: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(`aside button[aria-label="${label}"]`)!
}
function kindButton(kind: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find(
    (b) => b.textContent?.trim().toLowerCase() === kind,
  )!
}
function searchTab(): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('aside [role="tab"]')).find((b) =>
    b.textContent?.toLowerCase().startsWith('search'),
  )!
}

beforeEach(async () => {
  localStorage.clear()
  // The options module holds its value in a closure, so clearing storage does
  // not reset it — a real reload would. Put both back to their defaults, or a
  // test inherits whatever the previous one set.
  setFolderMatchingEnabled(true)
  setSearchKinds('both')
  localStorage.clear()
  history.replaceState(null, '', '/')
  await mountApp('/models', NESTED)
  listDir.mockImplementation((_t: string, opts?: { q?: string }) =>
    Promise.resolve(opts?.q === 'sandy' ? RESULTS : NESTED),
  )
  await click(searchTab())
})

afterEach(() => unmountApp())

describe('search options', () => {
  it('sends the option only when it is off, and records it in the URL only then', async () => {
    await type(searchInput(), 'sandy')
    await pressEnter(searchInput())
    await settle()
    expect(location.search).not.toContain('nofolders')
    expect(listDir).toHaveBeenLastCalledWith('/models', {
      flat: true,
      q: 'sandy',
      folderMatching: undefined,
    })

    listDir.mockClear()
    await click(panelButton('Match folder names'))
    await settle()

    expect(listDir).toHaveBeenLastCalledWith('/models', {
      flat: true,
      q: 'sandy',
      folderMatching: false,
    })
    expect(location.search).toContain('nofolders=1')
    expect(localStorage.getItem('model-browser:search-folder-matching')).toBe('off')
  })

  it('the kind option re-presents without a request', async () => {
    await type(searchInput(), 'sandy')
    await pressEnter(searchInput())
    await settle()
    listDir.mockClear()

    await click(kindButton('models'))
    await settle()

    expect(listDir).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Sets/Sandy<')
    expect(location.search).toContain('kinds=models')
  })

  it('a link governs its view without rewriting stored preferences', async () => {
    await unmountApp()
    localStorage.setItem('model-browser:search-folder-matching', 'on')
    setFolderMatchingEnabled(true)
    listDir.mockImplementation(() => Promise.resolve(RESULTS))
    // The deep-link boot path: mountApp resets the URL, so the harness has its
    // own entry point for a link that is already in place.
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=sandy&nofolders=1', RESULTS)
    await settle()

    // The link's option governed the request…
    expect(listDir).toHaveBeenCalledWith('/models', {
      flat: true,
      q: 'sandy',
      folderMatching: false,
    })
    // …and left this profile's stored preference alone.
    expect(localStorage.getItem('model-browser:search-folder-matching')).toBe('on')
  })

  it('options survive to the next search in this profile', async () => {
    await click(panelButton('Match folder names'))
    await settle()
    listDir.mockClear()

    await type(searchInput(), 'sandy')
    await pressEnter(searchInput())
    await settle()

    expect(listDir).toHaveBeenLastCalledWith('/models', {
      flat: true,
      q: 'sandy',
      folderMatching: false,
    })
  })

  it('a kind restriction that empties the grid says so, distinctly from the filter', async () => {
    listDir.mockImplementation((_t: string, opts?: { q?: string }) =>
      Promise.resolve(
        opts?.q === 'onlymodels'
          ? { path: '/models', entries: [model('a/onlymodels.stl')] }
          : NESTED,
      ),
    )
    await type(searchInput(), 'onlymodels')
    await pressEnter(searchInput())
    await settle()
    // The committed text stays in the input and still filters (that coupling is
    // find-in-listing's to break), so the fixture matches it, as a real name
    // search's results necessarily do.
    expect(container.textContent).not.toContain('The filter is hiding')

    await click(kindButton('folders'))
    await settle()

    expect(container.textContent).toContain('No folders matched')
    expect(container.textContent).not.toContain('The filter is hiding')
    // The truncation notice, when present, keeps describing the underlying
    // listing rather than this restricted view (D3).
    expect(container.textContent).not.toContain('Nothing matched')
  })

  it('a link without options reproduces the sender\u2019s view, not the recipient\u2019s settings', async () => {
    // The bug this pins: the sender\u2019s options were the defaults, so the URL
    // carries none — and a recipient whose stored options differ must still see
    // what was sent. Absent means default, not "mine".
    await unmountApp()
    setFolderMatchingEnabled(false)
    setSearchKinds('folders')
    listDir.mockImplementation(() => Promise.resolve(RESULTS))

    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=sandy', RESULTS)
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models', {
      flat: true,
      q: 'sandy',
      folderMatching: undefined,
    })
    // …and the recipient's kind preference does not hide the models either.
    expect(container.querySelectorAll('main button[data-model-tile]').length).toBe(2)
  })

  it('history restores the options the entry ran under', async () => {
    await type(searchInput(), 'sandy')
    await pressEnter(searchInput())
    await settle()
    await click(panelButton('Match folder names'))
    await settle()
    expect(location.search).toContain('nofolders=1')

    listDir.mockClear()
    // Play the browser, as urlLightbox.test.tsx does: the harness stubs `URL`
    // for object URLs, which happy-dom's own history.back() needs.
    await act(async () => {
      history.replaceState(null, '', '/?path=/models&flat=1&q=sandy')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await settle()

    // The two entries differ only by an option, which is exactly the case a
    // path/flat/q comparison misses: Back must re-request under the restored
    // option rather than leave the grid as it is.
    expect(location.search).not.toContain('nofolders')
    expect(listDir).toHaveBeenLastCalledWith('/models', {
      flat: true,
      q: 'sandy',
      folderMatching: undefined,
    })
    expect(panelButton('Match folder names').getAttribute('aria-checked')).toBe('true')
  })

  it('leaving a link\u2019s view restores this profile\u2019s own options', async () => {
    await unmountApp()
    setFolderMatchingEnabled(true)
    setSearchKinds('both')
    listDir.mockImplementation((_t: string, opts?: { q?: string }) =>
      Promise.resolve(opts?.q === 'sandy' ? RESULTS : NESTED),
    )
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=sandy&nofolders=1', RESULTS)
    await settle()
    // unmountApp cleared storage, so the panel is back on its default tab.
    await click(searchTab())
    expect(panelButton('Match folder names').getAttribute('aria-checked')).toBe('false')

    // Navigate away by entering the folder the search returned — the grid holds
    // the link's results, not the directory listing, so there is no 'Alpha' here.
    await click(tiles().find((b) => !b.hasAttribute('data-model-tile'))!)
    await settle()

    expect(panelButton('Match folder names').getAttribute('aria-checked')).toBe('true')
  })

  it('a plain listing carries no options, whatever they are set to', async () => {
    await click(kindButton('folders'))
    await settle()
    expect(location.search).not.toContain('kinds')
  })
})
