// @vitest-environment happy-dom
// The introduction's starting mode (`landing-page` 4.2, D5): where the
// introduction is offered and the index can answer, a browser that has chosen
// nothing starts in meaning mode — once per page, only while nothing is
// committed, and without ever recording a choice.
//
// The mode is asserted by *submitting*, never by reading a control: the
// requirement is that a typed phrase finds what it names, and which corpus a
// submit consults is the only thing that says so. `model-browser:search-mode`
// is asserted absent in the same cells, because the start must not be stored —
// which is why the closure is reset here with `applySessionSearchMode`, never
// with `setSearchMode`, whose write would make every absence assertion vacuous.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing, FeatureReport, SemanticListing } from '../../shared/types'
import {
  click,
  DEFAULT_REPORT,
  deferred,
  dirEntry,
  features,
  indexAvailability,
  listDir,
  modelEntry,
  mountAppAtCurrentUrl,
  pressEnter,
  searchInput,
  semanticSearch,
  settle,
  tiles,
  type,
  unmountApp,
} from './appHarness'
import { applySessionSearchMode } from '../src/lib/searchOptions'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const TOP: DirListing = { path: '/', entries: [dirEntry('/Kit')] }
const FOLDER: DirListing = { path: '/Kit', entries: [modelEntry('/Kit/a.stl')] }
const MEANING: SemanticListing = {
  path: '/',
  entries: [modelEntry('/Kit/a.stl')],
  poses: {},
  scores: {},
  scope: { path: null, status: 'indexed', indexed: 1, scanned: 1, covers: ['stl'] },
  weak: false,
  capped: false,
}
const INTRO = { ...DEFAULT_REPORT, intro: true }
const READY = { state: 'ready' as const, collectionRoot: '/', covers: ['stl'] }
const MODE_KEY = 'model-browser:search-mode'

const submit = async (text: string): Promise<void> => {
  await type(searchInput(), text)
  await pressEnter(searchInput())
  await settle()
}

beforeEach(() => {
  localStorage.clear()
  applySessionSearchMode('name')
  semanticSearch.mockResolvedValue(MEANING)
})
afterEach(() => unmountApp())

describe('a browser that has chosen nothing', () => {
  it('starts in meaning mode where the introduction is offered and the index can answer', async () => {
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    await submit('a dragon')
    expect(semanticSearch).toHaveBeenCalledOnce()
    // Never recorded: a browser that never chose keeps following the
    // deployment, and a later radio click is still its first real choice.
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('keeps meaning mode across a folder click, with the key still unset', async () => {
    // `navigate` re-seeds the view's options from `ownPrefs()`, which reads the
    // module closure — so a mode set only in the view would revert here. This
    // is the cell `applySessionSearchMode` exists for.
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    listDir.mockResolvedValue(FOLDER)
    await click(tiles()[0]!)
    await settle()

    await submit('a dragon')
    expect(semanticSearch).toHaveBeenCalledOnce()
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('waits for the index, then starts once it is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 2 })
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    indexAvailability.mockResolvedValue(READY)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    vi.useRealTimers()
    await settle()

    await submit('a dragon')
    expect(semanticSearch).toHaveBeenCalledOnce()
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('stays in name mode while the index cannot answer', async () => {
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue({ state: 'absent' })
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    await submit('a dragon')
    expect(semanticSearch).not.toHaveBeenCalled()
    expect(listDir).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ q: 'a dragon' }),
      expect.any(AbortSignal),
    )
  })
})

describe('what the start never overrides', () => {
  it('keeps a stored name choice', async () => {
    localStorage.setItem(MODE_KEY, 'name')
    applySessionSearchMode('name')
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    await submit('a dragon')
    expect(semanticSearch).not.toHaveBeenCalled()
    expect(localStorage.getItem(MODE_KEY)).toBe('name')
  })

  it('leaves a URL that names a mode to govern its own view', async () => {
    features.mockResolvedValue(INTRO)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/?q=widget&mode=name', TOP)
    await settle()

    expect(semanticSearch).not.toHaveBeenCalled()
    expect(listDir).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ q: 'widget' }),
      expect.any(AbortSignal),
    )
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('does not re-run a name search committed before the report resolved', async () => {
    // A late report must move nothing: `'setMode'` re-asks a committed query,
    // so without the nothing-committed guard the visitor's own name search
    // would be replaced by a meaning search they never asked for.
    const report = deferred<FeatureReport>()
    features.mockReturnValue(report.promise)
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    await submit('widget')
    expect(listDir).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ q: 'widget' }),
      expect.any(AbortSignal),
    )

    report.resolve(INTRO)
    await settle()
    expect(semanticSearch).not.toHaveBeenCalled()
    expect(window.location.search).toContain('mode=name')
  })

  it('moves nothing on a server with no configuration', async () => {
    indexAvailability.mockResolvedValue(READY)
    await mountAppAtCurrentUrl('/', TOP)
    await settle()

    await submit('a dragon')
    expect(semanticSearch).not.toHaveBeenCalled()
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })
})
