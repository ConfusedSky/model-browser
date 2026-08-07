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
})

describe('thumbnail cache lookups vs the render queue', () => {
  it('cache hits resolve while the queue is suspended — lookups never occupy a slot', async () => {
    const api = {
      getThumb: vi.fn().mockResolvedValue({ status: 'hit', pngUrl: 'blob:cached' }),
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
  })
})
