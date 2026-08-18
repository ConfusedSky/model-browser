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

    // Back: the browser rewinds the URL (model gone) and fires popstate.
    window.history.replaceState(null, '', '/?path=%2Fmodels')
    await pop()
    await wait(200)
    expect(dialog()).toBeNull()
    expect(putThumb).toHaveBeenCalled() // the close was the persisting teardown
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
    expect(putThumb).toHaveBeenCalled()
    expect(search()).not.toContain('model=')
    back.mockRestore()
  })

  it('a deep-linked lightbox closes without history.back and stays in the app', async () => {
    await unmountApp()
    const { mountAppAtCurrentUrl } = await import('./appHarness')
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fwidget.stl', NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull() // restored once the listing contained it

    const back = vi.spyOn(window.history, 'back')
    const len = window.history.length
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await wait(200)
    expect(back).not.toHaveBeenCalled() // nothing behind this entry — back would leave the app
    expect(dialog()).toBeNull()
    expect(putThumb).toHaveBeenCalled()
    expect(search()).not.toContain('model=')
    expect(window.history.length).toBe(len)
    expect(container.querySelector('main')).not.toBeNull() // still mounted
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
