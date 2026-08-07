import { describe, expect, it, vi } from 'vitest'
import { MeshLru } from '../src/three/lru'

interface Fake {
  path: string
  dispose: ReturnType<typeof vi.fn>
}

function makeLru(budget: number, sizes: Record<string, number>) {
  const disposed: string[] = []
  const lru = new MeshLru<Fake>(
    (path) =>
      Promise.resolve({
        object: { path, dispose: vi.fn() },
        bytes: sizes[path] ?? 0,
      }),
    (obj) => {
      disposed.push(obj.path)
      obj.dispose()
    },
    budget,
  )
  return { lru, disposed }
}

describe('MeshLru', () => {
  it('evicts by total byte budget, not entry count', async () => {
    const { lru, disposed } = makeLru(100, { a: 40, b: 40, c: 40 })
    await lru.acquire('a')
    await lru.acquire('b')
    expect(lru.size).toBe(80)
    await lru.acquire('c') // 120 > 100 → evict least-recently-used
    expect(disposed).toEqual(['a'])
    expect(lru.has('b')).toBe(true)
    expect(lru.has('c')).toBe(true)
  })

  it('disposes every evicted geometry (VRAM release)', async () => {
    const { lru } = makeLru(50, { a: 40, b: 40 })
    const a = await lru.acquire('a')
    await lru.acquire('b')
    expect(a.dispose).toHaveBeenCalledTimes(1)
  })

  it('acquire marks entries most-recently-used', async () => {
    const { lru, disposed } = makeLru(100, { a: 40, b: 40, c: 40 })
    await lru.acquire('a')
    await lru.acquire('b')
    await lru.acquire('a') // a is now MRU → b is the eviction candidate
    await lru.acquire('c')
    expect(disposed).toEqual(['b'])
  })

  it('never evicts the entry just inserted, even over budget', async () => {
    const { lru, disposed } = makeLru(10, { huge: 500 })
    await lru.acquire('huge')
    expect(disposed).toEqual([])
    expect(lru.has('huge')).toBe(true)
  })

  it('dedupes concurrent loads of the same path', async () => {
    let loads = 0
    const lru = new MeshLru<string>(
      async (path) => {
        loads++
        await new Promise((r) => setTimeout(r, 10))
        return { object: path, bytes: 1 }
      },
      () => {},
      100,
    )
    await Promise.all([lru.acquire('x'), lru.acquire('x'), lru.acquire('x')])
    expect(loads).toBe(1)
  })

  it('caps concurrent parses', async () => {
    let active = 0
    let peak = 0
    const lru = new MeshLru<string>(
      async (path) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
        return { object: path, bytes: 1 }
      },
      () => {},
      1000,
      2,
    )
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((p) => lru.acquire(p)))
    expect(peak).toBe(2)
  })

  it('warm swallows load errors', async () => {
    const lru = new MeshLru<string>(
      () => Promise.reject(new Error('boom')),
      () => {},
      100,
    )
    expect(() => lru.warm('x')).not.toThrow()
    await new Promise((r) => setTimeout(r, 5))
  })

  it('clear disposes everything', async () => {
    const { lru, disposed } = makeLru(1000, { a: 1, b: 1 })
    await lru.acquire('a')
    await lru.acquire('b')
    lru.clear()
    expect(disposed.sort()).toEqual(['a', 'b'])
    expect(lru.size).toBe(0)
  })
})
