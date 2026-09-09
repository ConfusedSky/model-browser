// @vitest-environment happy-dom
//
// The arrival table of `retrace-placement`, row by row, through the mounted
// app: retracing (Back, a dismissal, ↑) restores the grid's place, arriving
// (a tile, a typed path, a deep link, a search) lands at the top, and the
// reveal centres. happy-dom lays nothing out, so each cell carries its own
// geometry: one `getBoundingClientRect` on the prototype answers the scroller
// a fixed box and every tile a box computed from its index in the grid, the
// cell's column count and row height, and the scroller's `scrollTop` — which
// is what makes `measureIn`'s anchor and `applyIn`'s arithmetic exact enough
// to assert to the pixel. History is the real happy-dom stack: `back()` and
// `go()` restore each entry's `state` (the `idx` the trail is keyed by) and
// fire `popstate` on their own, asynchronously — playing them by hand with a
// `replaceState(null, …)` would throw the index away.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import { SKELETON_DELAY_MS } from '../src/hooks/useDelayedFlag'
import { resetLookupQueueForTests } from '../src/hooks/useThumbnails'
import { TRAIL_KEY } from '../src/lib/trail'
import {
  click,
  container,
  deferred,
  dir,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  searchInput,
  settle,
  skeleton,
  tiles,
  type,
  unmountApp,
  upButton,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

// Twelve folders and one model: four rows of three, deep enough to scroll.
const KITS = Array.from({ length: 12 }, (_, i) => dir(`k${String(i).padStart(2, '0')}`))
const PARENT: DirListing = { path: '/models', entries: [...KITS, model('widget.stl')] }
const CHILD_OF = (name: string): DirListing => ({
  path: `/models/${name}`,
  entries: Array.from({ length: 9 }, (_, i) => model(`${name}/part${i}.stl`)),
})
// Flat listings show models only — neither the parent's folders nor the
// child's folder tile exist in them, which is the fall-through D4 describes.
const FLAT_PARENT: DirListing = {
  path: '/models',
  entries: Array.from({ length: 9 }, (_, i) => model(`k00/part${i}.stl`)),
}
const SEARCH: DirListing = { path: '/models', entries: [model('k03/found.stl')] }
// A search whose answer holds the parent's anchor tile (k06, the tile at the
// top edge after a scroll to 450). A request left standing from a retrace
// would find its anchor here and place it — so a cell asserting that a search
// committed over an in-flight retrace lands at the top asserts a move, not a
// listing with nowhere else to go.
const SEARCH_WITH_ANCHOR: DirListing = {
  path: '/models',
  entries: [model('k03/found.stl'), dir('k06'), model('k07/found.stl')],
}

/** Every listing is a fresh object: a landing must be told from a patch by the
 *  answer's id, never by the accident of a mock handing the same array back. */
function routes(search: DirListing = SEARCH): void {
  listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) => {
    if (opts?.q !== undefined) return Promise.resolve(structuredClone(search))
    if (target === '/models') {
      return Promise.resolve(structuredClone(opts?.flat === true ? FLAT_PARENT : PARENT))
    }
    return Promise.resolve(CHILD_OF(target.slice('/models/'.length)))
  })
}

/**
 * Hold `path`'s next `count` plain listings until `release` hands each over,
 * in order. A fetch that outlasts `SKELETON_DELAY_MS` is the case this change
 * exists for — the grid is unmounted and the skeleton stands in — and no
 * resolved mock ever reaches it. Two held is a stale answer and the follow-up
 * it earns. Every other request keeps answering as `routes` had it.
 */
function holdListing(path: string, count = 1): { release: (listing: DirListing) => Promise<void> } {
  const held = Array.from({ length: count }, () => deferred<DirListing>())
  const answer = listDir.getMockImplementation()!
  let asked = 0
  listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) =>
    target === path && opts?.q === undefined && asked < count
      ? held[asked++]!.promise
      : answer(target, opts),
  )
  let released = 0
  return {
    release: async (listing) => {
      const next = held[released++]!
      if (released === count) listDir.mockImplementation(answer)
      await act(async () => next.resolve(structuredClone(listing)))
      await settle()
    },
  }
}
/** Reject `path`'s next plain listing; everything else answers as `routes` had it. */
function rejectListing(path: string): void {
  const answer = listDir.getMockImplementation()!
  listDir.mockImplementationOnce((target: string, opts?: { flat?: boolean; q?: string }) =>
    target === path && opts?.q === undefined
      ? Promise.reject(new Error(`no such path: ${path}`))
      : answer(target, opts),
  )
}
const pastDelay = (): Promise<void> => wait(SKELETON_DELAY_MS + 50)

// ---- geometry -------------------------------------------------------------

const MAIN_TOP = 100
const MAIN_HEIGHT = 600
const TILE_GAP = 20
let cols = 3
let rowH = 200

function box(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

const main = (): HTMLElement => container.querySelector('main')!
const tileEls = (): HTMLElement[] => Array.from(main().querySelectorAll('[data-entry-tile]'))
const tile = (path: string): HTMLElement =>
  tileEls().find((el) => el.getAttribute('data-entry-tile') === path)!

const originalRect = HTMLElement.prototype.getBoundingClientRect
function installGeometry(): void {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const scroller = container.querySelector('main')
    if (scroller === null) return box(0, 0)
    if (this === scroller) return box(MAIN_TOP, MAIN_HEIGHT)
    if (this.getAttribute('data-entry-tile') === null) return box(0, 0)
    const i = tileEls().indexOf(this)
    return box(MAIN_TOP + Math.floor(i / cols) * rowH - scroller.scrollTop, rowH - TILE_GAP)
  }
  Object.defineProperty(main(), 'clientHeight', { get: () => MAIN_HEIGHT, configurable: true })
}

/** Where the scroller sits once `path`'s tile is at `offset` from the top edge. */
const scrollTopFor = (path: string, offset: number): number =>
  Math.floor(tileEls().indexOf(tile(path)) / cols) * rowH - offset
/** Where the scroller sits once `path`'s tile is centred. */
const centredOn = (path: string): number =>
  scrollTopFor(path, (MAIN_HEIGHT - (rowH - TILE_GAP)) / 2)

/** Scroll like a user and let the settle timer file it (`RECORD_SETTLE_MS`). */
async function scrollTo(top: number): Promise<void> {
  await act(async () => {
    main().scrollTop = top
    main().dispatchEvent(new Event('scroll'))
  })
  await wait(200)
}

const back = (): Promise<void> =>
  act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 50))
  })
const forward = (): Promise<void> =>
  act(async () => {
    window.history.forward()
    await new Promise((r) => setTimeout(r, 50))
  })
const escape = (): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
/** The side panel's Show group: 'both' | 'folders' | 'models'. */
const showButton = (kind: string): HTMLButtonElement =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Show"] button'),
  ).find((b) => b.textContent === kind)!
const listingRequests = (path: string): number =>
  listDir.mock.calls.filter((c) => c[0] === path).length
const dismiss = (): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>('button[title^="Stop showing this"]')!

beforeEach(async () => {
  sessionStorage.removeItem(TRAIL_KEY)
  resetLookupQueueForTests()
  cols = 3
  rowH = 200
  await mountApp('/models', PARENT)
  routes()
  installGeometry()
})
afterEach(async () => {
  HTMLElement.prototype.getBoundingClientRect = originalRect
  await unmountApp()
})

describe('retracing restores the place', () => {
  it('Back to a listing that has to be fetched again lands the anchor at its offset', async () => {
    // 450 down with 200px rows: k06 (row 2) is the first tile crossing the top
    // edge, its top 50px above it.
    await scrollTo(450)
    expect(scrollTopFor('/models/k06', -50)).toBe(450)

    await click(tile('/models/k00'))
    await settle()
    expect(main().scrollTop).toBe(0) // the child arrived at the top
    const before = listingRequests('/models')

    await back()
    await settle()
    expect(listingRequests('/models')).toBe(before + 1) // fetched again, not patched
    expect(main().scrollTop).toBe(450)
    expect(tile('/models/k06').getBoundingClientRect().top).toBe(MAIN_TOP - 50)
  })

  it('dismissing a search raised from halfway down lands where it was left', async () => {
    await scrollTo(450)
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(tiles().length).toBe(1)
    expect(main().scrollTop).toBe(0) // a new search arrives at the top
    const before = listingRequests('/models')

    // The ✕ is a push, not a pop: the walk finds the listing the search was
    // raised from.
    await click(dismiss())
    await settle()
    expect(listingRequests('/models')).toBe(before + 1)
    expect(main().scrollTop).toBe(450)
  })

  it('browser Back off a search lands where the listing was left', async () => {
    await scrollTo(450)
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(main().scrollTop).toBe(0)

    await back()
    await settle()
    expect(tiles().length).toBe(PARENT.entries.length)
    expect(main().scrollTop).toBe(450)
  })

  it('↑ returns to the view the user went in from', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    expect(main().scrollTop).toBe(0) // the child arrived at the top — 450 below is a move
    const before = listingRequests('/models')

    await click(upButton())
    await settle()
    expect(listingRequests('/models')).toBe(before + 1)
    expect(main().scrollTop).toBe(450)
  })

  it('↑ after a search excursion finds the parent row, not the search row', async () => {
    // Rows: 0 parent (scrolled), 1 child, 2 search, 3 child again — the walk
    // from 3 passes the child and the search and stops on the parent.
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    await click(dismiss())
    await settle()
    expect(tiles().length).toBe(9) // back in the child
    expect(main().scrollTop).toBe(0) // at its top — 450 below is a move

    await click(upButton())
    await settle()
    expect(main().scrollTop).toBe(450)
  })

  it('↑ finds the visit that led here, not the parent’s later visit on a branch Back left', async () => {
    // Rows after the sequence: 0 parent@450, 1 child, 2 parent@850 (via ↑, a
    // push). Back to the child leaves row 2 standing above the current index;
    // ↑ from row 1 must walk *down* to row 0, never up to row 2.
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    await click(upButton())
    await settle()
    expect(main().scrollTop).toBe(450)
    await scrollTo(850)

    await back()
    await settle()
    expect(tiles().length).toBe(9) // the child, re-fetched
    await click(upButton())
    await settle()
    expect(main().scrollTop).toBe(450)
  })

  it('↑ from a deep arrival centres the child', async () => {
    await unmountApp()
    await mountAppAtCurrentUrl('/?path=%2Fmodels%2Fk10', CHILD_OF('k10'))
    routes()
    installGeometry()
    expect(tiles().length).toBe(9)

    await click(upButton())
    await settle()
    expect(main().scrollTop).toBe(centredOn('/models/k10'))
    expect(main().scrollTop).toBe(390) // row 3 at 600, centred in a 600 scrollport
  })

  it('↑ keeps the flat choice and falls through to the top', async () => {
    await scrollTo(450) // the anchor is k06, a folder
    await click(tile('/models/k00'))
    await settle()
    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!)
    await settle()
    await scrollTo(450) // so "the top" is a move, not the scroller left alone

    await click(upButton())
    await settle()
    expect(listDir).toHaveBeenLastCalledWith(
      '/models',
      expect.objectContaining({ flat: true }),
      expect.anything(),
    )
    // Flat shows no folders: neither the parent's anchor nor the child exists.
    expect(tile('/models/k06')).toBeUndefined()
    expect(tile('/models/k00')).toBeUndefined()
    expect(main().scrollTop).toBe(0)
  })

  it('Forward lands the entry it arrives at where it was left', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    await scrollTo(300) // the child: part3 (row 1) at −100

    await back()
    await settle()
    expect(tiles().length).toBe(PARENT.entries.length)
    await forward()
    await settle()
    expect(tiles().length).toBe(9) // the child, re-fetched
    expect(main().scrollTop).toBe(300)
  })

  it('a window resized in between still lands the anchor at its offset', async () => {
    await scrollTo(450) // k06 at −50, in a 3-column, 200px grid
    await click(tile('/models/k00'))
    await settle()

    cols = 2
    rowH = 300
    await back()
    await settle()
    // k06 is now row 3 of a 300px grid: a different scrollTop, the same tile
    // at the same offset.
    expect(main().scrollTop).toBe(950)
    expect(tile('/models/k06').getBoundingClientRect().top).toBe(MAIN_TOP - 50)
  })
})

describe('arriving lands at the top', () => {
  it('a tile click lands at 0 whatever that listing looked like on an earlier visit', async () => {
    await scrollTo(250)
    await click(tile('/models/k00'))
    await settle()
    await scrollTo(450) // the child, scrolled
    await back()
    await settle()
    expect(main().scrollTop).toBe(250) // the parent restored

    await click(tile('/models/k00'))
    await settle()
    expect(main().scrollTop).toBe(0) // not 250 kept, not 450 remembered
  })
})

/** Open the lightbox on the listing's model tile the way a pointer does. */
async function openLightbox(): Promise<void> {
  const modelTile = main().querySelector<HTMLElement>('button[data-model-tile]')!
  await act(async () => {
    modelTile.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }),
    )
  })
  await settle()
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  await wait(150)
  expect(container.querySelector('[role="dialog"]')).not.toBeNull()
}

/** Right-click `path`'s tile and choose "Reveal" from its menu. */
async function reveal(path: string): Promise<void> {
  const target = tile(path)
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: 120, clientY: 140 }),
    )
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 140 }),
    )
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 2, clientX: 120, clientY: 140 }),
    )
  })
  await settle()
  await click(document.querySelector<HTMLButtonElement>('[role="menu"] [data-command="reveal"]')!)
}
const markedTile = (): string | undefined =>
  container.querySelector('.animate-reveal-mark')?.getAttribute('data-entry-tile') ?? undefined

describe('closing the lightbox keeps the place', () => {
  it('re-fetches nothing and moves nothing', async () => {
    await scrollTo(450)
    await openLightbox()
    const requests = listDir.mock.calls.length

    await back() // ✕ on a pushed lightbox is this same history.back
    await wait(200)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(listDir.mock.calls.length).toBe(requests)
    expect(main().scrollTop).toBe(450)
  })

  it('a search committed after the close lands at the top', async () => {
    // The close patches, so the request Back raised for it must be dropped
    // there — left standing, it would place the next landing that carries its
    // anchor.
    routes(SEARCH_WITH_ANCHOR)
    await scrollTo(450)
    await openLightbox()
    await back()
    await wait(200)
    expect(main().scrollTop).toBe(450)

    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(tiles().length).toBe(SEARCH_WITH_ANCHOR.entries.length)
    expect(main().scrollTop).toBe(0)
  })
})

describe('the reveal', () => {
  it('still centres the located entry and marks it', async () => {
    // Reveal k10 from its own listing: the navigation re-asks /models, and the
    // landing centres the tile through the same placement a Back uses.
    await reveal('/models/k10')
    await settle()

    expect(main().scrollTop).toBe(centredOn('/models/k10'))
    expect(markedTile()).toBe('/models/k10')
  })
})

describe('a listing slow enough for the skeleton', () => {
  // The case the change exists for: the re-fetched listing takes longer than
  // `SKELETON_DELAY_MS`, the grid is unmounted while it is fetched, and the
  // place has to be applied on the commit where the tiles are back — not on
  // the landing commit, where the skeleton is still up and there is nothing
  // to place against.
  it('Back lands the anchor once the grid is back on screen', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    expect(main().scrollTop).toBe(0)

    const parent = holdListing('/models')
    await back()
    await pastDelay()
    expect(skeleton()).not.toBeNull()
    expect(tileEls().length).toBe(0)

    await parent.release(PARENT)
    expect(skeleton()).toBeNull()
    expect(main().scrollTop).toBe(450)
    expect(tile('/models/k06').getBoundingClientRect().top).toBe(MAIN_TOP - 50)
  })

  it('the reveal centres and marks the entry once the grid is back on screen', async () => {
    const parent = holdListing('/models')
    await reveal('/models/k10')
    await pastDelay()
    expect(skeleton()).not.toBeNull()

    await parent.release(PARENT)
    expect(main().scrollTop).toBe(centredOn('/models/k10'))
    expect(markedTile()).toBe('/models/k10')
  })
})

describe('a commit made while a retrace is in flight', () => {
  // The retrace's request belongs to the landing it was raised for. A user
  // commit before that landing supersedes it, and the new answer arrives at
  // the top — the request must not resolve against a listing it was never
  // raised against.
  it('a search committed before ↑ lands arrives at the top', async () => {
    routes(SEARCH_WITH_ANCHOR)
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()

    const parent = holdListing('/models')
    await click(upButton())
    await settle()
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(tiles().length).toBe(SEARCH_WITH_ANCHOR.entries.length)
    expect(main().scrollTop).toBe(0)

    await parent.release(PARENT) // the superseded answer lands nowhere
    expect(tiles().length).toBe(SEARCH_WITH_ANCHOR.entries.length)
    expect(main().scrollTop).toBe(0)
  })

  it('a search committed before ✕ lands arrives at the top', async () => {
    routes(SEARCH_WITH_ANCHOR)
    await scrollTo(450)
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(main().scrollTop).toBe(0)

    const parent = holdListing('/models')
    await click(dismiss())
    await settle()
    await type(searchInput(), 'found again')
    await pressEnter(searchInput())
    await settle()
    expect(tiles().length).toBe(SEARCH_WITH_ANCHOR.entries.length)
    expect(main().scrollTop).toBe(0)

    await parent.release(PARENT)
    expect(main().scrollTop).toBe(0)
  })
})

describe('a stale listing slower than the skeleton', () => {
  // The answer lands under the skeleton, the same flush releases the skeleton
  // and asks the follow-up, and the place must land then — a follow-up in
  // flight is not a wait. The follow-up's own landing is applied to nobody:
  // the user was placed, and may have moved since.
  it('Back to a stale listing slower than the skeleton lands the anchor', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    expect(main().scrollTop).toBe(0)
    const before = listingRequests('/models')

    const parent = holdListing('/models', 2)
    await back()
    await pastDelay()
    expect(skeleton()).not.toBeNull()

    await parent.release({ ...PARENT, stale: true })
    expect(skeleton()).toBeNull()
    expect(listingRequests('/models')).toBe(before + 2) // the follow-up is in flight
    expect(main().scrollTop).toBe(450)

    await parent.release(PARENT)
    expect(listingRequests('/models')).toBe(before + 2)
    expect(main().scrollTop).toBe(450)
  })

  it('the follow-up does not move a user who scrolled on after being placed', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()

    const parent = holdListing('/models', 2)
    await back()
    await pastDelay()
    await parent.release({ ...PARENT, stale: true })
    expect(main().scrollTop).toBe(450)
    await scrollTo(250)

    await parent.release(PARENT)
    expect(main().scrollTop).toBe(250)
  })
})

describe('a failed navigation', () => {
  // `ask` keeps a standing failure, so a retrace raised after a failed
  // navigation runs its first render under that failure: dropped for it, the
  // place would be lost on every Back out of a dead end. Only the request's
  // own failure drops it.
  it('Back after a failed ↑ still lands where the listing was left', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()
    expect(main().scrollTop).toBe(0)
    // ↑ asks for the parent and the answer never comes: nothing lands, so
    // nothing is pushed, and the failure stands over the child's grid.
    rejectListing('/models')
    await click(upButton())
    await settle()
    const before = listingRequests('/models')

    await back()
    await settle()
    expect(listingRequests('/models')).toBe(before + 1)
    expect(tiles().length).toBe(PARENT.entries.length)
    expect(main().scrollTop).toBe(450)
  })

  it('a retrace whose own listing fails drops its request', async () => {
    routes(SEARCH_WITH_ANCHOR)
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()

    rejectListing('/models')
    await back()
    await settle()
    expect(tiles().length).toBe(9) // the child is still what is on screen
    await scrollTo(300)

    // The same path typed is an arrival that lands a listing holding the
    // anchor: a request left standing would place it.
    await type(pathInput(), '/models')
    await pressEnter(pathInput())
    await settle()
    expect(tiles().length).toBe(PARENT.entries.length)
    expect(main().scrollTop).toBe(0)
  })
})

describe('a patch made while a retrace is in flight', () => {
  // A patch asks no new question, so the retrace's request still rides the
  // one in flight and lands with it. Only a different question supersedes.
  it('a kind filter flipped while a retrace is in flight does not lose the place', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()

    const parent = holdListing('/models')
    await back()
    await click(showButton('folders'))
    await settle()
    expect(showButton('folders').getAttribute('aria-pressed')).toBe('true')

    await parent.release(PARENT)
    expect(main().scrollTop).toBe(450)
  })

  it('a model opened while a retrace is in flight lands the grid where it was left', async () => {
    await scrollTo(450)
    await click(tile('/models/k00'))
    await settle()

    const parent = holdListing('/models')
    await back()
    await openLightbox() // a model of the child, still on screen under the hold

    await parent.release(PARENT)
    expect(main().scrollTop).toBe(450)
    await escape()
    await wait(200)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(main().scrollTop).toBe(450)
  })
})
