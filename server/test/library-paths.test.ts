import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import type { DirListing, LibraryState } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { createLibrary } from '../src/library'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * The routes' end of library-root D3: a request path becomes a filesystem path
 * only through the library, so nothing outside it is nameable, listable or
 * walkable — and the states in which there is no library at all are answers the
 * UI renders rather than faults.
 *
 * outside/                      (a sibling of the library, never reachable)
 *   secret.stl  secret.zip { hidden.stl }  secretdir/deep.stl
 * lib/                          (the library's top)
 *   in/  real.stl
 *        escape.stl -> outside/secret.stl
 *        escape.zip -> outside/secret.zip
 *        escapedir  -> outside/secretdir
 *        alias      -> lib/kit          (an alias that stays inside)
 *   kit/ part.stl
 */
const base = realTempDir('mb-conf-')
const outside = join(base, 'outside')
const lib = join(base, 'lib')
mkdirSync(join(outside, 'secretdir'), { recursive: true })
writeFileSync(join(outside, 'secret.stl'), stlBytes(1))
writeFileSync(join(outside, 'secretdir', 'deep.stl'), stlBytes(2))
writeFileSync(
  join(outside, 'secret.zip'),
  zipSync({ 'hidden.stl': new Uint8Array(stlBytes(3)) }),
)
mkdirSync(join(lib, 'in'), { recursive: true })
mkdirSync(join(lib, 'kit'))
writeFileSync(join(lib, 'in', 'real.stl'), stlBytes(4))
writeFileSync(join(lib, 'kit', 'part.stl'), stlBytes(5))
symlinkSync(join(outside, 'secret.stl'), join(lib, 'in', 'escape.stl'))
symlinkSync(join(outside, 'secret.zip'), join(lib, 'in', 'escape.zip'))
symlinkSync(join(outside, 'secretdir'), join(lib, 'in', 'escapedir'))
symlinkSync(join(lib, 'kit'), join(lib, 'in', 'alias'))

// The index is off for this file: the only thing asked of `/api/semantic/status`
// here is that the gate lets it through, and asking it over the network would
// make that answer depend on whether a classifier happens to be running.
process.env.MODEL_BROWSER_INDEX = ''

const cacheDir = realTempDir('mb-conf-cache-')
const app = createApp(new ThumbCache(cacheDir), undefined, undefined, libraryFor(lib))

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

function get(path: string) {
  return app.request(path, { headers: LOOPBACK })
}

async function listing(path: string, extra = ''): Promise<DirListing> {
  const res = await get(`/api/dir?path=${encodeURIComponent(path)}${extra}`)
  expect(res.status).toBe(200)
  return (await res.json()) as DirListing
}

describe('nothing outside the library is listed', () => {
  it('omits an escaping file, archive and directory from a nested listing', async () => {
    const body = await listing('/in')
    expect(body.entries.map((e) => e.name)).toEqual(['alias', 'real.stl'])
  })

  it('omits them from a flat walk, and enumerates no name from the escaping archive', async () => {
    const body = await listing('/', '&flat=true')
    const names = body.entries.map((e) => e.name)
    expect(names.filter((n) => n.includes('escape'))).toEqual([])
    expect(names.filter((n) => n.includes('secret') || n.includes('hidden'))).toEqual([])
    // The walk still reaches what is inside.
    expect(names).toContain('in/real.stl')
  })

  it('still lists an alias that stays inside, under its own route', async () => {
    const inside = await listing('/in')
    expect(inside.entries.find((e) => e.name === 'alias')?.path).toBe('/in/alias')
    const aliased = await listing('/in/alias')
    expect(aliased.entries.map((e) => e.path)).toEqual(['/in/alias/part.stl'])
    // ...and a queried walk finds it by the name it was reached by.
    const found = await listing('/', '&flat=true&q=alias')
    expect(found.entries.map((e) => `${e.kind}:${e.name}`)).toContain('dir:in/alias')
  })

  it('refuses to name an escaping entry, without describing what it found', async () => {
    for (const path of ['/in/escape.stl', '/in/escapedir', '/in/escape.zip!/hidden.stl']) {
      const res = await get(`/api/file?path=${encodeURIComponent(path)}`)
      expect([path, res.status]).toEqual([path, 400])
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('path outside the library')
      expect(body.error).not.toContain(outside)
    }
  })

  it('refuses an escaping thumbnail read and write alike', async () => {
    const read = await get(`/api/thumb?path=${encodeURIComponent('/in/escape.stl')}&mtime=1`)
    expect(read.status).toBe(400)
    const write = await app.request('/api/thumb', {
      method: 'PUT',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/in/escape.stl', mtime: 1, png: 'AA==' }),
    })
    expect(write.status).toBe(400)
  })
})

describe('completion is a library path in and out', () => {
  async function complete(prefix: string): Promise<string[]> {
    const res = await get(`/api/complete?prefix=${encodeURIComponent(prefix)}`)
    expect(res.status).toBe(200)
    return (await res.json()) as string[]
  }

  it('completes within the library, in library paths', async () => {
    expect(await complete('/k')).toEqual(['/kit/'])
    expect(await complete('/')).toEqual(['/in/', '/kit/'])
  })

  it('never offers the marker directory, even to a dot prefix', async () => {
    expect(await complete('/.')).toEqual([])
  })

  it('offers nothing for a prefix that is not a library path', async () => {
    // Paired with the spelling that *does* complete: the same name, one
    // leading slash apart. Without the second line an implementation that
    // completed nothing at all would pass this test.
    expect(await complete('kit')).toEqual([])
    expect(await complete('kit/')).toEqual([])
    expect(await complete('/kit')).toEqual(['/kit/'])
  })

  it('offers nothing for a filesystem path, which is a library path that is not there', async () => {
    // It begins with `/`, so it reads as a library path like any other and
    // simply names nothing — the adjudicated behaviour, not a refusal.
    expect(await complete(join(lib, 'k'))).toEqual([])
  })

  it('offers nothing for a prefix that resolves outside the library', async () => {
    expect(await complete('/in/escapedir/')).toEqual([])
  })
})

describe('the marker directory is the app’s own, not a folder to browse', () => {
  it('refuses to list it or to read the marker, however the path is spelled', async () => {
    // The marker is written when the library is first evaluated, so ask for a
    // listing before looking for it — this test must not depend on which
    // others ran first.
    await listing('/')
    // The file is really there — what follows is a refusal, not a miss.
    expect(existsSync(join(lib, '.model-browser', 'library.json'))).toBe(true)
    const cases: [string, string][] = [
      ['/api/dir', '/.model-browser'],
      ['/api/dir', '/.model-browser/'],
      ['/api/dir', '/kit/../.model-browser'],
      ['/api/file', '/.model-browser/library.json'],
      ['/api/dir', '/.model-browser/library.json'],
    ]
    for (const [route, path] of cases) {
      const res = await get(`${route}?path=${encodeURIComponent(path)}`)
      expect([route, path, res.status]).toEqual([route, path, 400])
      expect(((await res.json()) as { error: string }).error).toBe('path outside the library')
    }
  })

  it('still lists the library root, where the marker was already hidden', async () => {
    const body = await listing('/')
    expect(body.entries.map((e) => e.name)).toEqual(['in', 'kit'])
  })
})

describe('a path built to cost rather than to name a file', () => {
  // `resolve` walks to the nearest ancestor that exists, one `realpath` per
  // component, so the depth of a path naming nothing is the requester's to
  // choose. Both bounds are checked before any filesystem call.
  async function status(path: string): Promise<[number, string]> {
    const res = await get(`/api/dir?path=${encodeURIComponent(path)}`)
    return [res.status, ((await res.json()) as { error?: string }).error ?? '']
  }

  it('walks a path at the component bound and refuses one past it', async () => {
    expect(await status('/a'.repeat(256))).toEqual([404, 'no such path: ' + '/a'.repeat(256)])
    expect(await status('/a'.repeat(257))).toEqual([400, 'path too long'])
  })

  it('walks a path at the byte bound and refuses one past it', async () => {
    const long = `/${'a'.repeat(4095)}` // 4096 bytes exactly
    expect((await status(long))[0]).toBe(404)
    expect(await status(`/${'a'.repeat(4096)}`)).toEqual([400, 'path too long'])
  })
})

describe('the states in which there is no library', () => {
  const home = realTempDir('mb-absent-')
  // Configured, but not there — the shape of an unmounted volume.
  const absent = join(home, 'volume')
  const absentCache = realTempDir('mb-absent-cache-')
  const absentApp = createApp(
    new ThumbCache(absentCache),
    undefined,
    undefined,
    libraryFor(absent),
  )

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(absentCache, { recursive: true, force: true })
  })

  function ask(path: string) {
    return absentApp.request(path, { headers: LOOPBACK })
  }

  it('answers every path route with the state and the configured root', async () => {
    const res = await ask('/api/dir?path=/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string; state: string; root: string }
    expect(body.state).toBe('missing')
    expect(body.root).toBe(absent)
    expect(body.error).toContain(absent)
  })

  it('reports the same state on /api/library, which is never gated', async () => {
    const res = await ask('/api/library')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'missing', root: absent })
  })

  it('does not gate the routes that are about the machine, not a path', async () => {
    expect((await ask('/api/apps')).status).toBe(200)
    expect((await ask('/api/semantic/status')).status).toBe(200)
  })

  it('gates the scoring routes too, which take a path like any other', async () => {
    // 4.0. Both were briefly exempt so B3's absolute-path tests stayed green;
    // they are path routes and answer the state envelope like the rest. The
    // index is off in this file, so an ungated route would answer 503
    // `absent` — a different state, which is what tells the two apart.
    for (const route of ['/api/semantic', '/api/semantic/similar']) {
      const res = await absentApp.request(route, {
        method: 'POST',
        headers: { ...LOOPBACK, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'dragon', path: '/' }),
      })
      const body = (await res.json()) as { state: string; root?: string }
      expect([route, res.status, body.state]).toEqual([route, 503, 'missing'])
      expect(body.root).toBe(absent)
    }
  })

  it('gates a root that encloses a library, naming both paths, and writes nothing', async () => {
    // The third not-ready state (R1): the root has no marker at or above it but
    // a bounded probe finds one below. Both paths are in the envelope because
    // the remedy is to point the root at the second.
    const enclosing = realTempDir('mb-nested-')
    const inner = join(enclosing, 'STL Library')
    mkdirSync(join(inner, '.model-browser'), { recursive: true })
    writeFileSync(
      join(inner, '.model-browser', 'library.json'),
      JSON.stringify({ id: 'the-enclosed-library', version: 1 }),
    )
    const cache = realTempDir('mb-nested-cache-')
    const app = createApp(new ThumbCache(cache), undefined, undefined, libraryFor(enclosing))

    const res = await app.request('/api/dir?path=/', { headers: LOOPBACK })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: `the root ${enclosing} contains a library at ${inner}`,
      state: 'nested',
      root: enclosing,
      library: inner,
    })

    // `/api/library` is never gated and reports the same state.
    const state = await app.request('/api/library', { headers: LOOPBACK })
    expect(state.status).toBe(200)
    expect(await state.json()).toEqual({ state: 'nested', root: enclosing, library: inner })

    // Nothing written over the library the root would have enclosed.
    expect(existsSync(join(enclosing, '.model-browser'))).toBe(false)
    rmSync(enclosing, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  })

  it('gates a server with no root at all, and says which thing is missing', async () => {
    // The fourth state, and the one the gate used to answer by falling through
    // rather than by naming: any state it did not recognise got this body. It
    // is now the `unconfigured` branch, with `unreachable` after it, so a state
    // added to `LibraryState` is a compile error instead of a user reading
    // "no library root is configured" about something else.
    const home = realTempDir('mb-unconfigured-home-')
    const cache = realTempDir('mb-unconfigured-cache-')
    const library = createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') })
    const app = createApp(new ThumbCache(cache), undefined, undefined, library)

    const res = await app.request('/api/dir?path=/', { headers: LOOPBACK })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no library root is configured', state: 'unconfigured' })

    const state = await app.request('/api/library', { headers: LOOPBACK })
    expect(state.status).toBe(200)
    expect(await state.json()).toEqual({ state: 'unconfigured' })
    rmSync(home, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  })

  it('serves the library as soon as the directory appears, without a restart', async () => {
    mkdirSync(absent, { recursive: true })
    writeFileSync(join(absent, 'arrived.stl'), stlBytes(6))
    const res = await ask('/api/dir?path=/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as DirListing
    expect(body.entries.map((e) => e.path)).toEqual(['/arrived.stl'])
    const state = (await (await ask('/api/library')).json()) as LibraryState
    expect(state.state).toBe('ready')
  })
})
