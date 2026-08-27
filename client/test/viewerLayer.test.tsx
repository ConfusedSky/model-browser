// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexScore } from '../../shared/types'
import { HttpError, type ApiClient } from '../src/api/client'
import { COPY_FAILED } from '../src/lib/entryActions'
import { GestureTracker } from '../src/lib/gesture'
import type { ScoreScale } from '../src/lib/scoreScale'
import type { MeshLru } from '../src/three/lru'
import ViewerLayer, { type ViewerState } from '../src/viewer/ViewerLayer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ENTRY = {
  name: 'gone.stl',
  path: '/models/gone.stl',
  kind: 'model' as const,
  format: 'stl' as const,
  size: 10,
  mtime: 1,
}

function makeProps(mode: 'orbit' | 'lightbox') {
  const viewer: ViewerState = {
    mode,
    entry: ENTRY,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    originEl: null,
  }
  return {
    viewer,
    camera: undefined,
    axis: undefined,
    pose: undefined,
    score: undefined as IndexScore | undefined,
    scoreScale: null as ScoreScale | null,
    lighting: 'axis' as const,
    ao: true,
    api: {
      getThumb: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as ApiClient,
    lru: {
      acquire: vi.fn().mockRejectedValue(new HttpError(404, 'no such file: /models/gone.stl')),
    } as unknown as MeshLru<THREE.Object3D>,
    tracker: new GestureTracker(),
    onPromote: vi.fn(),
    onCloseIntent: vi.fn(),
    closeSignal: 0,
    onDismiss: vi.fn(),
    onPersist: vi.fn().mockResolvedValue(undefined),
    onLoadError: vi.fn(),
    onEntryMenu: vi.fn(),
    menuOpen: { current: false },
    // These cases are about a model that never loaded; the panel's action row
    // is App's list, and an empty one leaves the copy affordance they assert on
    // exactly where it was.
    panelCommands: [],
    onCommand: vi.fn(),
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

async function render(props: ReturnType<typeof makeProps>): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<ViewerLayer {...props} />)
  })
  // Flush the rejected acquire/getThumb promise chain into state.
  await act(async () => {})
  return container
}

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('ViewerLayer missing-model error', () => {
  it('lightbox shows the file name and reason instead of a spinner', async () => {
    const props = makeProps('lightbox')
    const el = await render(props)
    const alert = el.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('gone.stl')
    expect(alert!.textContent).toContain('no such file: /models/gone.stl')
    expect(el.querySelector('.animate-spin')).toBeNull()
    expect(props.onLoadError).toHaveBeenCalledWith('no such file: /models/gone.stl')
  })

  it('info panel is up for a model that failed to load, with a copyable path', async () => {
    const props = makeProps('lightbox')
    const el = await render(props)
    expect(el.textContent).toContain('/models/gone.stl')
    expect(el.querySelector('button[aria-label="Copy path"]')).not.toBeNull()
  })

  it('closing an errored lightbox raises the close intent, then dismisses without persisting', async () => {
    // Escape raises an intent — App owns the history question — and App's
    // answer (a closeSignal bump) runs the teardown, which skips persist when
    // the session never existed.
    const props = makeProps('lightbox')
    await render(props)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(props.onCloseIntent).toHaveBeenCalled()
    expect(props.onDismiss).not.toHaveBeenCalled() // not until App answers

    await act(async () => {
      root!.render(<ViewerLayer {...props} closeSignal={1} />)
    })
    expect(props.onDismiss).toHaveBeenCalled()
    expect(props.onPersist).not.toHaveBeenCalled()
  })

  it('orbit overlay shows a compact error indicator and reports the failure', async () => {
    const props = makeProps('orbit')
    const el = await render(props)
    const alert = el.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('failed to load')
    expect(el.querySelector('.animate-spin')).toBeNull()
    expect(props.onLoadError).toHaveBeenCalledWith('no such file: /models/gone.stl')
  })

  it('an errored orbit overlay still promotes to the lightbox on click', async () => {
    const props = makeProps('orbit')
    props.tracker.start(50, 50) // the press that opened the overlay
    await render(props)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup')) // release without drag
    })
    expect(props.onPromote).toHaveBeenCalled()
    expect(props.onPersist).not.toHaveBeenCalled()
  })
})

describe('lightbox gesture binding', () => {
  function press(el: HTMLElement, x: number, y: number): void {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
  }
  const move = (x: number, y: number) =>
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))

  it('pointerdown on the panel starts no gesture; on the canvas host it does', async () => {
    const props = makeProps('lightbox')
    const el = await render(props)
    const host = el.querySelector<HTMLElement>('.cursor-grab')
    const copy = el.querySelector<HTMLElement>('button[aria-label="Copy path"]')
    expect(host).not.toBeNull()
    expect(copy).not.toBeNull()

    await act(async () => {
      press(copy!, 10, 10)
      move(60, 60) // well past the drag threshold
    })
    expect(props.tracker.isDrag).toBe(false)

    await act(async () => {
      press(host!, 10, 10)
      move(60, 60)
    })
    expect(props.tracker.isDrag).toBe(true)
  })
})

describe('copy-path feedback', () => {
  it('a failed copy withdraws an earlier "copied" confirmation and reports the failure', async () => {
    // The one behavior this affordance's move into the shared command
    // deliberately changed (entry-actions 1.3, model-viewer MODIFY): the panel
    // used to select the path text for a manual copy, and now reports the
    // failure briefly instead. The fallback ranged over the panel's rendered
    // `<p>`, which a context menu does not have, and defended a non-secure
    // context this app does not target.
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      const props = makeProps('lightbox')
      const el = await render(props)
      const copy = el.querySelector<HTMLButtonElement>('button[aria-label="Copy path"]')!

      await act(async () => copy.click())
      expect(copy.textContent).toBe('copied')
      // The same implementation the menu invokes, over the same virtual path.
      expect(writeText).toHaveBeenCalledWith(ENTRY.path)
      expect(el.querySelector('[role="status"]')).toBeNull()

      // Second copy fails inside the first one's confirmation window.
      await act(async () => copy.click())
      expect(copy.textContent).toBe('copy')
      expect(el.querySelector('[role="status"]')?.textContent).toBe(COPY_FAILED)
      // And nothing is selected: the retired fallback left a Range over the
      // path text, which is what a menu could never share.
      expect(window.getSelection?.()?.toString() ?? '').toBe('')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
