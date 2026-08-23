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
// How far back is the excursion's depth, not one hop: every in-app similar
// landing pushes its own marked entry — a re-tune is a different question and
// Back must reach the neighbours actually shown — so a tuned or chained view
// sits several marked entries deep, and one press leaves all of them.
//
// The browser's history is faked and played by hand throughout, as `urlLightbox`
// does: the harness stubs `URL` for object URLs, so happy-dom's own `back()`
// throws, and faking it is what lets these assert what the app does with the
// entries rather than what happy-dom does with history.
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
  upButton,
  wait,
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

/** The similarity block's controls, which are the only in-app way to re-tune —
 *  and each tuning is a fresh question, so each mints an entry of its own.
 *  (Named apart from the meaning tuning's identical pooling trio, which can be
 *  on screen at the same time.) */
const countInput = (): HTMLInputElement =>
  container.querySelector<HTMLInputElement>('input[aria-label="Number of neighbours"]')!
const poolButton = (name: string): HTMLButtonElement =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>('[aria-label="Pool neighbour views by"] button'),
  ).find((b) => b.textContent === name)!

/** The panel starts collapsed for a fresh profile; open it and select its
 *  Similar tab, which is where the neighbour parameters live (6.4). It is
 *  offered only under a similarity view, which is the only state these
 *  callers open it from. */
async function openPanel(): Promise<void> {
  const expand = container.querySelector<HTMLButtonElement>(
    'aside button[aria-label="Expand side panel"]',
  )
  if (expand !== null) await click(expand)
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('aside [role="tab"]')).find(
    (b) => b.textContent?.startsWith('similar'),
  )
  if (tab !== undefined) await click(tab)
}

/** Set the neighbour count and let the panel's debounce fire — a typed count is
 *  one question, not one per keystroke (6.2). */
async function tuneCount(value: string): Promise<void> {
  await type(countInput(), value)
  await wait(400)
  await settle()
}

/**
 * A fake back stack, kept by watching the pushes the app actually makes rather
 * than by the test declaring them: every `pushState` records the entry being
 * left, with its own state, and `go(-n)` rewinds n of them and fires popstate,
 * which is the one dispatch the app restores from. Replaces are not entries and
 * are not recorded — which is exactly why a restore landing cannot disturb the
 * stack.
 *
 * Watching the pushes is the point: the depth these tests are about is a count
 * of entries the app minted, so a stack the test hand-fed could agree with a
 * wrong count.
 */
function fakeHistory(): { go: ReturnType<typeof vi.spyOn>; back: () => Promise<void> } {
  const stack: { url: string; state: unknown }[] = []
  const push = window.history.pushState.bind(window.history)
  vi.spyOn(window.history, 'pushState').mockImplementation((state, unused, url) => {
    stack.push({ url: `${location.pathname}${location.search}`, state: window.history.state })
    push(state, unused, url)
  })
  const rewind = (n: number): void => {
    let dest: { url: string; state: unknown } | undefined
    for (let i = 0; i < n; i++) {
      const entry = stack.pop()
      if (entry === undefined) break
      dest = entry
    }
    if (dest === undefined) return
    window.history.replaceState(dest.state, '', dest.url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  const go = vi.spyOn(window.history, 'go').mockImplementation((delta) => rewind(-(delta ?? 0)))
  return { go, back: () => act(async () => rewind(1)) }
}

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
  setSearchKinds('both')
  setSearchTuning({ ...TUNING_DEFAULTS })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await unmountApp()
})

describe('leaving a similarity view', () => {
  it('one raised from a search returns to that search, whole — one entry, one press', async () => {
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
    const { go } = fakeHistory()

    await findSimilarOn('widget.stl')
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    expect(location.search).toContain('similar=')
    // The entry is marked, which is what makes the return possible at all, and
    // the depth is 1 because the search it was raised from is not marked.
    expect(history.state).toEqual({ similar: true, depth: 1 })

    listDir.mockClear()
    await click(dismissButton()!)
    await settle()

    expect(go).toHaveBeenCalledOnce()
    expect(go).toHaveBeenCalledWith(-1)
    // The search is back — its URL, its label, and its own answer.
    expect(location.search).toBe(searchUrl)
    expect(container.textContent).toContain('Search results for "widget"')
    expect(labels()).toEqual(['widget.stl'])
    expect(searchInput().value).toBe('widget')
  })

  it('a view tuned twice still leaves in one press, past both tuning steps', async () => {
    // The live run's gap. Each re-tune is a different question, so each pushes
    // its own marked entry — which is right, and is what lets Back reach the
    // neighbours actually shown. But it made the exit three presses, and the
    // first two landed on intermediate parameter sets nobody asked to return
    // to. The depth is what makes the one press mean "leave this excursion".
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    const searchUrl = location.search
    const { go } = fakeHistory()

    await findSimilarOn('widget.stl')
    expect(history.state).toEqual({ similar: true, depth: 1 })
    await openPanel()

    await tuneCount('40')
    expect(location.search).toContain('k=40')
    expect(history.state).toEqual({ similar: true, depth: 2 })

    await click(poolButton('max'))
    await settle()
    expect(location.search).toContain('pool=max')
    expect(history.state).toEqual({ similar: true, depth: 3 })

    await click(dismissButton()!)
    await settle()

    // One press, and it goes back the whole excursion rather than one step of
    // it: not the k-tuned view, not the untuned one — the search.
    expect(go).toHaveBeenCalledOnce()
    expect(go).toHaveBeenCalledWith(-3)
    expect(location.search).toBe(searchUrl)
    expect(container.textContent).toContain('Search results for "widget"')
    expect(labels()).toEqual(['widget.stl'])
    expect(dismissButton()!.textContent).not.toContain('Similar')
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
    // The link's entry is the browser's; nothing marked it, so there is no
    // depth either — the reducer path is what runs.
    expect(history.state).toBeNull()

    const go = vi.spyOn(window.history, 'go')
    listDir.mockResolvedValue({ path: '/models', entries: [dir('Alpha')] })
    await click(dismissButton()!)
    await settle()

    expect(go).not.toHaveBeenCalled()
    expect(location.search).not.toContain('similar=')
    expect(labels()).toEqual(['Alpha'])
    expect(dismissButton()).toBeUndefined()
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
    const { go } = fakeHistory()

    await findSimilarOn('widget.stl')
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    // Entering cleared the draft (D9's margin); typing into it is what makes
    // erasing it possible at all.
    expect(searchInput().value).toBe('')
    await type(searchInput(), 'stale')
    await type(searchInput(), '')
    await settle()

    expect(go).toHaveBeenCalledOnce()
    expect(go).toHaveBeenCalledWith(-1)
    expect(location.search).toBe(listingUrl)
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
  })

  it('chained find-similars leave together, in one press', async () => {
    // Revised after the live verification: a chain is an excursion too, and the
    // per-hop unwind this originally shipped had the same shape as the tuning
    // bug — the first press landed on a similarity view the user had already
    // moved on from. Each landing still marks its own entry; the depth is what
    // says how many of them one excursion is. Back still walks them singly.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    const listingUrl = location.search
    const { go } = fakeHistory()

    await findSimilarOn('widget.stl')
    expect(location.search).toContain(encodeURIComponent(HERO))
    expect(history.state).toEqual({ similar: true, depth: 1 })

    similar.mockResolvedValue({ ...NEIGHBOURS, entries: [model('Kits/Baal/hero.stl')] })
    await findSimilarOn('base.stl')
    expect(location.search).toContain(encodeURIComponent('/models/Kits/Baal/base.stl'))
    expect(history.state).toEqual({ similar: true, depth: 2 })

    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()

    expect(go).toHaveBeenCalledOnce()
    expect(go).toHaveBeenCalledWith(-2)
    // The origin, not the first similarity view.
    expect(location.search).toBe(listingUrl)
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
    expect(dismissButton()).toBeUndefined()
  })

  it('a Back onto a tuned similarity view leaves its marker — and its depth — standing', async () => {
    // What the whole branch rests on: the restore landing that follows a Back
    // must not scrub the entry's marker, or the *second* press would clear to
    // the listing instead of returning. It does not, because the browser has
    // already rewound the URL, so the landing's replace is redundant and
    // `commitUrl` declines it — marker and depth included. The depth is read
    // from the entry the browser restored, so the press still leaves the whole
    // excursion rather than the step it was standing on.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountApp('/models', NESTED)
    const listingUrl = location.search
    const { go, back } = fakeHistory()

    await findSimilarOn('widget.stl')
    await openPanel()
    await click(poolButton('max'))
    await settle()
    const tunedUrl = location.search
    expect(tunedUrl).toContain('pool=max')
    expect(history.state).toEqual({ similar: true, depth: 2 })

    // Away, then back — the way the browser does it, carrying the entry's own
    // state, which is what a real back/forward preserves.
    // Up, not a tile: the grid under a similarity view holds the neighbours,
    // which are models, and a model tile does not navigate.
    listDir.mockResolvedValue({ path: '/', entries: [dir('models')] })
    await click(upButton())
    await settle()
    expect(labels()).toEqual(['models'])
    await back()
    await settle()
    expect(location.search).toBe(tunedUrl)
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    expect(history.state).toEqual({ similar: true, depth: 2 })

    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()
    expect(go).toHaveBeenCalledOnce()
    expect(go).toHaveBeenCalledWith(-2)
    expect(location.search).toBe(listingUrl)
    expect(dismissButton()).toBeUndefined()
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
    expect(history.state).toBeNull()

    const go = vi.spyOn(window.history, 'go')
    listDir.mockResolvedValue(NESTED)
    await click(dismissButton()!)
    await settle()

    expect(go).not.toHaveBeenCalled()
    expect(location.search).not.toContain('q=')
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
  })
})
