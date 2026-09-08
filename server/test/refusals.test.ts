// What a deployment declares off, its routes refuse — and what it declares none
// of the viewer's business, no route names (`public-deployment` D5/D9/D11).
//
// Every cell here builds ONE app from ONE `FeatureReport` and asserts the
// **pairing** from that single value: `/api/features` says the field is off and
// the route acts on it. Testing the report in one file and the refusals in
// another is exactly the drift D5 forbids — a declaration that nothing enforces
// is a promise, and a refusal nothing declares is a surprise.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppsReport, FeatureReport, LibraryState, Refused } from '../../shared/types'
import { DEFAULT_FEATURES, createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import type { Launcher } from '../src/launch'
import { type Library, createLibrary } from '../src/library'
import { resetIndexStatus } from '../src/semantic'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * The library every cell browses:
 *
 *   <top>/kit/part.stl
 *   <top>/models.zip!/box.stl   (an archive, so a virtual path is on the wire)
 *
 * `top` is a real temp path, and it is the string the withholding cells assert
 * the *absence* of — a location on the host, as opposed to `/kit/part.stl`,
 * which is a library path and unaffected.
 */
const top = realTempDir('mb-refuse-lib-')
mkdirSync(join(top, 'kit'), { recursive: true })
writeFileSync(join(top, 'kit', 'part.stl'), stlBytes(1))
writeFileSync(join(top, 'models.zip'), zipSync({ 'box.stl': new Uint8Array(stlBytes(2)) }))

/** A configured root that is not there: the `missing` state. */
const absentRoot = join(realTempDir('mb-refuse-absent-'), 'not-mounted')
/** A root enclosing a library: the `nested` state, with two locations to withhold. */
const enclosing = realTempDir('mb-refuse-nested-')
const enclosed = join(enclosing, 'STL Library')
mkdirSync(join(enclosed, '.model-browser'), { recursive: true })
writeFileSync(
  join(enclosed, '.model-browser', 'library.json'),
  JSON.stringify({ id: 'the-enclosed-library', version: 1 }),
)

const caches: string[] = []
function cacheDir(): string {
  const d = realTempDir('mb-refuse-cache-')
  caches.push(d)
  return d
}

const homes: string[] = []
/** A library with no root at all: the `unconfigured` state. */
function unconfiguredLibrary(): Library {
  const home = realTempDir('mb-refuse-home-')
  homes.push(home)
  return createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') })
}

/**
 * A launcher that answers rather than asks the machine. The real one execs
 * `xdg-mime` per handled type and reads the operator's application entries, so
 * a cell built on it would spawn processes and read whatever this machine has
 * installed. `report` is the one that matters here — that it is *reached* is
 * what the all-on control asserts, and that it is not is `open.test.ts`'s (7.4).
 */
function fakeLauncher(): Launcher {
  return {
    chooserConfigured: true,
    report: async () => ({
      chooser: true,
      types: {
        'model/stl': { default: null, associated: [] },
        'model/obj': { default: null, associated: [] },
        'model/3mf': { default: null, associated: [] },
      },
    }),
    launch: async () => {
      throw new Error('no cell here may launch anything')
    },
    chooser: async () => {
      throw new Error('no cell here may spawn a chooser')
    },
  }
}

/**
 * One app from one report — the value `/api/features` answers and the value the
 * routes read, which is the whole point of the pairing.
 */
function appWith(over: Partial<FeatureReport>, library: Library = libraryFor(top)) {
  return createApp(new ThumbCache(cacheDir()), fakeLauncher(), undefined, library, undefined, {
    ...DEFAULT_FEATURES,
    ...over,
  })
}

type App = ReturnType<typeof createApp>

const get = (app: App, path: string) => app.request(path, { headers: LOOPBACK })
const send = (app: App, method: string, path: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { ...LOOPBACK, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** The report as this app answers it — the same value its routes are reading. */
async function reported(app: App): Promise<FeatureReport> {
  const res = await get(app, '/api/features')
  expect(res.status).toBe(200)
  return (await res.json()) as FeatureReport
}

/** A refusal: 403, naming the field, and distinguishable from a fault (D5). */
async function refusal(res: Response, field: keyof FeatureReport): Promise<void> {
  expect(res.status).toBe(403)
  expect((await res.json()) as Refused).toEqual({
    error: 'not offered by this deployment',
    refused: field,
  })
}

/** `/status` refused, so nothing here reaches a classifier that may be running. */
function indexRefused(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed')
    }),
  )
}

beforeEach(() => {
  resetIndexStatus()
  indexRefused()
})
afterEach(() => vi.unstubAllGlobals())

afterAll(() => {
  for (const d of [top, enclosing, ...caches, ...homes]) rmSync(d, { recursive: true, force: true })
  rmSync(join(absentRoot, '..'), { recursive: true, force: true })
})

describe('a declared-off capability is refused at its route', () => {
  it('thumbWrites: the report says off and the write is refused, changing nothing', async () => {
    const app = appWith({ thumbWrites: false })
    expect((await reported(app)).thumbWrites).toBe(false)

    const res = await send(app, 'PUT', '/api/thumb', {
      path: '/kit/part.stl',
      mtime: 1,
      png: Buffer.from('not really a png').toString('base64'),
      camera: { theta: 1, phi: 1, radius: 2 },
    })
    await refusal(res, 'thumbWrites')
    // Nothing was written: the cached entry a later visitor reads is the one
    // that was there, which is the whole reason the refusal is at the route.
    expect((await get(app, '/api/thumb/image?path=%2Fkit%2Fpart.stl&mtime=1')).status).toBe(404)
  })

  it('appLaunch: the report says off, the report route is empty, and both launches refuse', async () => {
    const app = appWith({ appLaunch: false })
    expect((await reported(app)).appLaunch).toBe(false)

    const apps = await get(app, '/api/apps')
    expect(apps.status).toBe(200)
    const empty: AppsReport = { chooser: false, types: {} }
    expect(await apps.json()).toEqual(empty)

    await refusal(
      await send(app, 'POST', '/api/open', { path: '/kit/part.stl', appId: 'x.desktop' }),
      'appLaunch',
    )
    await refusal(await send(app, 'POST', '/api/open-with', { path: '/kit/part.stl' }), 'appLaunch')
  })

  it('maintenance: the report says off and a reload is refused', async () => {
    const app = appWith({ maintenance: false })
    expect((await reported(app)).maintenance).toBe(false)
    await refusal(await send(app, 'POST', '/api/reload', {}), 'maintenance')
  })

  it('hostDetails: the report says off and the library state carries no top', async () => {
    const app = appWith({ hostDetails: false })
    expect((await reported(app)).hostDetails).toBe(false)

    const state = (await (await get(app, '/api/library')).json()) as LibraryState
    expect(state.state).toBe('ready')
    expect('top' in state).toBe(false)
    // What stays: the identity, and `root` — a **library** path, `/` at the
    // top, which `bulk-thumbnail-jobs` scopes a whole-library job on.
    expect(state).toMatchObject({ state: 'ready', root: '/' })
    expect((state as { id?: string }).id).toBeTypeOf('string')
  })

  it('the same fixture with every field on answers exactly as it does today', async () => {
    // The control the four cells above are read against: nothing here is
    // withheld or refused, so a refusal that fired unconditionally would fail
    // here rather than passing everywhere.
    const app = appWith({})
    expect(await reported(app)).toEqual(DEFAULT_FEATURES)

    const state = (await (await get(app, '/api/library')).json()) as LibraryState
    expect(state).toMatchObject({ state: 'ready', top, root: '/' })

    const write = await send(app, 'PUT', '/api/thumb', {
      path: '/kit/part.stl',
      mtime: 1,
      camera: { theta: 1, phi: 1, radius: 2 },
    })
    expect(write.status).toBe(200)
    expect((await send(app, 'POST', '/api/reload', {})).status).toBe(200)
    // `/api/apps` really did reach the launcher: an empty-by-refusal answer and
    // a machine with nothing installed look alike, so what is asserted is that
    // the report was consulted at all.
    const apps = (await (await get(app, '/api/apps')).json()) as AppsReport
    expect(apps.chooser).toBe(true)
    expect(Object.keys(apps.types).sort()).toEqual(['model/3mf', 'model/obj', 'model/stl'])
  })
})

describe('no host location reaches a viewer where the host is not their concern', () => {
  const withheld = { hostDetails: false }

  /** Every string in a response body, host locations included — assert against. */
  const text = async (res: Response) => await res.text()

  it('a ready library reports its state and identity, and no location on the host', async () => {
    const app = appWith(withheld)
    for (const route of [
      '/api/library',
      '/api/dir?path=%2F',
      '/api/models?path=%2F',
      '/api/complete?prefix=%2Fki',
      '/api/overrides?path=%2Fkit%2Fpart.stl',
      '/api/thumb?path=%2Fkit%2Fpart.stl&mtime=1',
      '/api/apps',
      '/api/features',
      '/api/semantic/status',
    ]) {
      const body = await text(await get(app, route))
      expect([route, body.includes(top)]).toEqual([route, false])
    }
  })

  it('library paths and archive virtual paths are untouched, since neither is a place on the host', async () => {
    const app = appWith(withheld)
    const listing = await text(await get(app, '/api/dir?path=%2F'))
    expect(listing).toContain('/kit')
    expect(listing).toContain('/models.zip')
    // One level of virtual path, on the wire, spelled in full.
    const zip = await text(await get(app, '/api/dir?path=%2Fmodels.zip'))
    expect(zip).toContain('/models.zip!/box.stl')
    // And an error that names a library path still names it: the rule is about
    // the host's locations, not about anything path-shaped.
    const missing = await get(app, '/api/file?path=%2Fkit%2Fnope.stl')
    expect(missing.status).toBe(404)
    expect(await text(missing)).toContain('/kit/nope.stl')
  })

  it('a missing library names the state and not the root, on /api/library and on a path route', async () => {
    const app = appWith(withheld, libraryFor(absentRoot))

    const state = await get(app, '/api/library')
    expect(state.status).toBe(200)
    expect(await state.json()).toEqual({ state: 'missing' })

    const gated = await get(app, '/api/dir?path=%2F')
    expect(gated.status).toBe(503)
    expect(await gated.json()).toEqual({ error: 'the library is not present', state: 'missing' })
    // The configured root is nowhere in either answer, sentence included.
    for (const res of [
      await get(app, '/api/library'),
      await get(app, '/api/dir?path=%2F'),
      await get(app, '/api/peek?path=%2F'),
    ]) {
      expect(await text(res)).not.toContain(absentRoot)
    }
  })

  it('a nested root names the state and neither location', async () => {
    const app = appWith(withheld, libraryFor(enclosing))

    const state = await get(app, '/api/library')
    expect(await state.json()).toEqual({ state: 'nested' })

    const gated = await get(app, '/api/dir?path=%2F')
    expect(gated.status).toBe(503)
    expect(await gated.json()).toEqual({ error: 'the root contains a library', state: 'nested' })

    for (const res of [await get(app, '/api/library'), await get(app, '/api/dir?path=%2F')]) {
      const body = await text(res)
      expect(body).not.toContain(enclosing)
      expect(body).not.toContain(enclosed)
    }
  })

  it('an unconfigured server answers as it does anywhere, since it names no location to begin with', async () => {
    const app = appWith(withheld, unconfiguredLibrary())
    expect(await (await get(app, '/api/library')).json()).toEqual({ state: 'unconfigured' })
    const gated = await get(app, '/api/dir?path=%2F')
    expect(gated.status).toBe(503)
    expect(await gated.json()).toEqual({
      error: 'no library root is configured',
      state: 'unconfigured',
    })
  })

  /**
   * The index's own words for a failure — free text from another process,
   * naming its cache directory. This is the shape `serve_api.py` answers with
   * when it is started against a cache holding no embeddings.
   */
  const CACHE_DIR = '/home/operator/.cache/mini-classify/embed-cache512'
  const FAILED = {
    ready: false,
    elapsed: 4,
    volume: { present: true, root: top, missing: null },
    failure: {
      reason: `no embeddings in ${CACHE_DIR}`,
      hint: `rerun classify_stls.py --cache-dir ${CACHE_DIR}`,
      kind: 'CacheUnusable',
    },
  }

  function stubFailedIndex(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/status')) {
          return new Response(JSON.stringify(FAILED), {
            headers: { 'content-type': 'application/json' },
          })
        }
        throw new Error(`unexpected fetch: ${String(url)}`)
      }),
    )
  }

  it("the index's own explanation is withheld by the status route and by both 503s", async () => {
    const app = appWith(withheld)
    stubFailedIndex()

    const status = await get(app, '/api/semantic/status')
    const body = (await status.json()) as { state: string; detail?: string }
    // The condition is still reported — only the free text goes.
    expect(body.state).toBe('wedged')
    expect('detail' in body).toBe(false)

    for (const route of ['/api/semantic', '/api/semantic/similar']) {
      const res = await send(app, 'POST', route, { text: 'dragon', path: '/kit/part.stl' })
      expect([route, res.status]).toEqual([route, 503])
      const b = (await res.json()) as { error: string; state: string; detail?: string }
      expect([route, b.error, b.state]).toEqual([route, 'index unavailable', 'wedged'])
      expect([route, 'detail' in b]).toEqual([route, false])
    }

    // Nothing anywhere named the directory the index was started against.
    resetIndexStatus()
    stubFailedIndex()
    for (const res of [
      await get(app, '/api/semantic/status'),
      await send(app, 'POST', '/api/semantic', { text: 'dragon' }),
      await send(app, 'POST', '/api/semantic/similar', { path: '/kit/part.stl' }),
    ]) {
      expect(await text(res)).not.toContain(CACHE_DIR)
    }
  })

  it("keeps the index's own words where the host is the viewer's concern", async () => {
    // The control for the cell above, from the same stub: withholding is what
    // the field does, not what the route does.
    const app = appWith({})
    stubFailedIndex()
    const body = (await (await get(app, '/api/semantic/status')).json()) as { detail?: string }
    expect(body.detail).toContain(CACHE_DIR)
  })
})
