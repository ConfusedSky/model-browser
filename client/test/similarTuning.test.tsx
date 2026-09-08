// @vitest-environment happy-dom
//
// The similarity view's parameters, through the whole app (task 6.2): the panel
// block that sets them, the debounce that keeps a typed count from becoming
// four questions, and the URL that carries them.
//
// Entered by link, like `findSimilar.test.tsx` — the view is reachable and
// reproducible by URL by design (D4), and what these are about is what happens
// once it is on screen.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  DEFAULT_REPORT,
  dir,
  features,
  indexAvailability,
  labels,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pressEnter,
  searchInput,
  settle,
  similar,
  type,
  unmountApp,
  wait,
} from './appHarness'
import {
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  TUNING_DEFAULTS,
} from '../src/lib/searchOptions'
import { SIMILAR_K } from '../src/state/view'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const HERO = '/models/Kits/Baal/hero.stl'
const LINK = `/?path=/models&similar=${encodeURIComponent(HERO)}`
const NEIGHBOURS = {
  path: '/models',
  entries: [model('Kits/Baal/base.stl'), model('Kits/Other/wing.stl')],
  poses: {},
}
const READY = { state: 'ready', collectionRoot: '/models', covers: ['stl'] }
/** The panel's own storage key, written out rather than imported: renaming it
 *  would drop every profile's state, and a test that renamed with it would say
 *  nothing about that. */
const TAB_KEY = 'model-browser:panel-tab'

/** The neighbour-count field, absent unless the view is about a model. */
function countInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="Number of neighbours"]')
}
/** The similarity block's pooling trio — named apart from the meaning tuning's
 *  identical one, which can be on screen at the same time. */
function poolButtons(): HTMLButtonElement[] {
  const group = container.querySelector('[aria-label="Pool neighbour views by"]')
  return group === null ? [] : Array.from(group.querySelectorAll('button'))
}
function poolButton(name: string): HTMLButtonElement {
  return poolButtons().find((b) => b.textContent === name)!
}
/** The panel's tabs, by their labels — the Similar one is present only while
 *  there is a similarity view for it to be about (6.4). */
function tabButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('aside [role="tab"]'))
}
function tabNames(): string[] {
  // The dot the search tab wears under non-default options is part of its text.
  return tabButtons().map((b) => b.textContent!.replace('•', '').trim())
}
function tabButton(name: string): HTMLButtonElement | undefined {
  const i = tabNames().indexOf(name)
  return i === -1 ? undefined : tabButtons()[i]
}
function selectedTab(): string | undefined {
  return tabNames()[tabButtons().findIndex((b) => b.getAttribute('aria-selected') === 'true')]
}
/** The panel starts collapsed for a fresh profile. */
async function expandPanel(): Promise<void> {
  const expand = container.querySelector<HTMLButtonElement>(
    'aside button[aria-label="Expand side panel"]',
  )
  if (expand !== null) await click(expand)
}
/** Open the panel and stand on the Similar tab, which is where the similarity
 *  parameters live (6.4) — the search tab keeps none of them. Selecting it by
 *  hand rather than leaning on the auto-select: these cases are about the
 *  parameters, and the tab lifecycle has its own cases below. */
async function openSimilarTab(): Promise<void> {
  await expandPanel()
  const tab = tabButton('similar')
  if (tab !== undefined) await click(tab)
}

/** The in-app way into a similarity view — a secondary press on a tile, then
 *  the menu item — which is the gesture the arrival rule is about. (The tuning
 *  cases above enter by link instead: what they are about is what happens once
 *  the view is on screen.) */
async function findSimilarOn(label: string): Promise<void> {
  const tile = Array.from(container.querySelectorAll<HTMLElement>('main .grid button')).find(
    (b) => b.lastElementChild?.textContent === label,
  )!
  const at = { bubbles: true, clientX: 9, clientY: 9 }
  await act(async () => {
    tile.dispatchEvent(new PointerEvent('pointerdown', { ...at, button: 2, buttons: 2 }))
    tile.dispatchEvent(new MouseEvent('contextmenu', { ...at, cancelable: true }))
  })
  await settle()
  const item = document.querySelector<HTMLButtonElement>(
    '[role="menu"] [data-command="findSimilar"]',
  )!
  await click(item)
  await settle()
}

/** The ✕ over the grid — the way out of a similarity view. */
function dismissButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find((b) =>
    b.textContent?.includes('Dismiss'),
  )
}

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
  setSearchKinds('both')
  setSearchTuning({ ...TUNING_DEFAULTS })
})
afterEach(() => unmountApp())

describe('the similarity view’s parameters', () => {
  it('the Similar tab holds them, under a similarity view and nowhere else', async () => {
    // The applicability idiom the panel already uses for the name options, one
    // level up (6.4): an option that cannot apply is absent, not present and
    // inert — and so is the tab that would hold it.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openSimilarTab()

    expect(countInput()).not.toBeNull()
    expect(countInput()!.value).toBe(String(SIMILAR_K))
    expect(poolButtons().map((b) => b.textContent)).toEqual(['mean', 'max', 'softmax'])
    // Nothing pressed: absence is the index's own pooling, which is not any of
    // the three, so the panel says so rather than picking one.
    expect(poolButtons().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(container.textContent).toContain('Pooled however the index is configured to')
    // Named by base name, like the results label: the full vpath is in the URL,
    // which is where an identity belongs.
    expect(container.textContent).toContain('Similar to “hero.stl”')
    // The tab is the heading, so the block carries none of its own — a
    // "Neighbours" line here would be the title said twice.
    expect(container.textContent).not.toContain('Neighbours')

    // Leave the view and the tab goes with it — the parameters belong to the
    // subject that reads them, not to the profile.
    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    expect(countInput()).toBeNull()
    expect(poolButtons()).toEqual([])
  })

  it('a typed count becomes one question, not one per keystroke', async () => {
    // The debounce lives in the panel here rather than in App (there is no
    // record-only reducer phase to pair it with), so this is where it is
    // pinned: "40" typed digit by digit is one re-ask for 40, never one for 4.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openSimilarTab()
    expect(similar).toHaveBeenCalledTimes(1)

    await type(countInput()!, '4')
    await type(countInput()!, '40')
    // Nothing yet — the field is still being typed in.
    expect(similar).toHaveBeenCalledTimes(1)
    await wait(400)
    await settle()

    expect(similar).toHaveBeenCalledTimes(2)
    expect(similar).toHaveBeenLastCalledWith(HERO, 40, undefined, expect.any(AbortSignal))
    // The whole view is re-serialized by the one writer, so the count is in the
    // URL and the model is still what the view is about.
    expect(location.search).toContain('k=40')
    expect(location.search).toContain('similar=')
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
  })

  it('a pooling choice runs at once, carries the count in force, and is dropped from the URL when unset', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&k=40`, NESTED)
    await settle()
    await openSimilarTab()
    expect(similar).toHaveBeenLastCalledWith(HERO, 40, undefined, expect.any(AbortSignal))
    // No pool in, no pool out: 4.2's rule survives the parameter becoming
    // settable — a view that made no choice sends none.
    expect(location.search).not.toContain('pool=')

    await click(poolButton('max'))
    await settle()
    expect(similar).toHaveBeenLastCalledWith(HERO, 40, 'max', expect.any(AbortSignal))
    expect(location.search).toContain('pool=max')
    expect(location.search).toContain('k=40')
    expect(poolButton('max').getAttribute('aria-pressed')).toBe('true')
  })

  it('a link’s parameters are the view’s, and a bad one reads as the default', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&k=40&pool=mean`, NESTED)
    await settle()
    await openSimilarTab()

    expect(similar).toHaveBeenCalledWith(HERO, 40, 'mean', expect.any(AbortSignal))
    expect(countInput()!.value).toBe('40')
    expect(poolButton('mean').getAttribute('aria-pressed')).toBe('true')

    // A count the index would refuse degrades to the default rather than to a
    // 404-shaped surprise over a link that names a good view.
    await unmountApp()
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&k=99999`, NESTED)
    await settle()
    expect(similar).toHaveBeenCalledWith(HERO, SIMILAR_K, undefined, expect.any(AbortSignal))
  })

  it('a count field mid-edit is not a value', async () => {
    // The `topText`/`scoreText` rule, in the third field to need it: `Number('')`
    // is 0, and committing that would ask the index for no neighbours at all.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openSimilarTab()

    await type(countInput()!, '')
    await wait(400)
    await settle()
    expect(similar).toHaveBeenCalledTimes(1)
    // The draft is the user's until they leave the field. (`focusout`, not
    // `blur`: React delegates at the root and `blur` does not bubble.)
    expect(countInput()!.value).toBe('')
    await act(async () =>
      countInput()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    )
    expect(countInput()!.value).toBe(String(SIMILAR_K))
  })
})

describe('the Similar tab itself (6.4)', () => {
  it('is absent on a plain listing and on a query view', async () => {
    // A tab with nothing to be about is absent, not greyed — the rule the four
    // search options already follow, applied to the tab that would hold these.
    indexAvailability.mockResolvedValue(READY)
    await mountApp('/models', NESTED)
    await settle()
    await expandPanel()
    // `library` is the app's maintenance surface, present because the harness's
    // default report declares maintenance offered (`bulk-thumbnail-jobs` D6,
    // moved onto that field by `public-deployment` 3.8a). `chat` is absent for
    // the other half of the same rule: the default report declares it **off**,
    // since it is a placeholder with no backend (D4).
    expect(tabNames()).toEqual(['search', 'library'])

    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    expect(tabNames()).toEqual(['search', 'library'])
  })

  it('appears under a similarity view', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    // Chat declared on, so this cell can still own the WHOLE order — the
    // maintained configuration withholds the tab (D4), and the order rule is
    // about where each tab sits when it is there, not about which of them the
    // default offers.
    features.mockResolvedValue({ ...DEFAULT_REPORT, chatTab: true })
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await expandPanel()
    // Library sits LAST, after Similar: the three tabs before it describe the
    // view on screen and this one does not (D6). The order is asserted here
    // rather than left to the strip's construction, so the rule has an owner.
    expect(tabNames()).toEqual(['chat', 'search', 'similar', 'library'])
  })

  it('is selected on arrival from the search tab, and never from chat', async () => {
    // The panel follows the view from search, because search is the user saying
    // "I am looking at how this view is shaped" and the neighbour parameters
    // are that question's answer under the new view. Chat is a different
    // activity, and a half-typed message must not lose its tab because a menu
    // item was clicked out in the grid.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    // A deployment offering chat, since the rule under test is about what the
    // arrival does NOT take from that tab and the maintained configuration
    // does not offer it (D4).
    features.mockResolvedValue({ ...DEFAULT_REPORT, chatTab: true })
    await mountApp('/models', NESTED)
    await settle()
    await expandPanel()
    await click(tabButton('search')!)
    await findSimilarOn('widget.stl')
    expect(selectedTab()).toBe('similar')
    expect(countInput()).not.toBeNull()

    // Same gesture from chat: the tab is offered, and nothing is taken.
    await unmountApp()
    localStorage.clear()
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    features.mockResolvedValue({ ...DEFAULT_REPORT, chatTab: true })
    await mountApp('/models', NESTED)
    await settle()
    await expandPanel()
    await click(tabButton('chat')!)
    await findSimilarOn('widget.stl')
    expect(selectedTab()).toBe('chat')
    expect(tabNames()).toContain('similar')
    expect(countInput()).toBeNull()
  })

  it('falls back to search when the view it is about is dismissed', async () => {
    // A tab that is about to stop existing cannot stay selected. Search is
    // where it lands: the neighbouring options tab, and where the dismissal
    // leaves the user anyway.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openSimilarTab()
    expect(selectedTab()).toBe('similar')

    listDir.mockResolvedValue({ path: '/models', entries: [dir('Alpha')] })
    await click(dismissButton()!)
    await settle()
    // `library` is the app's maintenance surface, present because the harness's
    // default report declares maintenance offered; `chat` is absent because the
    // same report declares that off (D4).
    expect(tabNames()).toEqual(['search', 'library'])
    expect(selectedTab()).toBe('search')
  })

  it('is never what the profile records', async () => {
    // It is subject-dependent, and a profile restored onto it with no
    // similarity view would open on a tab that is not there. The store's parse
    // degrades an unknown value to chat, so old profiles need nothing — but
    // nothing must write one either.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await expandPanel()
    await click(tabButton('search')!)
    expect(localStorage.getItem(TAB_KEY)).toBe('search')

    // Selected by hand…
    await click(tabButton('similar')!)
    expect(selectedTab()).toBe('similar')
    expect(localStorage.getItem(TAB_KEY)).toBe('search')

    // …and selected by the arrival rule, which does not write either.
    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()
    await findSimilarOn('widget.stl')
    expect(selectedTab()).toBe('similar')
    expect(localStorage.getItem(TAB_KEY)).toBe('search')
  })
})
