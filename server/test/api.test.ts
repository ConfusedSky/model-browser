import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DirEntry, DirListing, ThumbGetResponse } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { LOOPBACK, libraryFor, makeFixtures } from './helpers'

const fx = makeFixtures()
const cacheDir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
const cache = new ThumbCache(cacheDir)
// Every path below is a library path: the fixture directory is the library's
// top, so it is `/` and `loose.stl` in it is `/loose.stl` (library-root D2).
const app = createApp(cache, undefined, undefined, libraryFor(fx.dir))

afterAll(() => {
  rmSync(fx.dir, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

function get(path: string, headers: Record<string, string> = LOOPBACK) {
  return app.request(path, { headers })
}

describe('same-origin guard', () => {
  it('refuses cross-origin requests', async () => {
    const res = await get('/api/dir?path=/', {
      ...LOOPBACK,
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
  })

  it('refuses non-loopback Host (DNS rebinding)', async () => {
    const res = await get('/api/dir?path=/', {
      host: 'evil.example',
      origin: 'http://localhost:5173',
    })
    expect(res.status).toBe(403)
  })

  it('allows loopback origins and emits no CORS headers', async () => {
    const res = await get('/api/dir?path=/', {
      ...LOOPBACK,
      origin: 'http://localhost:5173',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('serves model bytes as octet-stream with nosniff', async () => {
    const res = await get('/api/file?path=/loose.stl')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('GET /api/dir', () => {
  it('lists dirs, zips, and models with metadata; skips hidden and non-models', async () => {
    const res = await get('/api/dir?path=/')
    const body = (await res.json()) as DirListing
    const names = body.entries.map((e) => e.name)
    expect(names).toEqual(['linked', 'sub', 'models.zip', 'loose.stl'])
    const model = body.entries.find((e) => e.name === 'loose.stl')!
    expect(model.kind).toBe('model')
    expect(model.format).toBe('stl')
    expect(model.size).toBeGreaterThan(0)
    expect(model.mtime).toBeGreaterThan(0)
  })

  it('never shows the marker directory', async () => {
    // No rule of its own: `.model-browser` is dot-prefixed, so the hidden-entry
    // skip already covers it. This is the assertion that keeps that true.
    const res = await get('/api/dir?path=/')
    const body = (await res.json()) as DirListing
    expect(body.entries.some((e) => e.name === '.model-browser')).toBe(false)
  })

  it('every entry is addressed by a library path, not a filesystem one', async () => {
    const res = await get('/api/dir?path=/')
    const body = (await res.json()) as DirListing
    expect(body.entries.map((e) => e.path)).toEqual([
      '/linked',
      '/sub',
      '/models.zip',
      '/loose.stl',
    ])
    expect(body.path).toBe('/')
  })

  it("an entry's own path is what /api/file and /api/thumb take back", async () => {
    const listed = (await (await get('/api/dir?path=/')).json()) as DirListing
    const model = listed.entries.find((e) => e.name === 'loose.stl')!
    const file = await get(`/api/file?path=${encodeURIComponent(model.path)}`)
    expect(file.status).toBe(200)
    expect(Buffer.from(await file.arrayBuffer()).length).toBeGreaterThan(0)
    const thumb = await get(
      `/api/thumb?path=${encodeURIComponent(model.path)}&mtime=${model.mtime}`,
    )
    expect(thumb.status).toBe(200)
    expect(((await thumb.json()) as ThumbGetResponse).status).toBe('miss')
  })

  it('lists a symlinked directory as a dir entry', async () => {
    const res = await get('/api/dir?path=/')
    const body = (await res.json()) as DirListing
    const linked = body.entries.find((e) => e.name === 'linked')
    expect(linked?.kind).toBe('dir')
  })

  it('404s on a missing path', async () => {
    const res = await get('/api/dir?path=/nope')
    expect(res.status).toBe(404)
  })

  it('a path under the top that does not exist is never a refusal', async () => {
    // Not-found and refused are different answers (library spec): a deep link
    // to a deleted folder must not read as "outside the library".
    for (const p of ['/nope', '/nope/deeper/still', '/sub/gone.stl']) {
      const res = await get(`/api/dir?path=${encodeURIComponent(p)}`)
      expect([p, res.status]).toEqual([p, 404])
    }
  })

  it('a climbing path folds against the top rather than being refused', async () => {
    const top = (await (await get('/api/dir?path=/')).json()) as DirListing
    const res = await get('/api/dir?path=/..')
    expect(res.status).toBe(200)
    const body = (await res.json()) as DirListing
    expect(body.entries).toEqual(top.entries)
  })

  it('400s on a relative path', async () => {
    const res = await get('/api/dir?path=relative/path')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('path must be a library path')
  })
})

describe('zip virtual folders', () => {
  it('lists zip root from the central directory', async () => {
    const res = await get('/api/dir?path=/models.zip')
    const body = (await res.json()) as DirListing
    const names = body.entries.map((e) => e.name)
    expect(names).toEqual(['parts', 'v2.zip', 'inner.zip', 'box.stl'])
    const dir = body.entries.find((e) => e.name === 'parts')!
    expect(dir.path).toBe('/models.zip!/parts')
  })

  it('a directory named *.zip inside a zip stays navigable', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent('/models.zip!/v2.zip')}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as DirListing
    expect(body.entries.map((e) => e.name)).toEqual(['deep2.stl'])
  })

  it('lists a folder inside a zip', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent('/models.zip!/parts')}`)
    const body = (await res.json()) as DirListing
    expect(body.entries.map((e) => e.name)).toEqual(['lid.stl'])
    expect(body.entries[0]!.path).toBe('/models.zip!/parts/lid.stl')
  })

  it('rejects entering a nested zip with a clear message', async () => {
    const res = await get(`/api/dir?path=${encodeURIComponent('/models.zip!/inner.zip')}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/nested zips are unsupported/)
  })

  it('422s on a corrupt zip', async () => {
    const bad = join(fx.dir, 'corrupt.zip')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(bad, Buffer.from('this is not a zip archive at all'))
    const res = await get('/api/dir?path=/corrupt.zip')
    expect(res.status).toBe(422)
    unlinkSync(bad)
  })

  it('decompresses a single entry on demand with intact bytes', async () => {
    const res = await get(`/api/file?path=${encodeURIComponent('/models.zip!/parts/lid.stl')}`)
    expect(res.status).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.equals(fx.lidStl)).toBe(true)
  })

  it("an archive entry's listed path round-trips through /api/file", async () => {
    const listed = (await (
      await get(`/api/dir?path=${encodeURIComponent('/models.zip!/parts')}`)
    ).json()) as DirListing
    const lid = listed.entries.find((e) => e.name === 'lid.stl') as DirEntry
    const res = await get(`/api/file?path=${encodeURIComponent(lid.path)}`)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(fx.lidStl)).toBe(true)
  })
})

describe('GET /api/complete', () => {
  it('completes a partial subdirectory name', async () => {
    const res = await get('/api/complete?prefix=/su')
    const body = (await res.json()) as string[]
    expect(body).toEqual(['/sub/'])
  })

  it('returns empty for unreadable parents', async () => {
    const res = await get(`/api/complete?prefix=${encodeURIComponent('/nope/nothing/here')}`)
    expect(await res.json()).toEqual([])
  })
})

describe('thumbnail cache API', () => {
  const path = '/loose.stl'
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

  it('an entry without a stored axis reports none, rather than reporting y', async () => {
    // The absence is information: a caller distinguishing "the user chose an
    // orientation" from "nothing is stored" cannot do it if the cache answers
    // 'y' either way. Defaulting is the caller's job, and every caller does it.
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    expect(((await res.json()) as ThumbGetResponse).axis).toBeUndefined()
  })

  it('put stores the axis and get serves it back', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, camera, axis: '-z' }),
    })
    expect(put.status).toBe(200)
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.axis).toBe('-z')
    expect(body.camera).toEqual(camera)
  })

  it('rejects an invalid axis', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, axis: 'w' }),
    })
    expect(put.status).toBe(400)
  })

  it('put stores the lighting mode and get serves it back', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, png, lighting: 'camera' }),
    })
    expect(put.status).toBe(200)
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    expect(((await res.json()) as ThumbGetResponse).lighting).toBe('camera')
  })

  it('rejects an invalid lighting mode', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, lighting: 'disco' }),
    })
    expect(put.status).toBe(400)
  })

  it('put stores the rig version and get serves it back', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, png, rig: 2 }),
    })
    expect(put.status).toBe(200)
    const res = await get(`/api/thumb?path=${encodeURIComponent(path)}&mtime=111`)
    expect(((await res.json()) as ThumbGetResponse).rig).toBe(2)
  })

  it('rejects a non-numeric rig version', async () => {
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, rig: 'two' }),
    })
    expect(put.status).toBe(400)
  })

  it('carries a discard over the wire — null clears, and is not a bad axis', async () => {
    // The route is where `null` could most easily be lost: JSON drops
    // `undefined` and the axis validator would 400 a null it did not expect,
    // which would make reset framing fail as a client bug at the last hop.
    const other = '/discarded.stl'
    const stored = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: other, mtime: 111, png, camera, axis: '-z' }),
    })
    expect(stored.status).toBe(200)
    const discard = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: other, mtime: 111, png, camera: null, axis: null, rig: 9 }),
    })
    expect(discard.status).toBe(200)
    const res = await get(`/api/thumb?path=${encodeURIComponent(other)}&mtime=111`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('hit')
    expect(body.camera).toBeUndefined()
    expect(body.axis).toBeUndefined()
    expect(body.rig).toBe(9) // the pixels' own labels still land
  })
})
