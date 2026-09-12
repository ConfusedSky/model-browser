// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  container,
  dir,
  listDir,
  model,
  mountApp,
  putThumb,
  settle,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), model('widget.stl')],
}

const search = () => window.location.search
const dialog = () => container.querySelector('[role="dialog"]')
const pop = () => act(async () => window.dispatchEvent(new PopStateEvent('popstate')))
const WIDGET = '/models/widget.stl'
/** The close's own write, told apart from the sweep's: a camera rides only on
 *  a persist, never on a background render (`useThumbnails`' sweep PUT). */
const cameraWrites = (): unknown[] =>
  putThumb.mock.calls
    .map(([b]) => b as { path: string; camera?: unknown })
    .filter((b) => b.path === WIDGET && b.camera !== undefined && b.camera !== null)

/** Drag on the open lightbox's canvas, then clear the release's own write:
 *  an untouched close writes nothing (`pose-rerender` D4), so it is the close
 *  after a manipulation whose camera write says the close ran. */
async function orbit(): Promise<void> {
  const canvas = dialog()!.querySelector<HTMLElement>('.cursor-grab')!
  await act(async () => {
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
    )
  })
  await act(async () => {
    const move = (x: number, y: number): void => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
    }
    move(160, 100) // beyond the drag threshold
    move(200, 120)
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 120 }))
  })
  await settle()
  putThumb.mockClear()
}

/** The pointer route: press the model tile, release without a drag — promote. */
async function openByPointer(): Promise<void> {
  const tile = container.querySelector<HTMLElement>('main button[data-model-tile]')!
  await act(async () => {
    tile.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }),
    )
  })
  await settle()
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  await wait(150)
}

beforeEach(async () => {
  await mountApp('/models', NESTED)
})
afterEach(async () => {
  await unmountApp()
})

describe('lightbox history', () => {
  it('the pointer route pushes an entry and a model param, not just the keyboard route', async () => {
    const len = window.history.length
    await openByPointer()
    expect(dialog()).not.toBeNull()
    expect(search()).toContain('model=%2Fmodels%2Fwidget.stl')
    expect(window.history.length).toBe(len + 1)
  })

  it('browser back closes with persist, and forward re-opens without pushing', async () => {
    await openByPointer()
    const len = window.history.length
    await orbit()

    // Back: the browser rewinds the URL (model gone) and fires popstate.
    window.history.replaceState(null, '', '/?path=%2Fmodels')
    await pop()
    await wait(200)
    expect(dialog()).toBeNull()
    expect(cameraWrites().length).toBeGreaterThan(0) // the close was the persisting teardown
    expect(window.history.length).toBe(len)

    // Forward: model param returns; re-open must not mint a new entry.
    window.history.replaceState(null, '', '/?path=%2Fmodels&model=%2Fmodels%2Fwidget.stl')
    await pop()
    await wait(200)
    expect(dialog()).not.toBeNull()
    expect(window.history.length).toBe(len)
  })

  it('✕ on a pushed lightbox goes through history.back — one close path', async () => {
    await openByPointer()
    await orbit()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      // Play the browser: rewind the URL and fire popstate.
      window.history.replaceState(null, '', '/?path=%2Fmodels')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click()
    })
    await wait(200)
    expect(back).toHaveBeenCalledOnce()
    expect(dialog()).toBeNull()
    expect(cameraWrites().length).toBeGreaterThan(0)
    expect(search()).not.toContain('model=')
    back.mockRestore()
  })

  it('a deep-linked lightbox closes without history.back and stays in the app', async () => {
    await unmountApp()
    const { mountAppAtCurrentUrl } = await import('./appHarness')
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fwidget.stl', NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull() // restored once the listing contained it
    await orbit()

    const back = vi.spyOn(window.history, 'back')
    const len = window.history.length
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await wait(200)
    expect(back).not.toHaveBeenCalled() // nothing behind this entry — back would leave the app
    expect(dialog()).toBeNull()
    expect(cameraWrites().length).toBeGreaterThan(0)
    expect(search()).not.toContain('model=')
    expect(window.history.length).toBe(len)
    expect(container.querySelector('main')).not.toBeNull() // still mounted
    back.mockRestore()
  })

  it('a forward-reopened lightbox still closes through history, not the deep-link path', async () => {
    // The entry is the one we pushed, so it has the listing behind it. An
    // in-memory "did we push this" flag is false by now (the re-open came from
    // popstate), which would wrongly take the deep-link branch and consume the
    // entry — leaving a dead back press.
    await openByPointer()
    // A real back/forward moves between entries, each keeping its own state;
    // these tests fake it with replaceState, so carry the entry's state by
    // hand or the simulation loses what the browser would have preserved.
    const lightboxEntryState = window.history.state

    window.history.replaceState(null, '', '/?path=%2Fmodels')
    await pop()
    await wait(200)
    expect(dialog()).toBeNull()

    window.history.replaceState(
      lightboxEntryState,
      '',
      '/?path=%2Fmodels&model=%2Fmodels%2Fwidget.stl',
    )
    await pop()
    await wait(200)
    expect(dialog()).not.toBeNull()

    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(null, '', '/?path=%2Fmodels')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click()
    })
    await wait(200)
    expect(back).toHaveBeenCalledOnce()
    expect(dialog()).toBeNull()
    back.mockRestore()
  })

  it('re-opening the same model after closing it pushes its entry again', async () => {
    // The close moves the URL off the model without a projection (bridge 4 and
    // the browser's own rewind), so the projection's record of the last view
    // has to follow it. Tracking only what the projection *wrote* left the
    // second open reading as a re-commit of a view already named: the lightbox
    // opened with no `model` in the URL and no entry behind it, so Back left
    // the app instead of closing it and a reload lost the model.
    await openByPointer()
    expect(search()).toContain('model=')

    window.history.replaceState(null, '', '/?path=%2Fmodels')
    await pop()
    await wait(200)
    expect(dialog()).toBeNull()
    expect(search()).not.toContain('model=')

    const len = window.history.length
    await openByPointer()
    expect(dialog()).not.toBeNull()
    expect(search()).toContain('model=%2Fmodels%2Fwidget.stl')
    expect(window.history.length).toBe(len + 1)
  })

  it('the backdrop closes like every other affordance', async () => {
    await openByPointer()
    await orbit()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(null, '', '/?path=%2Fmodels')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    // The backdrop is the overlay itself: only a press landing on it, not on
    // the dialog inside, closes.
    const backdrop = container.querySelector<HTMLElement>('.fixed.inset-0.z-lightbox')!
    await act(async () => {
      backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    await wait(200)
    expect(back).toHaveBeenCalledOnce()
    expect(dialog()).toBeNull()
    expect(cameraWrites().length).toBeGreaterThan(0) // same persisting teardown as ✕ and Escape
    expect(search()).not.toContain('model=')
    back.mockRestore()
  })

  it('an orbit drag that never promotes touches neither history nor the URL', async () => {
    const len = window.history.length
    const tile = container.querySelector<HTMLElement>('main button[data-model-tile]')!
    await act(async () => {
      tile.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }),
      )
    })
    await settle()
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 90, clientY: 60 }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 500, clientY: 500 }))
    })
    await wait(2000) // past the persist hold — dismissal completes
    expect(dialog()).toBeNull()
    expect(search()).not.toContain('model=')
    expect(window.history.length).toBe(len)
  })
})
