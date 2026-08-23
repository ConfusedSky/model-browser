// @vitest-environment happy-dom
//
// Leaving a similarity view, and where it leaves you (task 6.3).
//
// One dismissal with a provenance branch inside it (D9): a view entered from
// inside the app goes back to the view it was raised from — whole, with its
// options and its answer — while one opened from a link, with nothing of this
// app's behind it, clears to the location's listing as it always did. Both
// exits, the ✕ and erasing the search input, run that one function.
//
// `history.back()` is spied and played by hand throughout, as `urlLightbox`
// does: the harness stubs `URL` for object URLs, so happy-dom's own `back()`
// throws, and faking the browser is what lets these assert what the app does
// with the entry rather than what happy-dom does with history.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
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
  settle,
  similar,
  type,
  unmountApp,
} from './appHarness'
import {
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  TUNING_DEFAULTS,
} from '../src/lib/searchOptions'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const HERO = '/models/widget.stl'
const NEIGHBOURS = {
  path: '/models',
  entries: [model('Kits/Baal/base.stl'), model('Kits/Other/wing.stl')],
  poses: {},
}
const READY = { state: 'ready', collectionRoot: '/models', covers: ['stl'] }

function dismissButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find((b) =>
    b.textContent?.includes('Dismiss'),
  )
}
const menuItem = (id: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`[role="menu"] [data-command="${id}"]`)!

/** The secondary press, as a browser delivers it. */
async function secondaryPress(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 2,
        buttons: 2,
        clientX: 9,
        clientY: 9,
      }),
    )
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 9, clientY: 9 }),
    )
  })
}

/** Find similar on the named tile, from the menu — the only in-app way in, and
 *  the only one that mints an entry of its own. */
async function findSimilarOn(label: string): Promise<void> {
  const tile = Array.from(
    container.querySelectorAll<HTMLElement>('main .grid button'),
  ).find((b) => b.lastElementChild?.textContent === label)!
  await secondaryPress(tile)
  await settle()
  await click(menuItem('findSimilar'))
  await settle()
}

/**
 * A fake back stack. `history.back()` is spied to pop the entry we recorded on
 * the way in — rewinding the URL and its state exactly as the browser would,
 * then firing popstate, which is the one dispatch the app restores from.
 */
function playBrowserBack(): { spy: ReturnType<typeof vi.spyOn>; record: () => void } {
  const stack: { url: string; state: unknown }[] = []
  const record = (): void => {
    stack.push({ url: `${location.pathname}${location.search}`, state: history.state })
  }
  const spy = vi.spyOn(window.history, 'back').mockImplementation(() => {
    const prev = stack.pop()
    if (prev === undefined) return
    window.history.replaceState(prev.state, '', prev.url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  return { spy, record }
}

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
  setSearchKinds('both')
  setSearchTuning({ ...TUNING_DEFAULTS })
})
afterEach(() => unmountApp())

describe('leaving a similarity view', () => {
  it('one raised from a search returns to that search, whole', async () => {
    // The point of the whole feature: on a cold spinning volume that result set
    // cost ~32s to produce, and an exit that threw it away and re-walked the
    // folder instead is one people learn not to press.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    expect(location.search).toContain('q=widget')
    const searchUrl = location.search
    const { spy: back, record } = playBrowserBack()
    record()

    await findSimilarOn('widget.stl')
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    expect(location.search).toContain('similar=')
    // The entry is marked, which is what makes the return possible at all.
    expect(history.state).toEqual({ similar: true })

    listDir.mockClear()
    await click(dismissButton()!)
    await settle()

    expect(back).toHaveBeenCalledOnce()
    // The search is back — its URL, its label, and its own answer.
    expect(location.search).toBe(searchUrl)
    expect(container.textContent).toContain('Search results for "widget"')
    expect(labels()).toEqual(['widget.stl'])
    expect(searchInput().value).toBe('widget')
    back.mockRestore()
  })

  it('one opened from a link clears to the listing, because there is nothing behind it', async () => {
    // Back would leave the app. This is the branch that keeps the ✕ meaning
    // something on a cold-loaded link — and it is the behavior every dismissal
    // had before 6.3.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`/?path=/models&similar=${encodeURIComponent(HERO)}`, NESTED)
    await settle()
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    // The link's entry is the browser's; nothing marked it.
    expect(history.state).not.toEqual({ similar: true })

    const back = vi.spyOn(window.history, 'back')
    listDir.mockResolvedValue({ path: '/models', entries: [dir('Alpha')] })
    await click(dismissButton()!)
    await settle()

    expect(back).not.toHaveBeenCalled()
    expect(location.search).not.toContain('similar=')
    expect(labels()).toEqual(['Alpha'])
    expect(dismissButton()).toBeUndefined()
    back.mockRestore()
  })

  it('erasing the search input under an in-app similarity view returns the same way', async () => {
    // The delegation D9 argued for, now with somewhere to go. The tidying
    // gesture for a stale box and the ✕ are one act: two exits that resembled
    // each other is what D9 refuses, and a second copy of the branch is how
    // they would come to differ.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    const listingUrl = location.search
    const { spy: back, record } = playBrowserBack()
    record()

    await findSimilarOn('widget.stl')
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    // Entering cleared the draft (D9's margin); typing into it is what makes
    // erasing it possible at all.
    expect(searchInput().value).toBe('')
    await type(searchInput(), 'stale')
    await type(searchInput(), '')
    await settle()

    expect(back).toHaveBeenCalledOnce()
    expect(location.search).toBe(listingUrl)
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
    back.mockRestore()
  })

  it('chained find-similars unwind one hop per press', async () => {
    // Each in-app landing marks its own entry, so there is no special case for
    // a chain: the second dismissal finds the first similarity view's entry
    // marked too, and returns to it.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    const listingUrl = location.search
    const { spy: back, record } = playBrowserBack()

    record()
    await findSimilarOn('widget.stl')
    const firstUrl = location.search
    expect(firstUrl).toContain(encodeURIComponent(HERO))

    similar.mockResolvedValue({ ...NEIGHBOURS, entries: [model('Kits/Baal/hero.stl')] })
    record()
    await findSimilarOn('base.stl')
    expect(location.search).toContain(encodeURIComponent('/models/Kits/Baal/base.stl'))

    similar.mockResolvedValue(NEIGHBOURS)
    await click(dismissButton()!)
    await settle()
    expect(location.search).toBe(firstUrl)
    expect(labels()).toEqual(['base.stl', 'wing.stl'])

    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()
    expect(location.search).toBe(listingUrl)
    expect(dismissButton()).toBeUndefined()
    expect(back).toHaveBeenCalledTimes(2)
    back.mockRestore()
  })

  it('a Back onto an in-app similarity view leaves its marker standing', async () => {
    // What the whole branch rests on: the restore landing that follows a Back
    // must not scrub the entry's marker, or the *second* press would clear to
    // the listing instead of returning. It does not, because the browser has
    // already rewound the URL, so the landing's replace is redundant and
    // `commitUrl` declines it — marker included.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    const listingUrl = location.search
    const { spy: back, record } = playBrowserBack()
    record()

    await findSimilarOn('widget.stl')
    const similarUrl = location.search
    const similarState = history.state
    expect(similarState).toEqual({ similar: true })

    // Away, then back — the way the browser does it, carrying the entry's own
    // state, which is what a real back/forward preserves.
    listDir.mockResolvedValue({ path: '/models/Alpha', entries: [dir('Beta')] })
    await click(container.querySelectorAll<HTMLElement>('main .grid button')[0]!)
    await settle()
    window.history.replaceState(similarState, '', similarUrl)
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')))
    await settle()
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    expect(history.state).toEqual({ similar: true })

    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()
    expect(back).toHaveBeenCalledOnce()
    expect(location.search).toBe(listingUrl)
    back.mockRestore()
  })

  it('dismissing a query view is untouched by any of this', async () => {
    // 6.3 is scoped to similarity views. A committed search leaves through the
    // reducer exactly as it did — its entry is never marked, so the branch is
    // never taken, and nothing about that exit changed.
    indexAvailability.mockResolvedValue({ state: 'absent' })
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    expect(history.state).not.toEqual({ similar: true })

    const back = vi.spyOn(window.history, 'back')
    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()

    expect(back).not.toHaveBeenCalled()
    expect(location.search).not.toContain('q=')
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
    back.mockRestore()
  })
})
