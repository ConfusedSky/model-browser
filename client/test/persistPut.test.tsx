// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import type { ViewerSession } from '../src/viewer/session'

const listDir = vi.fn()
const getThumb = vi.fn()
const putThumb = vi.fn()

vi.mock('../src/api/client', () => ({
  HttpError: class extends Error {},
  HttpApiClient: class {
    listDir = listDir
    complete = vi.fn().mockResolvedValue([])
    fetchModel = vi.fn()
    getThumb = getThumb
    putThumb = putThumb
    // Hand-listed rather than shared, so it goes stale on new methods — see
    // client/test/CLAUDE.md's note about spreading the real module.
    indexAvailability = vi.fn().mockResolvedValue({ state: 'absent' })
    semanticSearch = vi.fn()
  },
}))
// Spread the real module and override only what needs WebGL. RIG_VERSION comes
// through real, never as a literal: a literal would keep passing across a
// RIG_VERSION bump while asserting a version the app no longer writes.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
  getRenderer: () => ({
    setSize: () => {},
    render: () => {},
    domElement: document.createElement('canvas'),
  }),
}))
// The viewer itself is out of scope: a stub that persists one settled session
// on mount lets this file pin App's persist PUT payload alone. What it passes
// as options is a test's to choose — `{camera: false}` is the one close
// ViewerLayer makes that way: a posed view the user never touched.
const opts = vi.hoisted(() => ({ persist: undefined as { camera?: boolean } | undefined }))
const SETTLED = { az: 1, el: 0.2, distR: 2, target: [0, 0, 0] as [number, number, number] }
vi.mock('../src/viewer/ViewerLayer', () => ({
  default: ({
    onPersist,
  }: {
    onPersist: (s: ViewerSession, o?: { camera?: boolean }) => Promise<void>
  }) => {
    useEffect(() => {
      void onPersist(
        {
          state: SETTLED,
          axis: '-z',
          snapshot: () => Promise.resolve(new Blob(['png'])),
        } as unknown as ViewerSession,
        opts.persist,
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
  },
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: App } = await import('../src/App')
const { RIG_VERSION } = await import('../src/three/renderer')
const { POSE_VERSION } = await import('../src/three/pose')

const MODEL = {
  name: 'm.stl',
  path: '/models/m.stl',
  kind: 'model' as const,
  format: 'stl' as const,
  size: 1,
  mtime: 5,
}
const LISTING: DirListing = { path: '/models', entries: [MODEL] }

let root: Root | null = null
let container: HTMLElement

const settle = () => act(() => new Promise((r) => setTimeout(r, 30)))

beforeEach(async () => {
  opts.persist = undefined
  localStorage.setItem('model-browser:last-path', '/models')
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:m', revokeObjectURL: () => {} })
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: () => {} }))
  listDir.mockReset()
  listDir.mockResolvedValue(LISTING)
  getThumb.mockReset()
  getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:t', lighting: 'axis', rig: RIG_VERSION })
  putThumb.mockReset()
  putThumb.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<App />)
  })
  await settle()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  root = null
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('orbit-release persist PUT', () => {
  it('carries the png, the settled camera and axis, and the pixel labels', async () => {
    const tile = container.querySelector<HTMLButtonElement>('[data-model-tile]')!
    await act(async () => {
      tile.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 10, clientY: 10 }),
      )
    })
    await settle()

    expect(putThumb).toHaveBeenCalledTimes(1)
    const save = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(save.path).toBe('/models/m.stl')
    expect(save.mtime).toBe(5)
    expect(save.png).toBeInstanceOf(Blob)
    expect(save.camera).toEqual(SETTLED)
    expect(save.axis).toBe('-z')
    expect(save.lighting).toBe('axis')
    expect(save.rig).toBe(RIG_VERSION)
    expect(save.posed).toBeUndefined()
  })

  it('labels the pixels of a posed view the user never touched', async () => {
    // The close that declines to write a camera still writes a picture, and
    // that picture was rendered at the index's pose. Unlabelled, the grid reads
    // it as stale on the next visit and renders the same view a second time —
    // the pose is an input to the pixels the cache key does not carry.
    opts.persist = { camera: false }
    const tile = container.querySelector<HTMLButtonElement>('[data-model-tile]')!
    await act(async () => {
      tile.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 10, clientY: 10 }),
      )
    })
    await settle()

    const save = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(save.png).toBeInstanceOf(Blob)
    // Still not the user's orientation: pixels only (semantic-search D5).
    expect(save.camera).toBeUndefined()
    expect(save.axis).toBeUndefined()
    expect(save.posed).toBe(POSE_VERSION)
  })
})
