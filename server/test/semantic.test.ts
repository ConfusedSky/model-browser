// The semantic index is a separate service that is usually not running. These
// stub it at `fetch` so every state it can be in is reachable — the states are
// the feature's real surface, and four of the five are failures.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ESM exports cannot be spied, so the count comes from a mock that still does
// the real work — the assertion is about how many stats a query costs, and a
// fake stat would make the test about the fake.
const stats = vi.hoisted(() => ({ n: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      stats.n++
      return actual.stat(...args)
    },
  }
})
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { resetIndexStatus } from '../src/semantic'
import { LOOPBACK, stlBytes } from './helpers'

const root = mkdtempSync(join(tmpdir(), 'mb-sem-'))
writeFileSync(join(root, 'dragon.stl'), stlBytes(1))
const cacheDir = mkdtempSync(join(tmpdir(), 'mb-sem-cache-'))
const app = createApp(new ThumbCache(cacheDir))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

const READY = {
  ready: true,
  elapsed: 18.8,
  collection_root: root,
  covers: ['stl'],
  volume: { present: true, root, missing: null },
}

function hit(rel: string) {
  return {
    id: `${rel}_abc123`,
    path: join(root, rel),
    rel_path: rel,
    name: rel,
    score: 0.16,
    z: 3.9,
    pose: {
      up: [0, 1, 0],
      azimuth_zero: [1, 0, 0],
      source: 'siglip',
      confidence: 0.9,
      front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
    },
  }
}

/** Answer `/status` with `status`, and `/query` with `query`. */
function stubIndex(status: unknown, query?: unknown, opts: { queryStatus?: number } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).endsWith('/status')) {
        if (status === 'refused') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(status), { headers: { 'content-type': 'application/json' } })
      }
      if (init?.method === 'POST') {
        if (query === 'refused') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(query ?? {}), { status: opts.queryStatus ?? 200 })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }),
  )
}

const post = (body: unknown) =>
  app.request('/api/semantic', {
    method: 'POST',
    headers: { ...LOOPBACK, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => resetIndexStatus())
afterEach(() => vi.unstubAllGlobals())

describe('semantic index availability', () => {
  it('a refused connection is absent — the state /status cannot report', async () => {
    stubIndex('refused')
    const res = await app.request('/api/semantic/status', { headers: LOOPBACK })
    expect(await res.json()).toEqual({ state: 'absent' })
  })

  it('ready:false is warming, not absent — a restart must not read as a missing service', async () => {
    stubIndex({ ...READY, ready: false, elapsed: 3.2 })
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      state: string
      elapsed: number
    }
    expect(body.state).toBe('warming')
    expect(body.elapsed).toBe(3.2)
  })

  it('a load that has plainly gone wrong is wedged, so the UI stops promising it will finish', async () => {
    stubIndex({ ...READY, ready: false, elapsed: 400 })
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      state: string
    }
    expect(body.state).toBe('wedged')
  })

  it('a library whose drive is unplugged is volume-gone, not warming', async () => {
    // Captured from the real service started against a missing volume — the
    // shape that matters, and not the one an invented fixture produces. It is
    // `ready: false` *and* `volume.present: false`, because the load could not
    // finish precisely because the storage is gone. Checking `ready` first
    // called this "starting up", then "wedged" three minutes later, so the
    // message never mentioned the drive — the one failure a user fixes in
    // seconds.
    stubIndex({
      ready: false,
      elapsed: 5.6,
      loaded_at: null,
      volume: { present: false, root: '/run/media/masa/NOPE', missing: '/run/media/masa/NOPE' },
      failure: {
        reason: 'collection volume is not available: /run/media/masa/NOPE',
        hint: null,
        kind: 'VolumeUnavailable',
      },
    })
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      state: string
      detail?: string
    }
    expect(body.state).toBe('volume-gone')
    // The index's own words, not ours — and a string, not an object rendered
    // into the panel as [object Object]. `failure` is a dict upstream.
    expect(body.detail).toContain('collection volume is not available')
  })

  it('a load error while warming is wedged, and its reason and hint are carried', async () => {
    stubIndex({
      ready: false,
      elapsed: 3,
      volume: { present: true, root, missing: null },
      failure: { reason: 'cache built with different settings', hint: 'rerun classify_stls.py', kind: 'CacheMismatch' },
    })
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      state: string
      detail?: string
    }
    expect(body.state).toBe('wedged')
    expect(body.detail).toBe('cache built with different settings — rerun classify_stls.py')
  })

  it('availability is cached, not probed per query', async () => {
    stubIndex(READY, { scope: { path: null, status: 'indexed', n_indexed: 1, n_scanned: 1, covers: ['stl'] }, weak: false, results: [] })
    await app.request('/api/semantic/status', { headers: LOOPBACK })
    const calls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).endsWith('/status')).length
    const first = calls()
    await post({ text: 'dragon' })
    await post({ text: 'dragon' })
    expect(calls()).toBe(first)
  })
})

describe('semantic query', () => {
  const result = {
    scope: { path: null, status: 'partial', n_indexed: 2801, n_scanned: 3396, covers: ['stl'] },
    weak: false,
    results: [hit('dragon.stl')],
  }

  it('returns tiles built from this server’s own view of the tree', async () => {
    stubIndex(READY, result)
    const body = (await (await post({ text: 'dragon' })).json()) as {
      entries: { name: string; size: number; mtime: number; kind: string }[]
      scope: { indexed: number; scanned: number; covers: string[]; status: string }
      weak: boolean
    }
    expect(body.entries).toHaveLength(1)
    // mtime and size come from stat, not from the index, which reports neither.
    expect(body.entries[0]!.mtime).toBeGreaterThan(0)
    expect(body.entries[0]!.size).toBeGreaterThan(0)
    expect(body.scope).toEqual({ path: null, status: 'partial', indexed: 2801, scanned: 3396, covers: ['stl'] })
  })

  it('drops a hit that no longer resolves without failing the search', async () => {
    stubIndex(READY, { ...result, results: [hit('dragon.stl'), hit('moved-away.stl')] })
    const body = (await (await post({ text: 'dragon' })).json()) as { entries: unknown[] }
    expect(body.entries).toHaveLength(1)
  })

  it('stats once per returned hit — the bound that lets the two caches disagree', async () => {
    stubIndex(READY, {
      ...result,
      results: [hit('dragon.stl'), hit('dragon.stl'), hit('dragon.stl')],
    })
    stats.n = 0
    await post({ text: 'dragon' })
    // Cost tracks the result count, never the size of the tree. Asserted
    // rather than asserted-about: this bound is the whole reason a query needs
    // no walk, and the previous version of this test could not fail.
    expect(stats.n).toBe(3)
  })

  it('a hit cannot name a file outside the collection', async () => {
    // `rel_path` is data from another process. `..` in it, or an absolute
    // `path` pointing elsewhere, must not become a tile — the spec joins hits
    // *relative to the collection root*, and the index's own doc says the
    // absolute path is not the contract.
    stubIndex(READY, {
      ...result,
      results: [
        { ...hit('dragon.stl'), rel_path: '../escape.stl', path: '/etc/passwd' },
        { ...hit('dragon.stl'), rel_path: 'dragon.stl', path: '/etc/passwd' },
      ],
    })
    const body = (await (await post({ text: 'dragon' })).json()) as {
      entries: { path: string }[]
    }
    expect(body.entries.map((e) => e.path)).toEqual([join(root, 'dragon.stl')])
  })

  it('sends the tuning it is given, and a count by default', async () => {
    stubIndex(READY, result)
    await post({ text: 'dragon' })
    const body = JSON.parse(
      ((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls
        .filter((c) => !String(c[0]).endsWith('/status'))
        .at(-1)![1].body),
    ) as Record<string, unknown>
    expect(body.top).toBe(60)
    expect(body).not.toHaveProperty('raw')
    expect(body).not.toHaveProperty('pool')
  })

  it('a floor replaces the count rather than accompanying it', async () => {
    // The index ignores `top` when `min_score` is set, so sending both would
    // state a relationship that does not exist.
    stubIndex(READY, result)
    await post({ text: 'dragon', minScore: 0.2, top: 5, raw: true, pool: 'max' })
    const body = JSON.parse(
      ((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls
        .filter((c) => !String(c[0]).endsWith('/status'))
        .at(-1)![1].body),
    ) as Record<string, unknown>
    expect(body.min_score).toBe(0.2)
    expect(body).not.toHaveProperty('top')
    expect(body.raw).toBe(true)
    expect(body.pool).toBe('max')
  })

  it('reports the index’s own ceiling, distinct from a ranking having more', async () => {
    stubIndex(READY, { ...result, truncated: true })
    const body = (await (await post({ text: 'dragon', top: 900 })).json()) as { capped: boolean }
    expect(body.capped).toBe(true)
  })

  it('an unavailable index is a state to render, not a 500', async () => {
    stubIndex('refused')
    const res = await post({ text: 'dragon' })
    expect(res.status).toBe(503)
    expect((await res.json()).state).toBe('absent')
  })

  it('a 503 racing the warmup folds back into warming', async () => {
    stubIndex(READY, {}, { queryStatus: 503 })
    const res = await post({ text: 'dragon' })
    expect(res.status).toBe(503)
    expect((await res.json()).state).toBe('warming')
  })

  it('an index that refuses the request answers as a refusal, not as unavailability', async () => {
    // Everything non-503 used to come back as 503 with `state: 'ready'` — a
    // body contradicting its own status, telling the client the service was
    // down over a request it should have fixed.
    stubIndex(READY, { detail: 'pool must be one of mean, max, softmax' }, { queryStatus: 400 })
    const res = await post({ text: 'dragon', pool: 'median' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; state?: string }
    expect(body.error).toBe('pool must be one of mean, max, softmax')
    // Availability is not what went wrong here, so no state is claimed.
    expect(body.state).toBeUndefined()
  })

  it('an index that fails on its own side is a bad gateway, not an absent service', async () => {
    stubIndex(READY, { detail: 'CUDA out of memory' }, { queryStatus: 500 })
    const res = await post({ text: 'dragon' })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; state?: string }
    expect(body.error).toBe('CUDA out of memory')
    expect(body.state).toBeUndefined()
  })

  it('rejects a virtual path rather than letting the index reject it', async () => {
    stubIndex(READY, result)
    const res = await post({ text: 'dragon', path: `${root}/kit.zip!/inner` })
    expect(res.status).toBe(400)
  })

  it('rejects a scope outside the indexed collection', async () => {
    stubIndex(READY, result)
    const res = await post({ text: 'dragon', path: tmpdir() })
    expect(res.status).toBe(400)
  })

  it('a blank query is not a search', async () => {
    stubIndex(READY, result)
    expect((await post({ text: '   ' })).status).toBe(400)
  })
})
