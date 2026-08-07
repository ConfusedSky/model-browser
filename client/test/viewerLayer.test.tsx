// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, type ApiClient } from '../src/api/client'
import { GestureTracker } from '../src/lib/gesture'
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
    api: {
      getThumb: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as ApiClient,
    lru: {
      acquire: vi.fn().mockRejectedValue(new HttpError(404, 'no such file: /models/gone.stl')),
    } as unknown as MeshLru<THREE.Object3D>,
    tracker: new GestureTracker(),
    onPromote: vi.fn(),
    onDismiss: vi.fn(),
    onPersist: vi.fn().mockResolvedValue(undefined),
    onLoadError: vi.fn(),
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

  it('closing an errored lightbox dismisses without persisting', async () => {
    const props = makeProps('lightbox')
    await render(props)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
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
