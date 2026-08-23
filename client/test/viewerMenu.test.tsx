// @vitest-environment happy-dom
//
// The entry menu raised on a viewer surface — the orbit overlay and the
// lightbox. Reported 2026-08-22: a secondary press on a model being viewed did
// nothing at all, because both overlays sit over the tile whose handler would
// have seen it, and the orbit one keeps sitting there invisibly through the
// persist hold after a release.
//
// What these pin is the surface half: that the press arrives, that the browser's
// own menu does not, that a viewer surface offers only the commands it can
// honestly perform, that Escape dismisses one thing at a time, and that a
// command which changes the view takes the open lightbox with it through the
// persisting close.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  indexAvailability,
  listDir,
  model,
  mountApp,
  putThumb,
  settle,
  similar,
  tiles,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const NEIGHBOURS = {
  path: '/models',
  entries: [model('Alpha/near.stl')],
  poses: {},
}

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="menu"]')
const items = (): string[] =>
  Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).map(
    (b) => b.dataset.command ?? '',
  )
const item = (id: string): HTMLButtonElement =>
  menu()!.querySelector<HTMLButtonElement>(`[data-command="${id}"]`)!
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
/** The orbit overlay: the fixed layer over the pressed tile. */
const overlay = (): HTMLElement | null => container.querySelector<HTMLElement>('.z-30.cursor-grab')
const modelTile = (): HTMLElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === 'widget.stl')!

/**
 * The secondary press as a browser delivers it, returning whether the app took
 * the `contextmenu` event — `dispatchEvent` is false exactly when something
 * called `preventDefault`, which is what suppresses the platform's own menu.
 */
async function secondaryPress(el: HTMLElement, x = 120, y = 140): Promise<boolean> {
  let taken = false
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 2,
        buttons: 2,
        clientX: x,
        clientY: y,
      }),
    )
    taken = !el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  })
  return taken
}

const escape = (): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

/** Press and hold the model tile: the orbit overlay, mid-gesture. */
async function startOrbit(): Promise<void> {
  await act(async () => {
    modelTile().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }),
    )
  })
  await settle()
}

/** Press and release without dragging: the overlay promotes to the lightbox. */
async function openLightbox(): Promise<void> {
  await startOrbit()
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  await wait(150)
}

beforeEach(async () => {
  // The index answers for this collection, so *find similar* is on the table —
  // otherwise the viewer set would be two items for a reason that is not the
  // surface filter.
  indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
  await mountApp('/models', NESTED)
  listDir.mockResolvedValue(NESTED)
})
afterEach(async () => {
  await unmountApp()
})

describe('the menu on a viewer surface', () => {
  it('a secondary press on the orbiting model raises it, with the surface-independent items', async () => {
    await startOrbit()
    expect(overlay()).not.toBeNull()

    const taken = await secondaryPress(overlay()!)
    expect(menu()).not.toBeNull()
    // Three, not six: *open* would re-open what is already open, and the two
    // thumbnail commands cannot honestly run behind the suspension this very
    // viewer holds (D6's margin).
    expect(items()).toEqual(['reveal', 'copyPath', 'findSimilar'])
    expect(taken).toBe(true) // the platform's own menu is suppressed
    // The press did not disturb what it was raised over.
    expect(overlay()).not.toBeNull()
    expect(dialog()).toBeNull()
  })

  it('a secondary press on the lightbox raises the same three', async () => {
    await openLightbox()
    expect(dialog()).not.toBeNull()

    const taken = await secondaryPress(dialog()!)
    expect(items()).toEqual(['reveal', 'copyPath', 'findSimilar'])
    expect(taken).toBe(true)
    expect(dialog()).not.toBeNull() // still open behind its own menu
  })

  it('still offers the whole table on a tile — the filter is the surface, not the app', async () => {
    await secondaryPress(modelTile())
    expect(items()).toEqual([
      'open',
      'reveal',
      'copyPath',
      'findSimilar',
      'reRenderThumbnail',
      'resetFraming',
    ])
  })

  // 6.7's half of the same filter: the group the tile menu offers, withheld on
  // both surfaces that already carry the live picker.
  it('withholds the orbit-axis group on both viewer surfaces, and offers it on the tile', async () => {
    const axes = (): HTMLElement[] =>
      Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])

    // The tile first, while nothing is open: this is not a rule about the
    // entry, so the same model has to offer all six here.
    await secondaryPress(modelTile())
    expect(axes().map((b) => b.dataset.axis)).toEqual(['x', 'y', 'z', '-x', '-y', '-z'])
    await escape()

    await startOrbit()
    await secondaryPress(overlay()!)
    expect(axes()).toHaveLength(0)
    await escape()

    // The same gesture's release promotes the overlay to the lightbox — a
    // pointer-opened one, which is why this test never closes it (that path
    // goes through `history.back`, which the harness's stubbed URL cannot
    // survive).
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
    })
    await wait(150)
    expect(dialog()).not.toBeNull()
    await secondaryPress(dialog()!)
    expect(axes()).toHaveLength(0)
  })

  it('gives Escape to the menu first and to the lightbox second', async () => {
    // Deep-linked rather than pointer-opened: this one closes without
    // history.back, which the harness's stubbed URL cannot survive.
    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    const { mountAppAtCurrentUrl } = await import('./appHarness')
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fwidget.stl', NESTED)
    listDir.mockResolvedValue(NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull()

    await secondaryPress(dialog()!)
    expect(menu()).not.toBeNull()

    await escape()
    expect(menu()).toBeNull()
    expect(dialog()).not.toBeNull() // one press dismissed one thing

    await escape()
    await wait(200)
    expect(dialog()).toBeNull()
  })

  it('takes the lightbox with it when a command changes the view', async () => {
    similar.mockResolvedValue(NEIGHBOURS)
    await openLightbox()
    expect(dialog()).not.toBeNull()
    putThumb.mockClear()

    await secondaryPress(dialog()!)
    await click(item('findSimilar'))
    await wait(250)

    // The model left the view, so App signalled the persisting close and the
    // session wrote its camera on the way out — not a bare unmount. The camera
    // is what says which write this was: the background sweep PUTs pixels and
    // labels and never a viewpoint (useThumbnails.ts:202-209), so `putThumb`
    // having been called at all proves nothing here.
    expect(dialog()).toBeNull()
    const closeWrites = putThumb.mock.calls
      .map(([body]) => body as { path: string; camera?: unknown })
      .filter((b) => b.path === '/models/widget.stl' && b.camera !== undefined)
    expect(closeWrites.length).toBeGreaterThan(0)
    // And the similarity view actually landed.
    expect(similar).toHaveBeenCalled()
    expect(window.location.search).toContain('similar=%2Fmodels%2Fwidget.stl')
    expect(tiles().map((t) => t.getAttribute('title'))).toContain('Alpha/near.stl')
  })
})
