// @vitest-environment happy-dom
//
// The entry menu raised on a viewer surface — the orbit overlay and the
// lightbox. Reported 2026-08-22: a secondary press on a model being viewed did
// nothing at all, because both overlays sit over the tile whose handler would
// have seen it, and the orbit one keeps sitting there invisibly through the
// persist hold after a release.
//
// What these pin is the surface half: that the press arrives, that the browser's
// own menu does not, that the **lightbox** offers only the commands it can
// honestly perform while the orbit overlay offers the whole tile menu (6.8,
// from a screenshot of the three-item menu on a tile just orbited), that Escape
// dismisses one thing at a time, and that a command which changes the view
// takes the open lightbox with it through the persisting close.
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

import { ViewerSession } from '../src/viewer/session'

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
const axes = (): string[] =>
  Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []).map(
    (b) => b.dataset.axis ?? '',
  )
/** The group's fourth button — present exactly when the letters are. */
const flip = (): HTMLElement | null =>
  menu()?.querySelector<HTMLElement>('[role="menuitemcheckbox"][data-axis="flip"]') ?? null
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
/** The panel's transient line, in whichever tone it is wearing. */
const panelNote = (): string | null =>
  dialog()?.querySelector('p[role="status"]')?.textContent ?? null
/** The path bar's transient line — the surface the lightbox covers. */
const headerNote = (): string | null =>
  container.querySelector('header p.text-zinc-400')?.textContent ?? null
/** Every item a model tile offers when the index is answering — the whole of
 *  D6's table, which is also what the orbit overlay offers since 6.8. */
const WHOLE_TABLE = [
  'open',
  'reveal',
  'copyPath',
  'findSimilar',
  'reRenderThumbnail',
  'resetFraming',
]
/** The axis group as the lightbox picker states it: three letters and a flip. */
const AXIS_LETTERS = ['x', 'y', 'z']
const GROUP_ROLES = ['menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitemcheckbox']
/** The orbit overlay: the fixed layer over the pressed tile. */
const overlay = (): HTMLElement | null => container.querySelector<HTMLElement>('.z-orbit-overlay.cursor-grab')
const modelTile = (): HTMLElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === 'widget.stl')!

/**
 * The secondary press as a browser delivers it — press, `contextmenu`, release,
 * all carrying the secondary button (Chrome sends `button: 2` on the
 * `contextmenu` too; happy-dom would default it to 0, which is the keyboard's
 * shape) — returning whether the app took the `contextmenu` event.
 * `dispatchEvent` is false exactly when something called `preventDefault`,
 * which is what suppresses the platform's own menu. The release goes to
 * window as the primary's does, so the viewer's release path sees it.
 */
async function secondaryPress(
  el: HTMLElement,
  x = 120,
  y = 140,
  opts: { shift?: boolean } = {},
): Promise<boolean> {
  const shiftKey = opts.shift === true
  let taken = false
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 2,
        buttons: 2,
        clientX: x,
        clientY: y,
        shiftKey,
      }),
    )
    taken = !el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: x,
        clientY: y,
        shiftKey,
      }),
    )
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 2, clientX: x, clientY: y, shiftKey }),
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
  it('a secondary press on the orbiting model raises the tile’s whole menu', async () => {
    await startOrbit()
    expect(overlay()).not.toBeNull()

    const taken = await secondaryPress(overlay()!)
    expect(menu()).not.toBeNull()
    // Six, not three — **changed 2026-08-22 (6.8)**, from a user's screenshot.
    // Every reason the filter gives is about a view the user *opened*: it holds
    // the renderer for as long as they leave it open, it carries the live axis
    // picker, and it ends in a close that persists what is on screen. A
    // transient overlay over a tile is none of those, so as far as the menu is
    // concerned it *is* that tile. The lightbox is the surface that filters.
    expect(items()).toEqual(WHOLE_TABLE)
    expect(taken).toBe(true) // the platform's own menu is suppressed
    // The press did not disturb what it was raised over.
    expect(overlay()).not.toBeNull()
    expect(dialog()).toBeNull()
  })

  it('offers that whole menu through the persist hold after an orbit — the reported case', async () => {
    // The screenshot itself: drag, release, right-click the tile you are still
    // looking at. The overlay lingers there invisibly for up to
    // PERSIST_HOLD_MS, catches the press, and used to answer it with the
    // three-item viewer menu — for a model that is, to the user, sitting on
    // the grid.
    await startOrbit()
    await act(async () => {
      const move = (x: number, y: number): void => {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
      }
      move(120, 50) // beyond the drag threshold
      move(160, 60)
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 160, clientY: 60 }))
    })
    // Still mounted: the dismissal is waiting on the persist it just started.
    expect(overlay()).not.toBeNull()
    expect(dialog()).toBeNull() // a drag does not promote

    await secondaryPress(overlay()!)
    expect(items()).toEqual(WHOLE_TABLE)
    expect(axes()).toEqual(AXIS_LETTERS)
    expect(flip()).not.toBeNull()
  })

  it('a secondary press on the lightbox raises the menu an open view can honestly run', async () => {
    await openLightbox()
    expect(dialog()).not.toBeNull()

    const taken = await secondaryPress(dialog()!)
    // Reset framing joined 2026-09-01 (a user-reported screenshot: the panel
    // offered it, the menu did not) — offered because its press is live-routed
    // through resetFramingLive, not because the queued body became honest here.
    expect(items()).toEqual(['reveal', 'copyPath', 'findSimilar', 'resetFraming'])
    expect(taken).toBe(true)
    expect(dialog()).not.toBeNull() // still open behind its own menu
  })

  it("the lightbox menu's Reset framing runs the live body, not the queued one", async () => {
    await openLightbox()
    await secondaryPress(dialog()!)
    putThumb.mockClear()
    const reset = Array.from(menu()!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Reset framing',
    )!
    await click(reset as HTMLElement)
    await settle()
    // The live body's store half is a pixel-less discard PUT — sent NOW, not
    // queued behind the suspension the open view holds (which is what the
    // generic body would do, and it would then sit until close and lose to
    // the closing persist). Its arrival while the lightbox is still open is
    // what proves the routing.
    const discard = putThumb.mock.calls.find((c) => c[0].camera === null)
    expect(discard).toBeDefined()
    expect(dialog()).not.toBeNull()
  })

  it('confirms a copy in the panel, not on the bar it is covering', async () => {
    // *Copy path* is the one command on this surface that owes the user a word
    // — entry-actions requires a brief confirmation — and it was the one that
    // could not give one: the host's routing sat on `report` alone, so the
    // "copied" line went to the path bar under a 70% scrim, in the far corner,
    // behind the dialog being looked at. Success is not silent here, so the
    // absence read as a copy that did not happen.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      await openLightbox()
      await secondaryPress(dialog()!)
      await click(item('copyPath'))
      await settle()

      // The same body as everywhere else: the filesystem path, expanded from
      // the harness library's `/lib` top (library R2).
      expect(writeText).toHaveBeenCalledWith('/lib/models/widget.stl')
      expect(panelNote()).toBe('Path copied.')
      // In the confirming tone, not the failure one — a success painted red
      // would be the other half of this bug.
      expect(dialog()!.querySelector('p[role="status"].text-zinc-400')).not.toBeNull()
      expect(dialog()!.querySelector('p.text-red-400')).toBeNull()
      // And it did not also go to the covered bar: one sentence, one surface.
      expect(headerNote()).toBeNull()
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('still offers the whole table on a tile — the filter is the surface, not the app', async () => {
    await secondaryPress(modelTile())
    expect(items()).toEqual(WHOLE_TABLE)
  })

  // 6.7's half of the same filter, **narrowed to the lightbox by 6.8**: the
  // group is withheld on the one surface that already carries the live picker.
  it('withholds the orbit-axis group on the lightbox, and offers it on the tile and the overlay', async () => {
    const roles = (): (string | null)[] =>
      Array.from(menu()?.querySelectorAll<HTMLElement>('button') ?? []).map((b) =>
        b.getAttribute('role'),
      )

    // The tile first, while nothing is open: this is not a rule about the
    // entry, so the same model has to offer the group here — as the picker's
    // own `axis X Y Z | flip` row at the top of the menu (6.8, second look).
    await secondaryPress(modelTile())
    expect(axes()).toEqual(AXIS_LETTERS)
    expect(roles().slice(0, 4)).toEqual(GROUP_ROLES)
    await escape()

    // The overlay carries no picker of its own — the live one belongs to the
    // lightbox — so withholding the group here left a model's spindle
    // unreachable for as long as the overlay lingered over its tile.
    await startOrbit()
    await secondaryPress(overlay()!)
    expect(axes()).toEqual(AXIS_LETTERS)
    expect(roles().slice(0, 4)).toEqual(GROUP_ROLES)
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
    // Here, and only here, the picker is a few pixels away — the row this
    // menu's group is a copy of.
    expect(axes()).toHaveLength(0)
    expect(flip()).toBeNull()
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
    // labels and never a viewpoint (useThumbnails' sweep PUT), so `putThumb`
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

// entry-actions, the requirement's one exception (native-context-menu-bypass):
// a shifted secondary press is the browser's. On these surfaces that means the
// page menu — Inspect, extension items — over a canvas that offers no image
// items of its own.
describe('the shifted secondary press on a viewer surface', () => {
  const move = (x: number, y: number): void => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
  }
  const primaryRelease = (): Promise<void> =>
    act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 50, clientY: 50 }))
    })

  it('is left to the browser on the lightbox, which stays open', async () => {
    await openLightbox()
    const taken = await secondaryPress(dialog()!, 120, 140, { shift: true })
    expect(taken).toBe(false) // not prevented: the platform's menu appears
    expect(menu()).toBeNull()
    expect(dialog()).not.toBeNull()
  })

  it('mid-hold, ends the gesture without promoting — the primary’s lost release opens nothing', async () => {
    // The browser's menu takes the pointer, so the primary's release never
    // reaches the page. The press must end the gesture itself, or a release
    // that *does* arrive later would promote a press nobody is still making.
    await startOrbit()
    const taken = await secondaryPress(overlay()!, 60, 60, { shift: true })
    expect(taken).toBe(false)
    expect(menu()).toBeNull()
    expect(dialog()).toBeNull() // ended, not promoted (D6)

    await primaryRelease()
    await wait(150)
    expect(dialog()).toBeNull() // the gesture was already over
  })

  it('mid-drag, ends the orbit — the mouse no longer steers a model nobody is holding', async () => {
    const orbit = vi.spyOn(ViewerSession.prototype, 'orbit')
    try {
      await startOrbit()
      await act(async () => {
        move(120, 50) // beyond the drag threshold
        move(160, 60)
      })
      // The control: a session exists and is steering, or the assertion
      // below would pass for the wrong reason.
      expect(orbit).toHaveBeenCalled()
      const steered = orbit.mock.calls.length

      const taken = await secondaryPress(overlay()!, 160, 60, { shift: true })
      expect(taken).toBe(false)
      expect(menu()).toBeNull()

      await act(async () => {
        move(200, 80)
        move(240, 90)
      })
      expect(orbit.mock.calls.length).toBe(steered) // nothing follows the mouse
      expect(dialog()).toBeNull()
    } finally {
      orbit.mockRestore()
    }
  })

  it('an unshifted secondary press mid-hold raises the menu, and its release ends nothing', async () => {
    // The release side of "raising the menu disturbs nothing": the secondary
    // button's release is not the primary's. Before the guard, `onUp` took any
    // release as the end of the gesture, and a right-click without a drag
    // opened the lightbox under the menu it had just raised.
    await startOrbit()
    const taken = await secondaryPress(overlay()!, 60, 60)
    expect(taken).toBe(true)
    expect(menu()).not.toBeNull()
    expect(dialog()).toBeNull() // the secondary release promoted nothing
    expect(overlay()).not.toBeNull()

    await escape()
    // The primary's own release still ends the gesture as it always did.
    await primaryRelease()
    await wait(150)
    expect(dialog()).not.toBeNull()
  })
})
