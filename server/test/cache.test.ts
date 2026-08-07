import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThumbCache } from '../src/cache'
import { makeFixtures } from './helpers'

const cleanups: string[] = []

function tempCache(cap?: number): ThumbCache {
  const dir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
  cleanups.push(dir)
  return new ThumbCache(dir, cap ?? 2 * 1024 ** 3)
}

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

const CAM = { az: 1, el: 0, distR: 2, target: [0, 0, 0] as [number, number, number] }

describe('ThumbCache maintenance', () => {
  it('a new mtime replaces the png in place (no superseded accumulation)', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('one') })
    await cache.put(path, { mtime: 2, png: Buffer.from('two') })
    const pngs = readdirSync(cache.dir).filter((f) => f.endsWith('.png'))
    expect(pngs).toHaveLength(1)
    expect((await cache.get(path, 2)).status).toBe('hit')
    expect((await cache.get(path, 1)).status).toBe('stale')
  })

  it('sweeps whole entries (camera and axis included) when the source is gone', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: Buffer.from('png'), camera: CAM, axis: '-z' })
    unlinkSync(doomed)
    await cache.maintain()
    const res = await cache.get(doomed, 1)
    expect(res.status).toBe('miss')
    expect(res.camera).toBeUndefined()
    expect(res.axis).toBeUndefined()
    expect(readdirSync(cache.dir)).toHaveLength(0)
  })

  it('stores the axis beside the camera and defaults a missing axis to y', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    expect((await cache.get(path, 1)).axis).toBe('y') // pre-axis entry reads as +Y
    await cache.put(path, { mtime: 1, camera: CAM, axis: '-x' })
    const res = await cache.get(path, 1)
    expect(res.axis).toBe('-x')
    expect(res.status).toBe('hit') // axis write keyed by path — png keying untouched
    // A later png-only put must not drop the stored axis.
    await cache.put(path, { mtime: 2, png: Buffer.from('png2') })
    expect((await cache.get(path, 2)).axis).toBe('-x')
  })

  it('tests virtual-path existence against the containing zip, not the entry', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const vpath = `${fx.zipPath}!/parts/lid.stl`
    await cache.put(vpath, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    await cache.maintain()
    expect((await cache.get(vpath, 1)).status).toBe('hit')

    unlinkSync(fx.zipPath)
    await cache.maintain()
    expect((await cache.get(vpath, 1)).status).toBe('miss')
  })

  it('size-cap eviction removes least-recently-read pngs but spares camera state and axis', async () => {
    const cache = tempCache(10) // tiny cap: any two pngs exceed it
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const a = join(fx.dir, 'loose.stl')
    const b = fx.zipPath
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await cache.put(a, { mtime: 1, png: Buffer.from('aaaaaaaa'), camera: CAM, axis: 'z' })
    await tick()
    await cache.put(b, { mtime: 1, png: Buffer.from('bbbbbbbb'), camera: CAM })
    await tick()
    await cache.get(b, 1) // b is now more recently read than a
    await cache.maintain()

    const resA = await cache.get(a, 1)
    expect(resA.status).toBe('stale') // png gone…
    expect(resA.camera).toEqual(CAM) // …camera spared
    expect(resA.axis).toBe('z') // …axis spared too
    const pngs = readdirSync(cache.dir).filter((f) => f.endsWith('.png'))
    expect(pngs.length).toBeLessThanOrEqual(1)
  })

  it('a concurrent read cannot resurrect an entry the sweep removed', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    unlinkSync(doomed)
    // Hammer reads while the sweep runs: the lastRead touch must never
    // recreate the meta file the sweep just deleted.
    const reads = (async () => {
      for (let i = 0; i < 50; i++) await cache.get(doomed, 1)
    })()
    await cache.maintain()
    await reads
    expect((await cache.get(doomed, 1)).status).toBe('miss')
    expect(readdirSync(cache.dir)).toHaveLength(0)
  })

  it('runs maintenance automatically after the write threshold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
    cleanups.push(dir)
    const cache = new ThumbCache(dir, 2 * 1024 ** 3, 2) // maintain every 2 png writes
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    unlinkSync(doomed)
    await cache.put(join(fx.dir, 'loose.stl'), { mtime: 1, png: Buffer.from('png') })
    // second png write crosses the threshold → background sweep removes doomed
    for (let i = 0; i < 40 && (await cache.get(doomed, 1)).status !== 'miss'; i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect((await cache.get(doomed, 1)).status).toBe('miss')
  })

  it('is a no-op when the cache dir does not exist yet', async () => {
    const cache = new ThumbCache(join(tmpdir(), 'mb-does-not-exist'))
    await expect(cache.maintain()).resolves.toBeUndefined()
    expect(existsSync(cache.dir)).toBe(false)
  })
})
