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
import { resetLookupQueueForTests } from '../src/hooks/useThumbnails'
import { TRAIL_KEY } from '../src/lib/trail'
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

/** Every listing is a fresh object: a landing must be told from a patch by the
 *  answer's id, never by the accident of a mock handing the same array back. */
function routes(): void {
  listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) => {
    if (opts?.q !== undefined) return Promise.resolve(structuredClone(SEARCH))
    if (target === '/models') {
      return Promise.resolve(structuredClone(opts?.flat === true ? FLAT_PARENT : PARENT))
    }
    return Promise.resolve(CHILD_OF(target.slice('/models/'.length)))
  })
}

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

describe('closing the lightbox keeps the place', () => {
  it('re-fetches nothing and moves nothing', async () => {
    await scrollTo(450)
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
    const requests = listDir.mock.calls.length

    await back() // ✕ on a pushed lightbox is this same history.back
    await wait(200)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(listDir.mock.calls.length).toBe(requests)
    expect(main().scrollTop).toBe(450)
  })
})

describe('the reveal', () => {
  it('still centres the located entry and marks it', async () => {
    // Reveal k10 from its own listing: the navigation re-asks /models, and the
    // landing centres the tile through the same placement a Back uses.
    const target = tile('/models/k10')
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
    const reveal = document.querySelector<HTMLButtonElement>('[role="menu"] [data-command="reveal"]')!
    await click(reveal)
    await settle()

    expect(main().scrollTop).toBe(centredOn('/models/k10'))
    expect(container.querySelector('.animate-reveal-mark')?.getAttribute('data-entry-tile')).toBe(
      '/models/k10',
    )
  })
})
