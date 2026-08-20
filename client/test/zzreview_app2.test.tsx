// @vitest-environment happy-dom
// SCRATCH — review only: history and availability re-reads.
import { act } from 'react'
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
const MEANING: SemanticListing = {
  path: '/models',
  entries: [model('Kits/Baal/hero.stl'), model('Kits/Baal/base.stl')],
  poses: {},
  scope: { path: null, status: 'indexed', indexed: 2801, scanned: 2801, covers: ['stl'] },
  weak: false,
}
const READY = { state: 'ready' as const, collectionRoot: '/models', covers: ['stl'] }

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
const pop = (url: string) =>
  act(async () => {
    window.history.replaceState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
})
afterEach(() => unmountApp())

describe('review 2', () => {
  it('F: forward into a meaning view restores the meaning search, not a name search', async () => {
    indexAvailability.mockResolvedValue(READY)
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    listDir.mockImplementation(() => Promise.resolve({ path: '/models', entries: [model('n.stl')] }))

    await type(searchInput(), 'dragon')
    await pressEnter(searchInput())
    await settle()
    const nameUrl = location.search
    await click(modeButton('meaning')!)
    await settle()
    const meaningUrl = location.search
    expect(labels()).toEqual(['hero.stl', 'base.stl'])

    await pop(nameUrl) // back
    await settle()
    await pop(meaningUrl) // forward
    await settle()
    console.log(
      'F: url =',
      location.search,
      '| labels =',
      JSON.stringify(labels()),
      '| meaning btn pressed =',
      modeButton('meaning')?.getAttribute('aria-pressed'),
      '| label =',
      container.querySelector('main p')?.textContent,
    )
    expect(labels()).toEqual(['hero.stl', 'base.stl'])
  })

  it('G: a warming index becomes usable without a reload', async () => {
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 3 })
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    expect(modeButton('meaning')).toBeUndefined()
    // The index finishes loading. Nothing else happens: the user waits.
    indexAvailability.mockResolvedValue(READY)
    await settle()
    await settle()
    await settle()
    console.log('G: availability reads =', indexAvailability.mock.calls.length)
    expect(modeButton('meaning')).toBeDefined()
  }, 20000)
})
