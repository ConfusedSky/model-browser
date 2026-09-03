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
    // Read once on mount like the two above. A ready library so the grid
    // renders — nothing about the persist path depends on the state.
    library = vi.fn().mockResolvedValue({ state: 'ready', id: 'test', top: '/lib', root: '/' })
    semanticSearch = vi.fn()
    // The pose wave a landed listing fires (pose-for-every-model D3). An index
    // with no orientation to offer, like `indexAvailability`'s absent one above:
    // nothing about the persist path depends on a pose, but the call has to
    // exist or the wave throws where the grid is being drawn.
    semanticPoses = vi.fn().mockResolvedValue({ poses: {} })
    semanticPosesFor = vi.fn().mockResolvedValue({ poses: {} })
    // The session's one registry reading, which App does on mount: a machine
    // with nothing associated and no chooser, so nothing about the persist
    // path changes here.
    apps = vi.fn().mockResolvedValue({ chooser: false, types: {} })
    // What the server offers (feature-report), read on mount beside `apps`. A
    // known all-on report — today's server — so the persist path is the one
    // this file was written against; the report gates no surface it touches.
    features = vi.fn().mockResolvedValue({ thumbWrites: true })
    open = vi.fn()
    openWith = vi.fn()
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
const opts = vi.hoisted(() => ({
  persist: undefined as { camera?: boolean } | undefined,
  // What the stub session's `snapshot` was handed — the value `persist`
  // captured before its await, which must also be the one on the PUT.
  snapshotAo: undefined as boolean | undefined,
  /** Run inside `snapshot`, i.e. during the await `persist` holds across. A
   *  test uses it to move the preference under a persist in flight. */
  duringSnapshot: undefined as (() => void) | undefined,
}))
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
          snapshot: (ao?: boolean) => {
            opts.snapshotAo = ao
            opts.duringSnapshot?.()
            return Promise.resolve(new Blob(['png']))
          },
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
const { RIG_VERSION, THUMB_LIGHTING } = await import('../src/three/renderer')
const { POSE_VERSION } = await import('../src/three/pose')
const { setAoEnabled } = await import('../src/viewer/aoToggle')

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
  opts.snapshotAo = undefined
  opts.duringSnapshot = undefined
  // A module closure, so localStorage.clear() in afterEach does not reset it
  // (client/test/CLAUDE.md). Pinned ON — which is NOT the shipped default since
  // `ao-default-off` flipped the unset read to off. These cases were written
  // under the old on-default and assert about the occluded recipe; the ones
  // that want it off say so before opening the viewer.
  setAoEnabled(true)
  // The boot path, through the URL: `resolveView` opens at the library's top
  // (design D2/D7) and reads no last path, so this is what puts the app in
  // /models the way the storage seed used to.
  window.history.replaceState(null, '', '/?path=%2Fmodels')
  // A subclass, never a spread copy: happy-dom parses every <img src> with the
  // global URL and fires `error` synchronously when that throws (client/test/CLAUDE.md).
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL: () => 'blob:m', revokeObjectURL: () => {} }),
  )
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: () => {} }))
  listDir.mockReset()
  listDir.mockResolvedValue(LISTING)
  getThumb.mockReset()
  getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:t', lighting: THUMB_LIGHTING, rig: RIG_VERSION })
  putThumb.mockReset()
  putThumb.mockResolvedValue({})
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
    expect(save.lighting).toBe(THUMB_LIGHTING)
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

describe('the persist PUT names one occlusion render', () => {
  /** Open the viewer on the one tile, which is what runs the stubbed persist. */
  async function release(): Promise<void> {
    const tile = container.querySelector<HTMLButtonElement>('[data-model-tile]')!
    await act(async () => {
      tile.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 10, clientY: 10 }),
      )
    })
    await settle()
  }

  it('an orbit released with the preference off snapshots and files the unoccluded render', async () => {
    setAoEnabled(false)
    await release()

    // The snapshot goes through `renderThumbnail`, not the live chain, so
    // without the argument these pixels would be occluded whatever the pill
    // says — the standing mismatch this change closes (D4a). That the
    // argument reaches the chain is composer.test.ts's cell.
    expect(opts.snapshotAo).toBe(false)
    const save = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(save.ao).toBe(false)
    // The camera travels with it, which is what makes the *other* render's
    // labels stale server-side. That invalidation is the server's rule and is
    // asserted in server/test/cache.test.ts — a mocked ApiClient here could
    // only round-trip whatever this file told it to, so this cell pins the
    // half the client is actually responsible for: the PUT carries both.
    expect(save.camera).toEqual(SETTLED)
    expect(save.axis).toBe('-z')
    expect(save.png).toBeInstanceOf(Blob)
  })

  it('reads the preference once: a toggle mid-snapshot cannot split the pixels from their slot', async () => {
    // Two independent reads — one for the render, one for the PUT — would file
    // unoccluded pixels under the occluded slot with matching labels here: a
    // wrong-recipe hit nothing invalidates, because both readings were correct
    // where they stood (D4a). The capture before the await is what forbids it.
    setAoEnabled(false)
    opts.duringSnapshot = () => setAoEnabled(true)
    await release()

    expect(opts.snapshotAo).toBe(false)
    const save = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(save.ao).toBe(false) // the captured value, not the one now in force
  })
})
