// @vitest-environment happy-dom
// The entry menu through App: what a secondary press does and does not do,
// which items each kind offers, and reveal — navigate, locate, mark, and the
// history entry that makes it safe to press on an expensive result set.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  indexAvailability,
  listDir,
  model,
  mountApp,
  openFind,
  findInput,
  pathInput,
  pressEnter,
  searchInput,
  settle,
  tiles,
  type,
  unmountApp,
  wait,
} from './appHarness'
import { COPY_FAILED } from '../src/lib/entryActions'
import { RenderQueue } from '../src/three/queue'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const zipEntry = (name: string): DirEntry => ({
  name,
  path: `/models/${name}`,
  kind: 'zip',
  size: 0,
  mtime: 1,
})

const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), zipEntry('kit.zip'), model('widget.stl')],
}
const AT_ALPHA: DirListing = {
  path: '/models/Alpha',
  entries: [model('Alpha/found.stl'), model('Alpha/other.stl')],
}
const SEARCH: DirListing = { path: '/models', entries: [model('Alpha/found.stl')] }

function mockRoutes(): void {
  listDir.mockImplementation((target: string, opts?: { q?: string }) => {
    if (opts?.q === 'found') return Promise.resolve(SEARCH)
    if (target === '/models/Alpha') return Promise.resolve(AT_ALPHA)
    return Promise.resolve(NESTED)
  })
}

/** The secondary press, as a browser delivers it: a pointerdown with button 2,
 *  then the contextmenu event. */
async function secondaryPress(el: HTMLElement, x = 120, y = 140): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: x, clientY: y }),
    )
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  })
}

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="menu"]')
const items = (): string[] =>
  Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).map(
    (b) => b.dataset.command ?? '',
  )
const item = (id: string): HTMLButtonElement =>
  menu()!.querySelector<HTMLButtonElement>(`[data-command="${id}"]`)!
const tile = (name: string): HTMLButtonElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === name)!
const marked = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('.animate-reveal-mark')
const pathError = (): string | null =>
  container.querySelector('header p.text-red-400')?.textContent ?? null
/** The same line in its other tone — what a command reports having done. */
const pathNotice = (): string | null =>
  container.querySelector('header p.text-zinc-400')?.textContent ?? null

beforeEach(async () => {
  await mountApp('/models', NESTED)
  mockRoutes()
})
afterEach(async () => {
  await unmountApp()
})

describe('raising the menu', () => {
  it('opens on a secondary press without orbiting or opening the viewer', async () => {
    // App returns on `e.button !== 0` before any overlay is set — one early
    // return away from regressing, hence the assertion rather than trust.
    const suspend = vi.spyOn(RenderQueue.prototype, 'suspend')
    await secondaryPress(tile('widget.stl'))
    expect(menu()).not.toBeNull()
    expect(container.querySelector('.cursor-grab')).toBeNull() // no orbit overlay
    expect(document.querySelector('[role="dialog"]')).toBeNull() // no lightbox
    // It is not a viewer, so the shared renderer is never taken from the
    // thumbnail queue for it (2.4).
    expect(suspend).not.toHaveBeenCalled()
    suspend.mockRestore()
  })

  it('closes on Escape, on an outside press, and on choosing — leaving the grid as it was', async () => {
    const before = tiles().length
    await secondaryPress(tile('widget.stl'))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(tiles().length).toBe(before)

    await secondaryPress(tile('widget.stl'))
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(tiles().length).toBe(before)
  })

  it('wins Escape over the find control, which still owns it when no menu is up', async () => {
    await openFind()
    expect(findInput()).not.toBeNull()
    await secondaryPress(tile('widget.stl'))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(findInput()).not.toBeNull() // one Escape dismissed one thing

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(findInput()).toBeNull()
  })

  it('is reachable from the keyboard and returns focus to the tile', async () => {
    const t = tile('widget.stl')
    t.focus()
    await act(async () => {
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }))
    })
    expect(menu()).not.toBeNull()
    expect(menu()!.contains(document.activeElement)).toBe(true)

    await act(async () => {
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect((document.activeElement as HTMLElement).dataset.command).toBe('reveal')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).toBe(t)
  })
})

describe("the menu's contents", () => {
  it('offers the model set on a model and the container set on a dir or zip', async () => {
    // After the unmount, which resets availability to the default 'absent'.
    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    await mountApp('/models', NESTED)
    mockRoutes()

    await secondaryPress(tile('widget.stl'))
    // D6's table whole: six on a model when the index is answering for the
    // collection it sits in, three on a container.
    expect(items()).toEqual([
      'open',
      'reveal',
      'copyPath',
      'findSimilar',
      'reRenderThumbnail',
      'resetFraming',
    ])
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    await secondaryPress(tile('Alpha'))
    expect(items()).toEqual(['open', 'reveal', 'copyPath'])
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    await secondaryPress(tile('kit.zip'))
    expect(items()).toEqual(['open', 'reveal', 'copyPath'])
  })

  it('withholds find similar while the index is not answering, without asking it', async () => {
    // The default availability is 'absent'. Reading `state.index` rather than
    // probing is the point: opening a menu makes no call of its own (2.5).
    const before = indexAvailability.mock.calls.length
    await secondaryPress(tile('widget.stl'))
    // Every other action still works — the two thumbnail ones are not the
    // index's, and they stay.
    expect(items()).toEqual(['open', 'reveal', 'copyPath', 'reRenderThumbnail', 'resetFraming'])
    expect(indexAvailability.mock.calls.length).toBe(before)
  })

  it('withholds find similar from a model outside the collection the index covers', async () => {
    // The index is up and answering — for somewhere else. One rule for "inside
    // the indexed collection", shared with the side panel, so the menu cannot
    // offer a question the index would refuse on scope.
    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/library' })
    await mountApp('/models', NESTED)
    mockRoutes()

    await secondaryPress(tile('widget.stl'))
    expect(items()).not.toContain('findSimilar')
    expect(items()).toEqual(['open', 'reveal', 'copyPath', 'reRenderThumbnail', 'resetFraming'])
  })
})

describe('copy path from either surface', () => {
  it('copies the entry path from the menu and reports a failure on the path bar', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      await secondaryPress(tile('widget.stl'))
      await click(item('copyPath'))
      await settle()
      expect(writeText).toHaveBeenCalledWith('/models/widget.stl')
      expect(menu()).toBeNull()

      writeText.mockRejectedValueOnce(new Error('denied'))
      await secondaryPress(tile('widget.stl'))
      await click(item('copyPath'))
      await settle()
      expect(pathError()).toBe(COPY_FAILED)
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('confirms a copy while the view’s failure stands, and the failure comes back', async () => {
    // entry-actions: a copy that succeeds SHALL confirm briefly. The line is
    // shared with the path bar's failure, and letting the failure win meant a
    // copy made while a listing was broken confirmed nowhere at all — not
    // late, never. The failure is only covered for as long as the report lives.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      listDir.mockRejectedValueOnce(new Error('no such path: /models/nope'))
      await type(pathInput(), '/models/nope')
      await pressEnter(pathInput())
      await settle()
      expect(pathError()).toBe('no such path: /models/nope')

      await secondaryPress(tile('widget.stl'))
      await click(item('copyPath'))
      await settle()
      expect(writeText).toHaveBeenCalledWith('/models/widget.stl')
      expect(pathNotice()).toBe('Path copied.')
      expect(pathError()).toBeNull()

      // Longer than App's ACTION_TEXT_MS, which is what clears the report.
      await wait(2600)
      expect(pathNotice()).toBeNull()
      expect(pathError()).toBe('no such path: /models/nope')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})

describe('reveal', () => {
  it('navigates to the containing folder, marks the entry, and pushes one entry', async () => {
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(tiles().length).toBe(1)
    // A filter is up: reveal goes through App's one navigate, which clears it.
    await openFind()
    await type(findInput()!, 'found')
    const len = window.history.length

    await secondaryPress(tile('Alpha/found.stl'))
    await click(item('reveal'))
    await settle()

    expect(window.location.search).toContain('path=%2Fmodels%2FAlpha')
    expect(window.location.search).not.toContain('q=')
    expect(window.history.length).toBe(len + 1) // Back returns to the results
    expect(findInput()).toBeNull() // navigate's ephemeral reset ran…
    expect(marked()).not.toBeNull() // …and the mark survived it
    expect(marked()!.getAttribute('title')).toBe('Alpha/found.stl')
  })

  it('leaves the flat toggle alone', async () => {
    const flat = (): boolean =>
      container.querySelector('button[aria-pressed]')!.getAttribute('aria-pressed') === 'true'
    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!)
    await settle()
    expect(flat()).toBe(true)

    await secondaryPress(tile('widget.stl'))
    await click(item('reveal'))
    await settle()
    expect(flat()).toBe(true)
    expect(window.location.search).toContain('flat=1')
  })

  it('drops the mark silently when the entry is not in the listing that arrives', async () => {
    listDir.mockImplementation((target: string, opts?: { q?: string }) => {
      if (opts?.q === 'found') return Promise.resolve(SEARCH)
      // Alpha lists without the revealed model — moved or deleted since.
      if (target === '/models/Alpha') {
        return Promise.resolve({ path: '/models/Alpha', entries: [model('Alpha/other.stl')] })
      }
      return Promise.resolve(NESTED)
    })
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    listDir.mockClear()

    await secondaryPress(tile('Alpha/found.stl'))
    await click(item('reveal'))
    await settle()
    expect(marked()).toBeNull()
    expect(pathError()).toBeNull() // presented normally, no error
    expect(tiles().length).toBe(1)
  })

  it('marks nothing when history brings the folder back', async () => {
    // Back into the folder holding the revealed entry, inside the mark's own
    // window: the mark describes an arrival, not a view, so history must not
    // restore it. This is the reset beside the find control's, on the popstate
    // path (3.5).
    await secondaryPress(tile('Alpha'))
    await click(item('reveal'))
    await settle()
    expect(marked()).not.toBeNull()

    await act(async () => {
      window.history.replaceState(null, '', '/?path=%2Fmodels')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await settle()
    expect(tile('Alpha')).toBeDefined() // the revealed folder is on screen again
    expect(marked()).toBeNull()
  })

  it('marks nothing after a reload of the folder it landed in', async () => {
    await secondaryPress(tile('Alpha'))
    await click(item('reveal'))
    await settle()
    expect(marked()).not.toBeNull()

    const url = `${window.location.pathname}${window.location.search}`
    await unmountApp()
    const { mountAppAtCurrentUrl } = await import('./appHarness')
    await mountAppAtCurrentUrl(url, NESTED)
    mockRoutes()
    expect(marked()).toBeNull()
    expect(window.location.search).not.toContain('mark')
  })

  it('fades: the mark comes off on its own', async () => {
    await secondaryPress(tile('widget.stl'))
    await click(item('reveal'))
    await settle()
    expect(marked()).not.toBeNull()
    await wait(2000)
    expect(marked()).toBeNull()
  })
})
