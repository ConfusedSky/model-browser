// @vitest-environment happy-dom
// SCRATCH — review only.
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

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
})
afterEach(() => unmountApp())

describe('review', () => {
  it('A: a meaning URL reproduces the meaning search when the index IS available', async () => {
    indexAvailability.mockResolvedValue(READY)
    semanticSearch.mockResolvedValue(MEANING)
    listDir.mockImplementation(() => Promise.resolve(NESTED))
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=dragon&mode=meaning', NESTED)
    await settle()
    await settle()
    console.log(
      'A: semanticSearch calls',
      semanticSearch.mock.calls.length,
      '| fellback msg?',
      container.textContent?.includes('searching by name instead'),
      '| labels',
      JSON.stringify(labels()),
    )
    expect(semanticSearch).toHaveBeenCalledWith('dragon', '/models')
  })

  it('B: a stored meaning preference survives a reload when the index is ready', async () => {
    indexAvailability.mockResolvedValue(READY)
    semanticSearch.mockResolvedValue(MEANING)
    setSearchMode('meaning')
    await mountApp('/models', NESTED)
    await settle()
    await settle()
    await click(searchTab())
    const pressed = modeButton('meaning')?.getAttribute('aria-pressed')
    console.log(
      'B: meaning pressed =',
      pressed,
      '| fellback msg?',
      container.textContent?.includes('searching by name instead'),
    )
    expect(pressed).toBe('true')
  })

  it('C: the fallback message does not appear when the index is ready', async () => {
    indexAvailability.mockResolvedValue(READY)
    setSearchMode('meaning')
    await mountApp('/models', NESTED)
    await settle()
    await settle()
    expect(container.textContent).not.toContain('searching by name instead')
  })

  it('D: back from a meaning view to a name view of the same text restores the name search', async () => {
    indexAvailability.mockResolvedValue(READY)
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    listDir.mockImplementation(() => Promise.resolve({ path: '/models', entries: [model('n.stl')] }))

    // name search first
    await type(searchInput(), 'dragon')
    await pressEnter(searchInput())
    await settle()
    expect(labels()).toEqual(['n.stl'])

    // flip to meaning: same text, other corpus
    await click(modeButton('meaning')!)
    await settle()
    expect(labels()).toEqual(['hero.stl', 'base.stl'])

    // browser back
    const target = '/?path=%2Fmodels&flat=1&q=dragon'
    await act(async () => {
      window.history.replaceState(null, '', target)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await settle()
    console.log('D: after back, labels =', JSON.stringify(labels()), 'url =', location.search)
    expect(labels()).toEqual(['n.stl'])
  })

  it('E: leaving a meaning search clears the index scope line from the panel', async () => {
    indexAvailability.mockResolvedValue(READY)
    semanticSearch.mockResolvedValue(MEANING)
    await mountApp('/models', NESTED)
    await settle()
    await click(searchTab())
    await click(modeButton('meaning')!)
    await type(searchInput(), 'dragon')
    await pressEnter(searchInput())
    await settle()
    expect(container.textContent).toContain('2801 models indexed')
    await type(searchInput(), '')
    await settle()
    console.log('E: panel still says indexed?', container.textContent?.includes('models indexed'))
    expect(container.textContent).not.toContain('2801 models indexed')
  })
})

import { act } from 'react'
