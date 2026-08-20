// @vitest-environment happy-dom
// SCRATCH — review only: is the action offered only where it can work?
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  indexAvailability,
  model,
  mountApp,
  settle,
  unmountApp,
} from './appHarness'
import { setSearchMode } from '../src/lib/searchOptions'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const READY = { state: 'ready' as const, collectionRoot: '/library/DM Stash', covers: ['stl'] }

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

describe('offered only where it can work', () => {
  it('H1: not offered while browsing a directory outside the indexed collection', async () => {
    indexAvailability.mockResolvedValue(READY)
    const listing: DirListing = { path: '/elsewhere', entries: [dir('Alpha'), model('w.stl')] }
    await mountApp('/elsewhere', listing)
    await settle()
    await click(searchTab())
    console.log('H1: meaning offered outside the collection?', modeButton('meaning') !== undefined)
    expect(modeButton('meaning')).toBeUndefined()
  })

  it('H2: not offered inside an archive', async () => {
    indexAvailability.mockResolvedValue(READY)
    const listing: DirListing = {
      path: '/library/DM Stash/kit.zip!/parts',
      entries: [model('lid.stl')],
    }
    await mountApp('/library/DM Stash/kit.zip!/parts', listing)
    await settle()
    await click(searchTab())
    console.log('H2: meaning offered inside a zip?', modeButton('meaning') !== undefined)
    expect(modeButton('meaning')).toBeUndefined()
  })
})
