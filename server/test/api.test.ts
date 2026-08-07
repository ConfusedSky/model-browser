import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DirListing, ThumbGetResponse } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { LOOPBACK, makeFixtures } from './helpers'

const fx = makeFixtures()
const cacheDir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
const cache = new ThumbCache(cacheDir)
const app = createApp(cache)

afterAll(() => {
  rmSync(fx.dir, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

function get(path: string, headers: Record<string, string> = LOOPBACK) {
  return app.request(path, { headers })
}

describe('same-origin guard', () => {
  it('refuses cross-origin requests', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(fx.dir)}`, {
      ...LOOPBACK,
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
  })

  it('refuses non-loopback Host (DNS rebinding)', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(fx.dir)}`, {
      host: 'evil.example',
      origin: 'http://localhost:5173',
    })
    expect(res.status).toBe(403)
  })

  it('allows loopback origins and emits no CORS headers', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(fx.dir)}`, {
      ...LOOPBACK,
      origin: 'http://localhost:5173',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('serves model bytes as octet-stream with nosniff', async () => {
    const res = await get(`/api/file?path=${encodeURIComponent(join(fx.dir, 'loose.stl'))}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('GET /api/dir', () => {
  it('lists dirs, zips, and models with metadata; skips hidden and non-models', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(fx.dir)}`)
    const body = (await res.json()) as DirListing
    const names = body.entries.map((e) => e.name)
    expect(names).toEqual(['sub', 'models.zip', 'loose.stl'])
    const model = body.entries.find((e) => e.name === 'loose.stl')!
    expect(model.kind).toBe('model')
    expect(model.format).toBe('stl')
    expect(model.size).toBeGreaterThan(0)
    expect(model.mtime).toBeGreaterThan(0)
  })

  it('404s on a missing path', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(join(fx.dir, 'nope'))}`)
    expect(res.status).toBe(404)
  })

  it('400s on a relative path', async () => {
    const res = await get('/api/dir?path=relative/path')
    expect(res.status).toBe(400)
  })
})

describe('zip virtual folders', () => {
  it('lists zip root from the central directory', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(fx.zipPath)}`)
    const body = (await res.json()) as DirListing
    const names = body.entries.map((e) => e.name)
    expect(names).toEqual(['parts', 'inner.zip', 'box.stl'])
    const dir = body.entries.find((e) => e.name === 'parts')!
    expect(dir.path).toBe(`${fx.zipPath}!/parts`)
  })

  it('lists a folder inside a zip', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(`${fx.zipPath}!/parts`)}`)
    const body = (await res.json()) as DirListing
    expect(body.entries.map((e) => e.name)).toEqual(['lid.stl'])
    expect(body.entries[0]!.path).toBe(`${fx.zipPath}!/parts/lid.stl`)
  })

  it('rejects entering a nested zip with a clear message', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent(`${fx.zipPath}!/inner.zip`)}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/nested zips are unsupported/)
  })

  it('422s on a corrupt zip', async () => {
    const bad = join(fx.dir, 'corrupt.zip')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(bad, Buffer.from('this is not a zip archive at all'))
    const res = await get(`/api/dir?path=${encodeURIComponent(bad)}`)
    expect(res.status).toBe(422)
    unlinkSync(bad)
  })

  it('decompresses a single entry on demand with intact bytes', async () => {
    const res = await get(`/api/file?path=${encodeURIComponent(`${fx.zipPath}!/parts/lid.stl`)}`)
    expect(res.status).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.equals(fx.lidStl)).toBe(true)
  })
})

describe('GET /api/complete', () => {
  it('completes a partial subdirectory name', async () => {
    const res = await get(`/api/complete?prefix=${encodeURIComponent(join(fx.dir, 'su'))}`)
    const body = (await res.json()) as string[]
    expect(body).toEqual([`${join(fx.dir, 'sub')}/`])
  })

  it('returns empty for unreadable parents', async () => {
    const res = await get(`/api/complete?prefix=${encodeURIComponent('/nope/nothing/here')}`)
    expect(await res.json()).toEqual([])
  })
})

describe('thumbnail cache API', () => {
  const path = join(fx.dir, 'loose.stl')
  const png = Buffer.from('fake-png-bytes').toString('base64')
  const camera = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] as [number, number, number] }

  it('miss before any put', async () => {
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    expect(((await res.json()) as ThumbGetResponse).status).toBe('miss')
  })

  it('hit after put, with camera and png', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, png, camera }),
    })
    expect(put.status).toBe(200)
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('hit')
    expect(body.png).toBe(png)
    expect(body.camera).toEqual(camera)
  })

  it('stale on mtime change, camera still served (keyed by path only)', async () => {
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=222`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('stale')
    expect(body.png).toBeUndefined()
    expect(body.camera).toEqual(camera)
  })

  it('camera-only put preserves the existing png keying', async () => {
    const cam2 = { ...camera, az: 2 }
    await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, camera: cam2 }),
    })
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('hit')
    expect(body.camera).toEqual(cam2)
  })
})
