// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../src/api/client'
import { GestureTracker } from '../src/lib/gesture'
import type { MeshLru } from '../src/three/lru'
import ViewerLayer, { type ViewerState } from '../src/viewer/ViewerLayer'

// The overlay drives real ViewerSession math; only the WebGL renderer is faked.
vi.mock('../src/three/renderer', () => ({
  getRenderer: () => ({
    setSize: () => {},
    render: () => {},
    domElement: document.createElement('canvas'),
  }),
  makeScene: () => ({ scene: new THREE.Scene(), rig: new THREE.Group() }),
  RIG_VERSION: 2,
  renderThumbnail: () => Promise.resolve(new Blob()),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ENTRY = {
  name: 'box.stl',
  path: '/models/box.stl',
  kind: 'model' as const,
  format: 'stl' as const,
  size: 10,
  mtime: 1,
}

function makeProps() {
  const viewer: ViewerState = {
    mode: 'orbit',
    entry: ENTRY,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    originEl: null,
  }
  let resolvePersist!: () => void
  const persistGate = new Promise<void>((r) => {
    resolvePersist = r
  })
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
  return {
    resolvePersist,
    props: {
      viewer,
      camera: undefined,
      axis: undefined,
      lighting: 'axis' as const,
      api: { getThumb: vi.fn().mockResolvedValue({ status: 'miss' }) } as unknown as ApiClient,
      lru: { acquire: vi.fn().mockResolvedValue(mesh) } as unknown as MeshLru<THREE.Object3D>,
      tracker: new GestureTracker(),
      onPromote: vi.fn(),
      onDismiss: vi.fn(),
      onPersist: vi.fn(() => persistGate),
      onLoadError: vi.fn(),
    },
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

async function render(props: ReturnType<typeof makeProps>['props']): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  props.tracker.start(50, 50) // the press that opened the overlay
  await act(async () => {
    root!.render(<ViewerLayer {...props} />)
  })
  await act(async () => {}) // session built from the resolved acquire
}

function pointer(type: string, x: number, y: number): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y }))
}

async function dragAndReleaseOutside(): Promise<void> {
  await act(async () => {
    pointer('pointermove', 80, 50) // beyond the drag threshold
    pointer('pointermove', 90, 60)
    pointer('pointerup', 500, 500) // release outside the tile rect
  })
}

const settle = (ms = 120) => act(() => new Promise((r) => setTimeout(r, ms)))

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('orbit → thumbnail handoff', () => {
  it('holds dismissal until the persist resolves, then dismisses once', async () => {
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside()
    expect(props.onPersist).toHaveBeenCalled()

    await settle()
    expect(props.onDismiss).not.toHaveBeenCalled() // still holding

    resolvePersist()
    await settle()
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('a held dismissal yields to a new gesture on the tile', async () => {
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside()

    await act(async () => {
      pointer('pointerdown', 50, 50) // new press before the hold completes…
      const el = container!.querySelector<HTMLElement>('.fixed')
      el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }))
    })
    resolvePersist()
    await settle()
    expect(props.onDismiss).not.toHaveBeenCalled() // …so the old hold is a no-op
  })

  it('a release without a drag dismisses nothing and promotes as before', async () => {
    const { props } = makeProps()
    await render(props)
    await act(async () => {
      pointer('pointerup', 50, 50) // no movement: click
    })
    await settle()
    expect(props.onPromote).toHaveBeenCalled()
    expect(props.onPersist).not.toHaveBeenCalled()
    expect(props.onDismiss).not.toHaveBeenCalled()
  })

  it('a viewer replaced during a hold re-arms the gesture: the new tile can promote', async () => {
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside() // hold pending on tile A

    // A press on tile B replaces the viewer prop without unmounting the layer.
    const viewerB: ViewerState = {
      mode: 'orbit',
      entry: { ...ENTRY, name: 'b.stl', path: '/models/b.stl' },
      rect: { left: 200, top: 0, width: 100, height: 100 },
      originEl: null,
    }
    props.tracker.start(250, 50)
    await act(async () => {
      root!.render(<ViewerLayer {...props} viewer={viewerB} />)
    })
    resolvePersist()
    await settle()
    expect(props.onDismiss).not.toHaveBeenCalled() // stale hold yielded

    await act(async () => {
      pointer('pointerup', 250, 50) // release without drag on tile B
    })
    expect(props.onPromote).toHaveBeenCalled() // gesture state was re-armed
  })

  it('a failed or slow persist cannot wedge the overlay (timeout fallback)', async () => {
    const { props } = makeProps() // persist gate never resolves
    await render(props)
    await dragAndReleaseOutside()
    await settle(1700) // past PERSIST_HOLD_MS
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  }, 8000)
})
