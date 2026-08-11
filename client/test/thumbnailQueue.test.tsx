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
import { setLightingMode } from '../src/viewer/lighting'

// The hook only reaches the renderer through renderThumbnail — fake it.
vi.mock('../src/three/renderer', () => ({
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
  setLightingMode('axis')
})

describe('thumbnail cache lookups vs the render queue', () => {
  it('cache hits resolve while the queue is suspended — lookups never occupy a slot', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'hit', pngUrl: 'blob:cached', lighting: 'axis' }),
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
    expect(api.putThumb).toHaveBeenCalledWith(expect.objectContaining({ lighting: 'axis' }))
  })

  it('a hit lit under another mode re-renders, preserving camera and axis', async () => {
    const camera = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] }
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:otherMode',
        camera,
        axis: '-z',
        lighting: 'camera', // active mode is the default 'axis'
      }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    // The mismatched PNG was dropped and replaced through the render queue…
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:otherMode')
    expect(lru.acquire).toHaveBeenCalledTimes(1)
    expect(statuses()).toEqual(['ready'])
    // …with the render PUT recording the active mode, and no camera write —
    // the stored camera state is preserved by omission.
    expect(api.putThumb).toHaveBeenCalledWith(expect.objectContaining({ lighting: 'axis' }))
    const put = vi.mocked(api.putThumb).mock.calls[0]![0]
    expect(put.camera).toBeUndefined()
  })

  it('in camera mode, a camera-lit hit serves directly and an axis-lit one re-renders', async () => {
    setLightingMode('camera')
    const api = {
      getThumb: vi
        .fn()
        .mockResolvedValueOnce({ status: 'hit', pngUrl: 'blob:cam', lighting: 'camera' })
        .mockResolvedValueOnce({ status: 'hit', pngUrl: 'blob:ax', lighting: 'axis' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(2)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(statuses()).toEqual(['ready', 'ready'])
    expect(lru.acquire).toHaveBeenCalledTimes(1) // only the axis-lit one re-rendered
    expect(api.putThumb).toHaveBeenCalledTimes(1)
    expect(api.putThumb).toHaveBeenCalledWith(expect.objectContaining({ lighting: 'camera' }))
  })

  it('a failed re-render falls back to the mismatched PNG instead of an error tile', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({
        status: 'hit',
        pngUrl: 'blob:fallback',
        camera: { az: 1, el: 0, distR: 2, target: [0, 0, 0] },
        lighting: 'camera',
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

  it('a legacy hit with no stored mode also re-renders', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'hit', pngUrl: 'blob:legacy' }),
      putThumb: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient
    const lru = { acquire: vi.fn().mockResolvedValue({}) } as unknown as MeshLru<THREE.Object3D>

    await render(<Harness entries={models(1)} api={api} lru={lru} queue={new RenderQueue(2)} />)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:legacy')
    expect(api.putThumb).toHaveBeenCalledWith(expect.objectContaining({ lighting: 'axis' }))
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
