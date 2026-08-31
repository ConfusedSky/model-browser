// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import type { DirEntry } from '../../shared/types'
import type { ApiClient } from '../src/api/client'
import { useThumbnails } from '../src/hooks/useThumbnails'
import type { MeshLru } from '../src/three/lru'
import { RenderQueue } from '../src/three/queue'
import { renderThumbnail, RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

// The hook only reaches the renderer through renderThumbnail — fake it.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  // Spread, never a hand-listed factory: RIG_VERSION and THUMB_LIGHTING are the
  // recipe labels these tests assert, and a literal would keep passing across a
  // bump while asserting a value the app no longer writes (client/test/CLAUDE.md).
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function models(n: number): DirEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `m${i}.stl`,
    path: `/models/m${i}.stl`,
    kind: 'model' as const,
    format: 'stl' as const,
    size: 10,
    mtime: 1,
  }))
}

function Harness({
  entries,
  api,
  lru,
  queue,
}: {
  entries: DirEntry[]
  api: ApiClient
  lru: MeshLru<THREE.Object3D>
  queue: RenderQueue
}) {
  const { thumbs } = useThumbnails(entries, api, lru, queue)
  return (
    <div>
      {entries.map((e) => (
        <span key={e.path} data-path={e.path} data-status={thumbs.get(e.path)?.status ?? 'none'} />
      ))}
    </div>
  )
}

let root: Root | null = null
let container: HTMLElement | null = null

async function render(el: React.ReactElement): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(el)
  })
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 50)))

function statuses(): string[] {
  return Array.from(container!.querySelectorAll('span')).map(
    (s) => s.getAttribute('data-status') ?? '',
  )
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
  // The renderThumbnail spy lives in the module mock, so its calls accumulate
  // across this file — a render *count* assertion reads the whole file's
  // history unless it is reset per test.
  vi.mocked(renderThumbnail).mockClear()
})

describe('thumbnail cache lookups vs the render queue', () => {
  it('cache hits resolve while the queue is suspended — lookups never occupy a slot', async () => {
    const api = {
      getThumb: vi
        .fn()
        .mockResolvedValue({ status: 'hit', pngUrl: 'blob:cached', lighting: THUMB_LIGHTING, rig: RIG_VERSION }),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn() } as unknown as MeshLru<THREE.Object3D>
    const queue = new RenderQueue(2)
    queue.suspend() // a suspended queue runs nothing; hits must not need it

    await render(<Harness entries={models(6)} api={api} lru={lru} queue={queue} />)
    await settle()

    expect(statuses()).toEqual(Array.from({ length: 6 }, () => 'ready'))
    expect(lru.acquire).not.toHaveBeenCalled()
  })

  it('the miss path stays gated: no render work while suspended, completes on resume', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>
    const queue = new RenderQueue(2)
    queue.suspend()

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={queue} />)
    await settle()

    expect(statuses()).toEqual(['loading', 'loading']) // lookups ran, tails blocked
    expect(api.getThumb).toHaveBeenCalledTimes(2)
    expect(lru.acquire).not.toHaveBeenCalled()

    await act(async () => {
      queue.resume()
    })
    await settle()

    expect(statuses()).toEqual(['ready', 'ready'])
    expect(api.putThumb).toHaveBeenCalledTimes(2)
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
  })

  it('a hit carrying the retired axis label re-renders, preserving camera and axis', async () => {
    const camera = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] }
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:axisLit',
        camera,
        axis: '-z',
        lighting: 'axis', // the retired spindle-aligned label — no client writes it now
        rig: RIG_VERSION, // current rig — the lighting clause alone must trigger this
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    // The stale PNG was dropped and replaced through the render queue…
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:axisLit')
    expect(lru.acquire).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
    // …with the render PUT recording the producible label, and no camera or
    // axis write — both are preserved by omission.
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.camera).toBeUndefined()
    expect(put.axis).toBeUndefined()
  })

  it('a camera-lit hit serves directly while an axis-lit one re-renders', async () => {
    const api = {
      getThumb: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'hit',
          pngUrl: 'blob:cam',
          lighting: THUMB_LIGHTING,
          rig: RIG_VERSION,
        })
        .mockResolvedValueOnce({ status: 'hit', pngUrl: 'blob:ax', lighting: 'axis', rig: RIG_VERSION }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready', 'ready'])
    expect(lru.acquire).toHaveBeenCalledTimes(1) // only the axis-lit one re-rendered
    expect(api.putThumb).toHaveBeenCalledTimes(1)
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
  })

  // The spec's "A camera-lit cache needs nothing" scenario. The render count is
  // the assertion, not the status: a hit test that treated the label as always
  // stale would still land every tile on 'ready' — after re-rendering and
  // re-uploading all of them, which is exactly the cost this forbids.
  it('a camera-lit cache at the current rig needs nothing: no render, no PUT', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:fresh',
        camera: { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] },
        axis: '-z',
        lighting: THUMB_LIGHTING,
        rig: RIG_VERSION,
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(4)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready', 'ready', 'ready', 'ready'])
    expect(vi.mocked(renderThumbnail)).not.toHaveBeenCalled()
    expect(lru.acquire).not.toHaveBeenCalled()
    expect(api.putThumb).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:fresh')
  })

  it('a failed re-render falls back to the stale PNG instead of an error tile', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:fallback',
        camera: { az: 1, el: 0, distR: 2, target: [0, 0, 0] },
        lighting: 'axis',
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = {
      acquire: vi.fn().mockRejectedValue(new Error('load failed')),
    } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready']) // not 'error' — the old PNG still shows
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:fallback')
  })

  it('a hit from an older rig re-renders, preserving camera, and PUTs the current version', async () => {
    const camera = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] }
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:oldRig',
        camera,
        axis: '-z',
        lighting: THUMB_LIGHTING, // label matches — only the rig version is stale
        rig: 1,
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:oldRig')
    expect(statuses()).toEqual(['ready'])
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING, rig: RIG_VERSION }),
    )
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.camera).toBeUndefined() // stored camera preserved by omission
  })

  it('a legacy hit with no stored label also re-renders', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'hit', pngUrl: 'blob:legacy' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:legacy')
    expect(api.putThumb).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: THUMB_LIGHTING }),
    )
    expect(statuses()).toEqual(['ready'])
  })

  it('abandoning a listing cancels its queued lookups', async () => {
    // The limiter replaced the render queue for lookups, so it has to carry
    // the queue's cancellation too — otherwise a dead listing's backlog runs
    // to completion and head-of-line blocks its successor.
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const api = {
      getThumb: vi.fn(() => gate.then(() => ({ status: 'miss' }))),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn() } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(20)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()
    expect(api.getThumb).toHaveBeenCalledTimes(8) // the limiter's ceiling

    await act(async () => {
      root!.unmount()
      root = null
    })
    release()
    await settle()

    expect(api.getThumb).toHaveBeenCalledTimes(8) // the queued 12 never fired
  })

  it('a hit landing after the listing is gone revokes its object URL', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const api = {
      getThumb: vi.fn(() => gate.then(() => ({ status: 'hit', pngUrl: 'blob:orphan' }))),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn() } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()
    await act(async () => {
      root!.unmount()
      root = null
    })
    release()
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:orphan')
  })
})
