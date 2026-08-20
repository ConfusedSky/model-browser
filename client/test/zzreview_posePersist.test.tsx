// @vitest-environment happy-dom
// SCRATCH — review only. Does opening a posed model in the lightbox and
// closing it without orbiting persist a camera? (spec: "An orientation is not
// a saved camera".)
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../src/api/client'
import { GestureTracker } from '../src/lib/gesture'
import type { MeshLru } from '../src/three/lru'
import type { IndexPose } from '../../shared/types'
import ViewerLayer, { type ViewerState } from '../src/viewer/ViewerLayer'

vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  getRenderer: () => ({
    setSize: () => {},
    render: () => {},
    domElement: document.createElement('canvas'),
  }),
  getLiveChain: () => ({ render: () => {} }),
  makeScene: () => ({ scene: new THREE.Scene(), rig: new THREE.Group() }),
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

const POSE: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 6, azimuth_deg: 270, elevation_deg: 20 },
}

function makeProps(pose: IndexPose | undefined) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
  const viewer: ViewerState = {
    mode: 'lightbox',
    entry: ENTRY,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    originEl: null,
  }
  return {
    viewer,
    camera: undefined,
    axis: undefined,
    pose,
    lighting: 'axis' as const,
    ao: true,
    api: { getThumb: vi.fn().mockResolvedValue({ status: 'miss' }) } as unknown as ApiClient,
    lru: { acquire: vi.fn().mockResolvedValue(mesh) } as unknown as MeshLru<THREE.Object3D>,
    tracker: new GestureTracker(),
    onPromote: vi.fn(),
    onCloseIntent: vi.fn(),
    closeSignal: 0,
    onDismiss: vi.fn(),
    onPersist: vi.fn().mockResolvedValue(undefined),
    onLoadError: vi.fn(),
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('pose is advisory', () => {
  it('opening at a pose and closing the lightbox without orbiting persists nothing', async () => {
    const props = makeProps(POSE)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<ViewerLayer {...props} />)
    })
    await act(async () => {})
    // Close the way App does: bump the close signal. No pointer ever moved.
    await act(async () => {
      root!.render(<ViewerLayer {...props} closeSignal={1} />)
    })
    await act(async () => {})
    const session = props.onPersist.mock.calls[0]?.[0] as
      | { state: { az: number; el: number }; axis: string }
      | undefined
    console.log(
      'persist calls:',
      props.onPersist.mock.calls.length,
      'axis:',
      session?.axis,
      'az(deg):',
      session === undefined ? undefined : (session.state.az * 180) / Math.PI,
      'el(deg):',
      session === undefined ? undefined : (session.state.el * 180) / Math.PI,
    )
    expect(props.onPersist).not.toHaveBeenCalled()
  })
})
