// @vitest-environment happy-dom
// The search input's cycling example (`landing-page` 4.1, D6): what reaches a
// visitor the banner no longer does.
//
// Four conditions gate it and each has a cell, because each failure mode is
// different: name mode would send a typed example to the wrong corpus, an index
// that cannot answer *here* would return nothing, a draft hides the placeholder
// anyway, and the banner is already showing the same phrases. The accessible
// name is asserted not to move with it — `searchInput()` selects by that label,
// so a cell that still resolves is the assertion.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import { EXAMPLE_QUERIES } from '../../shared/exampleQueries'
import {
  DEFAULT_REPORT,
  dirEntry,
  features,
  indexAvailability,
  modelEntry,
  mountAppAtCurrentUrl,
  searchInput,
  settle,
  type,
  unmountApp,
} from './appHarness'
import { PLACEHOLDER_PERIOD_MS } from '../src/hooks/useCyclingPlaceholder'
import { introDismissedStore } from '../src/lib/intro'
import { applySessionSearchMode } from '../src/lib/searchOptions'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const TOP: DirListing = { path: '/', entries: [dirEntry('/Kit')] }
const FOLDER: DirListing = { path: '/Kit', entries: [modelEntry('/Kit/a.stl')] }
const INTRO = { ...DEFAULT_REPORT, intro: true }
const READY = { state: 'ready' as const, collectionRoot: '/', covers: ['stl'] }
const ORDINARY = 'Search names and folders…'

const placeholder = (): string => searchInput().placeholder

beforeEach(() => {
  localStorage.clear()
  applySessionSearchMode('name')
})
afterEach(() => {
  vi.useRealTimers()
  return unmountApp()
})

/** Dismiss before mounting: the flag is read into component state at mount
 *  (D7), so a cell that wants the banner gone writes it first. */
function alreadyDismissed(): void {
  introDismissedStore.write(true)
}

describe('the cycling example', () => {
  it('cycles while meaning mode is in force, the index can answer and the box is empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    alreadyDismissed()
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    expect(placeholder()).toBe(EXAMPLE_QUERIES[0])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACEHOLDER_PERIOD_MS + 100)
    })
    expect(placeholder()).toBe(EXAMPLE_QUERIES[1])
    expect(placeholder()).not.toBe(ORDINARY)
  })

  it('reaches a deep link too — the folder is inside what the index covers', async () => {
    // No `mode` in the URL: the starting-mode rule puts meaning in force here
    // as it does at the top, which is what makes a deep link a place a typed
    // example works. (A `mode=meaning` param would not do it — the URL's mode
    // is read only under a committed query, `optionsOf`.)
    alreadyDismissed()
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/?path=%2FKit', FOLDER)
    await settle()
    expect(placeholder()).toBe(EXAMPLE_QUERIES[0])
  })

  it('shows the ordinary text in name mode', async () => {
    alreadyDismissed()
    // A stored choice: the starting-mode rule leaves it alone, so the view is
    // name and a typed example would go to the wrong corpus.
    localStorage.setItem('model-browser:search-mode', 'name')
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()
    expect(placeholder()).toBe(ORDINARY)
  })

  it('shows the ordinary text where the index cannot answer here', async () => {
    // Meaning is genuinely in force — the closure is what `ownPrefs` seeds the
    // boot view from — and the index is the only thing withholding the example:
    // a phrase typed here would be refused, so offering one would be a lie.
    alreadyDismissed()
    applySessionSearchMode('meaning')
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/elsewhere' })
    await mountAppAtCurrentUrl('/', TOP)
    await settle()
    expect(placeholder()).toBe(ORDINARY)
  })

  it('stops for a draft, as for any input holding text', async () => {
    alreadyDismissed()
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()
    expect(placeholder()).toBe(EXAMPLE_QUERIES[0])

    await type(searchInput(), 'dra')
    expect(placeholder()).toBe(ORDINARY)
  })

  it('stays out of the way while the banner is drawn', async () => {
    // The banner is already showing the same phrases; two copies of the offer
    // on one screen is noise.
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()
    expect(placeholder()).toBe(ORDINARY)
  })

  it('shows the ordinary text on a server with no configuration', async () => {
    // Every other condition holds — meaning in force, the index covering the
    // top, an empty box, no banner — so the report is the only thing deciding.
    alreadyDismissed()
    applySessionSearchMode('meaning')
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()
    expect(placeholder()).toBe(ORDINARY)
  })

  it('never moves the accessible name', async () => {
    alreadyDismissed()
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()
    // `searchInput()` selects by `aria-label`; resolving at all is the
    // assertion, and the placeholder having moved is what makes it one.
    expect(placeholder()).toBe(EXAMPLE_QUERIES[0])
    expect(searchInput().getAttribute('aria-label')).toBe('Search names and folders')
  })
})
