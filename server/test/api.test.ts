import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
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

  it('canonicalises its path like every sibling route, and says so when it misses', async () => {
    // It was the one path route that did not, so its 404 echoed the spelling
    // back exactly as asked: a `../` walk-and-return came back named that way,
    // in a shape `/api/dir` and `/api/peek` would have normalised before
    // answering. The path is not *refused* — it never was, since `resolve`
    // normalises internally for its own confinement — it is simply answered in
    // the app's own spelling.
    for (const [asked, canonical] of [
      ['//gone.stl', '/gone.stl'],
      ['/sub/../gone.stl', '/gone.stl'],
      ['/sub/./gone.stl', '/sub/gone.stl'],
    ]) {
      const res = await get(`/api/file?path=${encodeURIComponent(asked!)}`)
      expect([asked, res.status]).toEqual([asked, 404])
      expect(await res.json()).toEqual({ error: `no such file: ${canonical}` })
    }
  })

  it('and the bytes it does serve are unchanged by that', async () => {
    // The control: the same normalisations over a model that *is* there answer
    // it, so the canonicalisation is a spelling change and not a new refusal.
    const direct = Buffer.from(await (await get('/api/file?path=/loose.stl')).arrayBuffer())
    for (const asked of ['//loose.stl', '/sub/../loose.stl', '/./loose.stl']) {
      const res = await get(`/api/file?path=${encodeURIComponent(asked)}`)
      expect([asked, res.status]).toEqual([asked, 200])
      expect(Buffer.from(await res.arrayBuffer()).equals(direct)).toBe(true)
    }
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

  it('echoes one spelling of a path, whatever spelling was asked for', async () => {
    // The echoed `path` is what the client asks for next — and, on the thumb
    // routes, what the cache is keyed by. A spelling taken in verbatim is
    // therefore a spelling handed back and carried forward: `//sub` minted a
    // second identity for one directory.
    for (const spelling of ['//sub', '/sub/.', '/sub/', '/loose.stl/../sub']) {
      const res = await get(`/api/dir?path=${encodeURIComponent(spelling)}`)
      expect([spelling, res.status]).toEqual([spelling, 200])
      expect([spelling, ((await res.json()) as DirListing).path]).toEqual([spelling, '/sub'])
    }
  })

  it('refuses an entry half on something that is not an archive, without an errno', async () => {
    // A `!/` on a directory (or on a plain file) reached the zip reader, which
    // opened it and raised EISDIR — a 500 carrying an errno and the filesystem
    // path, for a request that was merely malformed.
    for (const path of ['/sub!/', '/sub!/x', '/notes.txt!/', '/notes.txt!/x']) {
      for (const extra of ['', '&flat=true']) {
        const res = await get(`/api/dir?path=${encodeURIComponent(path)}${extra}`)
        expect([path, extra, res.status]).toEqual([path, extra, 400])
        const body = (await res.json()) as { error: string }
        expect(body.error).toBe(`not an archive: ${path}`)
        expect(body.error).not.toMatch(/EISDIR|ENOTDIR|errno/)
        expect(body.error).not.toContain(fx.dir)
      }
    }
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
    // 'camera' is the one label a client can produce (remove-axis-lighting D2);
    // this is the accepted side of the refusal two tests below.
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

  it('refuses a put declaring the retired axis lighting label', async () => {
    // `LightingMode` still admits 'axis' so old entries stay readable, so the
    // type alone does not stop a client writing one. The route is where the
    // "one producible value" rule lives (remove-axis-lighting D2), and it
    // refuses with the same shape every other invalid field uses.
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path, mtime: 111, png, lighting: 'axis' }),
    })
    expect(put.status).toBe(400)
    expect(await put.json()).toEqual({ error: 'invalid lighting: axis' })
  })

  it('echoes a stored axis label on hits and on stale reads', async () => {
    // Written through the cache, not the route: the route no longer has a way
    // to produce this entry, and it is precisely the entry a machine whose
    // cache predates remove-axis-lighting still holds. The server stores and
    // echoes the label without interpreting it — deciding it is stale is the
    // client's job, and it cannot make that call on a label it never sees.
    const legacy = '/legacy-axis.stl'
    await cache.put(legacy, {
      mtime: 111,
      png: Buffer.from('fake-png-bytes'),
      camera,
      axis: '-z',
      lighting: 'axis',
    })

    const hit = (await (
      await get(`/api/thumb?path=${encodeURIComponent(legacy)}&mtime=111`)
    ).json()) as ThumbGetResponse
    expect(hit.status).toBe('hit')
    expect(hit.lighting).toBe('axis')
    expect(hit.png).toBe(png)

    const stale = (await (
      await get(`/api/thumb?path=${encodeURIComponent(legacy)}&mtime=222`)
    ).json()) as ThumbGetResponse
    expect(stale.status).toBe('stale')
    expect(stale.lighting).toBe('axis')
    // Camera and axis survive the staleness, so the re-render can keep them.
    expect(stale.camera).toEqual(camera)
    expect(stale.axis).toBe('-z')
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

  it('keys one file on one entry, however the path was spelled', async () => {
    // The cache key is the string itself, so an uncanonicalised path is a
    // second entry for the same file: a thumbnail written under one spelling
    // was a miss under the other, and the tile re-rendered forever.
    const put = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/sub/../loose.stl', mtime: 424, png, camera }),
    })
    expect(put.status).toBe(200)
    const res = await get(`/api/thumb?path=${encodeURIComponent('/loose.stl')}&mtime=424`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('hit')
    expect(body.png).toBe(png)
    expect(body.camera).toEqual(camera)
  })

  /**
   * `ao` on the wire (`ao-as-recipe-dimension` D2). Absent means `on` on both
   * verbs, so a client from before this change reads and writes exactly what it
   * always did — which is what makes "no migration" true of the protocol as
   * well as of the files.
   */
  describe('the occlusion dimension', () => {
    const noAo = '/pre-existing.stl'
    const png2 = Buffer.from('other-fake-png-bytes').toString('base64')

    it('reads an entry written without `ao` as the occluded render, under `ao` absent and `ao=on`', async () => {
      const put = await app.request('/api/thumb', {
        method: 'PUT',
        headers: { ...LOOPBACK, 'content-type': 'application/json' },
        body: JSON.stringify({ path: noAo, mtime: 111, png, camera, axis: '-z', rig: 4, lighting: 'camera' }),
      })
      expect(put.status).toBe(200)

      for (const q of ['', '&ao=on']) {
        const body = (await (await get(`/api/thumb?path=${encodeURIComponent(noAo)}&mtime=111${q}`)).json()) as ThumbGetResponse
        expect(body.status).toBe('hit')
        expect(body.png).toBe(png)
        expect(body.rig).toBe(4)
        expect(body.camera).toEqual(camera)
      }
    })

    it('reads its unoccluded render as stale, carrying the shared camera and axis', async () => {
      const res = await get(`/api/thumb?path=${encodeURIComponent(noAo)}&mtime=111&ao=off`)
      const body = (await res.json()) as ThumbGetResponse
      expect(body.status).toBe('stale') // the entry holds a camera, so not a miss
      expect(body.png).toBeUndefined()
      expect(body.rig).toBeUndefined() // the occluded render's label is not this one's
      expect(body.camera).toEqual(camera) // shared, and carried whatever the status
      expect(body.axis).toBe('-z')
    })

    it('reads the unoccluded render of an entry with no orientation as a miss', async () => {
      const bare = '/bare.stl'
      await app.request('/api/thumb', {
        method: 'PUT',
        headers: { ...LOOPBACK, 'content-type': 'application/json' },
        body: JSON.stringify({ path: bare, mtime: 111, png, rig: 4 }),
      })
      const body = (await (await get(`/api/thumb?path=${encodeURIComponent(bare)}&mtime=111&ao=off`)).json()) as ThumbGetResponse
      expect(body.status).toBe('miss')
      expect(body.camera).toBeUndefined()
    })

    it('writes the sibling render on `ao:false` and leaves the occluded labels alone', async () => {
      const put = await app.request('/api/thumb', {
        method: 'PUT',
        headers: { ...LOOPBACK, 'content-type': 'application/json' },
        body: JSON.stringify({ path: noAo, mtime: 111, png: png2, ao: false, rig: 7, lighting: 'camera' }),
      })
      expect(put.status).toBe(200)

      const off = (await (await get(`/api/thumb?path=${encodeURIComponent(noAo)}&mtime=111&ao=off`)).json()) as ThumbGetResponse
      expect(off.status).toBe('hit')
      expect(off.png).toBe(png2)
      expect(off.rig).toBe(7)
      expect(off.camera).toEqual(camera)

      // No camera on that write, so the occluded render is untouched: toggling
      // the preference back is a lookup, not a re-render.
      const on = (await (await get(`/api/thumb?path=${encodeURIComponent(noAo)}&mtime=111&ao=on`)).json()) as ThumbGetResponse
      expect(on.status).toBe('hit')
      expect(on.png).toBe(png)
      expect(on.rig).toBe(4)
    })

    it('rejects an `ao` query that is neither on nor off', async () => {
      const res = await get(`/api/thumb?path=${encodeURIComponent(noAo)}&mtime=111&ao=maybe`)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid ao: maybe' })
    })

    it('rejects a non-boolean `ao` on a put', async () => {
      // `false` is a value the route must act on, so this cannot be a
      // truthiness test: a string 'off' would read as *occluded* and file
      // unoccluded pixels over the shipped render.
      const put = await app.request('/api/thumb', {
        method: 'PUT',
        headers: { ...LOOPBACK, 'content-type': 'application/json' },
        body: JSON.stringify({ path: noAo, mtime: 111, png, ao: 'off' }),
      })
      expect(put.status).toBe(400)
      expect(await put.json()).toEqual({ error: 'invalid ao: off' })
    })
  })
})

/**
 * The wiring production runs on, which no test built before: a cache that was
 * given the library it files under. Everything above shares one flat-layout
 * cache (no library), so the per-library directory — the whole point of D5 —
 * was exercised only by `cache.test.ts` calling the class directly.
 */
describe('a cache under the app’s own library', () => {
  const perLib = libraryFor(fx.dir)
  const perLibCache = mkdtempSync(join(tmpdir(), 'mb-perlib-cache-'))
  const perLibApp = createApp(
    new ThumbCache(perLibCache, undefined, undefined, perLib),
    undefined,
    undefined,
    perLib,
  )

  afterAll(() => rmSync(perLibCache, { recursive: true, force: true }))

  it('files an entry under the library’s id and serves it back', async () => {
    const png = Buffer.from('per-library-png').toString('base64')
    const put = await perLibApp.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/loose.stl', mtime: 7, png }),
    })
    expect(put.status).toBe(200)

    // Nothing flat: the id directory is the only thing in the cache dir.
    const idDir = join(perLibCache, perLib.id())
    expect(readdirSync(perLibCache)).toEqual([perLib.id()])
    expect(readdirSync(idDir).map((f) => f.slice(f.lastIndexOf('.'))).sort()).toEqual([
      '.json',
      '.png',
    ])

    const res = await perLibApp.request(
      `/api/thumb?path=${encodeURIComponent('/loose.stl')}&mtime=7`,
      { headers: LOOPBACK },
    )
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('hit')
    expect(body.png).toBe(png)
  })
})

/**
 * Cacheability of thumbnail reads (`immutable-thumbnail-serving`).
 *
 * These are the first header assertions about caching in this suite — the
 * existing ones cover `content-type` and the same-origin guard — so the idiom
 * is `res.headers.get('cache-control')`, lower-cased because `Headers` is
 * case-insensitive on read and that is how the rest of the file spells it.
 *
 * A cache of its own, not the module-level one: every cell here reasons about
 * exact generation values, and the shared cache has been written by two hundred
 * lines of earlier cells.
 */
describe('thumbnail cacheability', () => {
  const cacheDir2 = mkdtempSync(join(tmpdir(), 'mb-cache-gen-'))
  const cache2 = new ThumbCache(cacheDir2)
  const app2 = createApp(cache2, undefined, undefined, libraryFor(fx.dir))
  const png2 = Buffer.from('gen-fake-png').toString('base64')
  const path2 = '/loose.stl'
  const cam2 = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] as [number, number, number] }

  const get2 = (q: string, headers: Record<string, string> = LOOPBACK) =>
    app2.request(`/api/thumb?${q}`, { headers })
  const put2 = (body: Record<string, unknown>) =>
    app2.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  afterAll(() => {
    rmSync(cacheDir2, { recursive: true, force: true })
  })

  it('never lets a miss be stored — the tile that would stay empty forever', async () => {
    const res = await get2(`path=${encodeURIComponent('/nothing-here.stl')}&mtime=1`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).toBe('miss')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // No validator either: there is nothing to revalidate against, and an ETag
    // here would invite a 304 that answers "your miss is still current".
    expect(res.headers.get('etag')).toBeNull()
  })

  it('answers a PUT with the generation it wrote, and the next read agrees', async () => {
    const put = await put2({ path: path2, mtime: 111, png: png2 })
    expect(put.status).toBe(200)
    const written = (await put.json()) as { ok: boolean; gen: number }
    expect(typeof written.gen).toBe('number')

    const body = (await (await get2(`path=${encodeURIComponent(path2)}&mtime=111`)).json()) as ThumbGetResponse
    expect(body.status).toBe('hit')
    // The echo is the point: a writer must be able to key its own next read
    // from its own write, without a round trip to discover what it caused.
    expect(body.gen).toBe(written.gen)
  })

  it('pins a read that names the current generation, and only that read', async () => {
    const cur = ((await (await get2(`path=${encodeURIComponent(path2)}&mtime=111`)).json()) as ThumbGetResponse).gen!

    const fresh = await get2(`path=${encodeURIComponent(path2)}&mtime=111&gen=${cur}`)
    expect(fresh.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(((await fresh.json()) as ThumbGetResponse).status).toBe('hit')

    // A generation that is no longer current lost a race with a write. It gets
    // the *current* bytes and the *current* number, uncacheable, so the reader
    // re-keys rather than being redirected or refused.
    const stale = await get2(`path=${encodeURIComponent(path2)}&mtime=111&gen=${cur - 1}`)
    expect(stale.headers.get('cache-control')).toBe('no-cache')
    const staleBody = (await stale.json()) as ThumbGetResponse
    expect(staleBody.status).toBe('hit')
    expect(staleBody.png).toBe(png2) // current content, not an empty re-key hint
    expect(staleBody.gen).toBe(cur)
  })

  it('gives a generation-less read a validator, and answers 304 to it', async () => {
    const first = await get2(`path=${encodeURIComponent(path2)}&mtime=111`)
    const cur = ((await first.json()) as ThumbGetResponse).gen!
    expect(first.headers.get('cache-control')).toBe('no-cache')
    expect(first.headers.get('etag')).toBe(`"${cur}"`)

    // The revalidation this tier exists for: same entry, unchanged, and the
    // answer carries no body at all rather than the base64 PNG.
    const revalidated = await get2(`path=${encodeURIComponent(path2)}&mtime=111`, {
      ...LOOPBACK,
      'if-none-match': `"${cur}"`,
    })
    expect(revalidated.status).toBe(304)
    expect(await revalidated.text()).toBe('')

    // A validator that does not match is not a revalidation — it is a first
    // read by a client holding something else, and it gets the whole body.
    const mismatched = await get2(`path=${encodeURIComponent(path2)}&mtime=111`, {
      ...LOOPBACK,
      'if-none-match': '"0"',
    })
    expect(mismatched.status).toBe(200)
    expect(((await mismatched.json()) as ThumbGetResponse).png).toBe(png2)
  })

  it('moves the generation on every write, whatever the write carried', async () => {
    const genOf = async (): Promise<number> =>
      ((await (await get2(`path=${encodeURIComponent(path2)}&mtime=111`)).json()) as ThumbGetResponse).gen!

    const before = await genOf()
    // Pixels.
    const a = (await (await put2({ path: path2, mtime: 111, png: png2 })).json()) as { gen: number }
    expect(a.gen).toBeGreaterThan(before)
    // A camera, no pixels — the authored write the whole design exists for.
    const b = (await (await put2({ path: path2, mtime: 111, camera: cam2 })).json()) as { gen: number }
    expect(b.gen).toBeGreaterThan(a.gen)
    // An axis.
    const c2 = (await (await put2({ path: path2, mtime: 111, axis: '-z' })).json()) as { gen: number }
    expect(c2.gen).toBeGreaterThan(b.gen)
    // And the discards, which are writes too: a tile framed and then un-framed
    // must not be served the framed pixels from a cache.
    const d = (await (await put2({ path: path2, mtime: 111, camera: null })).json()) as { gen: number }
    expect(d.gen).toBeGreaterThan(c2.gen)
    const e = (await (await put2({ path: path2, mtime: 111, axis: null })).json()) as { gen: number }
    expect(e.gen).toBeGreaterThan(d.gen)
    expect(await genOf()).toBe(e.gen)
  })

  it('refuses to cache anything that is not a hit, even for an entry that exists', async () => {
    // The entry is real and holds a camera; this mtime is not its render's.
    const res = await get2(`path=${encodeURIComponent(path2)}&mtime=999`)
    const body = (await res.json()) as ThumbGetResponse
    expect(body.status).not.toBe('hit')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // Not even when the reader names the current generation: the tier is
    // decided by the status first, and a non-hit never reaches the gen tiers.
    const named = await get2(`path=${encodeURIComponent(path2)}&mtime=999&gen=${body.gen}`)
    expect(named.headers.get('cache-control')).toBe('no-store')
  })
})
