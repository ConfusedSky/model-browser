// What a deployment declares off, its routes refuse — and what it declares none
// of the viewer's business, no route names (`public-deployment` D5/D9/D11).
//
// Every cell here builds ONE app from ONE `FeatureReport` and asserts the
// **pairing** from that single value: `/api/features` says the field is off and
// the route acts on it. Testing the report in one file and the refusals in
// another is exactly the drift D5 forbids — a declaration that nothing enforces
// is a promise, and a refusal nothing declares is a surprise.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * A library holding one archive the process cannot read: mode 000, so `stat`
 * still answers — reading a file's metadata needs no permission on the file —
 * and the failure lands on the `open` inside the zip reader. Its own library, so
 * that no other cell's walk meets it.
 *
 * Skipped as root, where mode 000 is not a wall.
 */
const lockedTop = realTempDir('mb-refuse-locked-')
writeFileSync(join(lockedTop, 'locked.zip'), zipSync({ 'box.stl': new Uint8Array(stlBytes(2)) }))
chmodSync(join(lockedTop, 'locked.zip'), 0o000)
const asRoot = process.getuid?.() === 0

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

/**
 * A directory on the host beside the library, holding nothing. It stands for
 * the scope an *unscoped* meaning query comes back reporting when the index's
 * collection root sits outside the library top — a place the viewer has no
 * library path for and no way to browse to.
 */
const besideLibrary = realTempDir('mb-refuse-beside-')

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
function appWith(
  over: Partial<FeatureReport>,
  library: Library = libraryFor(top),
  // Trailing and defaulted, like `createApp`'s own injections: only the cells
  // that need a launcher to *fail* pass one.
  launcher: Launcher = fakeLauncher(),
) {
  return createApp(new ThumbCache(cacheDir()), launcher, undefined, library, undefined, {
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
  for (const d of [top, enclosing, lockedTop, besideLibrary, ...caches, ...homes]) {
    rmSync(d, { recursive: true, force: true })
  }
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

  it('maintenance: the report says off, and a reload and an enumeration are refused', async () => {
    const app = appWith({ maintenance: false })
    expect((await reported(app)).maintenance).toBe(false)
    await refusal(await send(app, 'POST', '/api/reload', {}), 'maintenance')
    // `/api/models` beside it (9.10c): a whole-library enumeration whose only
    // consumer is the bulk jobs' scope read — the work list a job is built
    // from — so a deployment offering no bulk work does not answer the
    // question its launcher would ask first either.
    await refusal(await get(app, '/api/models?path=%2F'), 'maintenance')
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
    expect((await get(app, '/api/models?path=%2F')).status).toBe(200)
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

  /**
   * The cells above cover an index that is *unavailable*. These cover one that
   * is up and **refuses a request** — the other half of `askIndex`'s error
   * contract, and the half a visitor actually meets, because it is what
   * find-similar answers for a model that has no embedding. The sentence is the
   * index's own `detail`, built around the filesystem path it looked the model
   * up by, and it reached a live viewer verbatim as a 404 body.
   */
  const UNINDEXED = join(top, 'kit', 'part.stl')
  const READY = {
    ready: true,
    elapsed: 18.8,
    collection_root: top,
    covers: ['stl'],
    volume: { present: true, root: top, missing: null },
  }

  /** `/status` ready, every scoring route answering `status` with `detail`. */
  function stubRefusingIndex(detail: string, status = 404): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/status')) {
          return new Response(JSON.stringify(READY), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ detail }), { status })
      }),
    )
  }

  const NOT_IN_CACHE = `${UNINDEXED} is not in the cache`

  /** Both routes that score, with the smallest body each will accept. */
  const scoring: [string, unknown][] = [
    ['/api/semantic', { text: 'dragon' }],
    ['/api/semantic/similar', { path: '/kit/part.stl' }],
  ]

  it("an index refusal keeps its status and loses its sentence, on both scoring routes", async () => {
    const app = appWith(withheld)
    for (const [route, body] of scoring) {
      resetIndexStatus()
      stubRefusingIndex(NOT_IN_CACHE)
      const res = await send(app, 'POST', route, body)
      // The **status** is what the client reads "not indexed yet" off, never
      // the text, so the distinction the mapping draws survives untouched and
      // only the prose collapses.
      expect([route, res.status]).toEqual([route, 404])
      const b = (await res.json()) as { error: string }
      expect([route, b.error]).toEqual([route, 'the index refused the request'])
      expect([route, b.error.includes(UNINDEXED)]).toEqual([route, false])
    }
  })

  it("an index failing on its own side is a bad gateway and says no more", async () => {
    // The 5xx arm of the same mapping: a different sentence, because "it
    // refused" and "it broke" are different facts and the operator's log gets
    // both in full either way.
    const app = appWith(withheld)
    for (const [route, body] of scoring) {
      resetIndexStatus()
      stubRefusingIndex(`CUDA out of memory loading ${UNINDEXED}`, 500)
      const res = await send(app, 'POST', route, body)
      expect([route, res.status]).toEqual([route, 502])
      const b = (await res.json()) as { error: string }
      expect([route, b.error]).toEqual([route, 'the index failed'])
    }
  })

  it("keeps an index refusal verbatim where the host is the viewer's concern", async () => {
    // The control: byte-for-byte the answer these routes gave before the rule
    // existed, from the same stub.
    const app = appWith({})
    for (const [route, body] of scoring) {
      resetIndexStatus()
      stubRefusingIndex(NOT_IN_CACHE)
      const res = await send(app, 'POST', route, body)
      expect([route, res.status]).toEqual([route, 404])
      const b = (await res.json()) as { error: string }
      expect([route, b.error]).toEqual([route, NOT_IN_CACHE])
    }
  })

  /**
   * The cells above are about the bodies a meaning query *fails* with. This is
   * the body it **succeeds** with, which withheld nothing: `scopeWithin` hands
   * the index a real filesystem path and the index echoes that string back in
   * its scope, so `scope.path` forwarded verbatim named the host on every
   * search a visitor ran — `/run/media/…` on the machine this was found on.
   *
   * One rule rather than a fifth `hostDetails` branch, which is why both
   * declarations are asserted from the same stub: the scope on the wire is a
   * library path everywhere.
   */
  function stubScopedIndex(scopePath: string | null): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/status')) {
          return new Response(JSON.stringify(READY), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            scope: {
              path: scopePath,
              status: 'indexed',
              n_indexed: 1,
              n_scanned: 1,
              covers: ['stl'],
            },
            weak: false,
            results: [],
          }),
        )
      }),
    )
  }

  type ScopedBody = { scope: { path: string | null } }

  it('a query names the scope it was judged in by a library path, whatever is declared', async () => {
    for (const over of [withheld, {}]) {
      const app = appWith(over)
      resetIndexStatus()
      // The index's own spelling: the collection root's real path, joined.
      stubScopedIndex(join(top, 'kit'))
      const res = await send(app, 'POST', '/api/semantic', { text: 'dragon' })
      expect([over, res.status]).toEqual([over, 200])
      const raw = await res.text()
      expect([over, (JSON.parse(raw) as ScopedBody).scope.path]).toEqual([over, '/kit'])
      // And nowhere else in the body either — the field is where it was found,
      // not what the rule is about.
      expect([over, raw.includes(top)]).toEqual([over, false])
    }
  })

  it('a scope the library does not hold is absent, not a place the viewer cannot browse to', async () => {
    for (const over of [withheld, {}]) {
      const app = appWith(over)
      resetIndexStatus()
      stubScopedIndex(besideLibrary)
      const res = await send(app, 'POST', '/api/semantic', { text: 'dragon' })
      expect([over, res.status]).toEqual([over, 200])
      const raw = await res.text()
      expect([over, (JSON.parse(raw) as ScopedBody).scope.path]).toEqual([over, null])
      expect([over, raw.includes(besideLibrary)]).toEqual([over, false])
    }
  })

  /**
   * Whatever threw, in its own words — the branch no taxonomy covers, and the
   * one a future route lands in by default. `/api/apps` is the readiest place to
   * put one: it runs the launcher, which on a real machine execs `xdg-mime` and
   * reads the operator's application entries, so an untyped failure there is not
   * a contrivance.
   */
  it('an untyped failure gives the status and nothing else, and the log keeps the reason', async () => {
    const secret = join(top, 'secret')
    const thrower: Launcher = {
      ...fakeLauncher(),
      report: () => {
        throw new Error(`EACCES: permission denied, open '${secret}'`)
      },
    }
    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logged.push(a.join(' '))
    })
    try {
      const res = await get(appWith(withheld, libraryFor(top), thrower), '/api/apps')
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal error' })
      // Redirected, not lost: the operator is told which route and what.
      expect(logged.join('\n')).toContain('/api/apps')
      expect(logged.join('\n')).toContain(secret)
    } finally {
      spy.mockRestore()
    }

    const control = await get(appWith({}, libraryFor(top), thrower), '/api/apps')
    expect(control.status).toBe(500)
    expect(((await control.json()) as { error: string }).error).toContain(secret)
  })

  /**
   * An archive the library resolved and the process cannot open. The honest
   * answer is the same under both configurations, because it is not a host
   * detail at all: a **library entry** failed, and a library path names it —
   * which is exactly the distinction the `library paths are untouched` cell
   * above draws. Untyped, it was a 500 carrying `EACCES: permission denied,
   * open '<host path>'` on both of these routes.
   */
  it.skipIf(asRoot)('an unreadable archive is named by its library path, whatever is declared', async () => {
    for (const over of [withheld, {}]) {
      const app = appWith(over, libraryFor(lockedTop))
      const listed = await get(app, '/api/dir?path=%2Flocked.zip')
      expect(listed.status).toBe(404)
      expect(await listed.json()).toEqual({ error: 'cannot read zip: /locked.zip' })

      const fetched = await get(
        app,
        `/api/file?path=${encodeURIComponent('/locked.zip!/box.stl')}`,
      )
      expect(fetched.status).toBe(404)
      expect(await fetched.json()).toEqual({ error: 'cannot read zip: /locked.zip' })

      // Nothing named where the archive lives, on either route.
      for (const res of [
        await get(app, '/api/dir?path=%2Flocked.zip'),
        await get(app, `/api/file?path=${encodeURIComponent('/locked.zip!/box.stl')}`),
      ]) {
        expect(await text(res)).not.toContain(lockedTop)
      }
    }
  })
})
