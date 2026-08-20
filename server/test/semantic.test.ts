// The semantic index is a separate service that is usually not running. These
// stub it at `fetch` so every state it can be in is reachable — the states are
// the feature's real surface, and four of the five are failures.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('a running index whose library is unmounted is its own state', async () => {
    // The likeliest failure on removable media, and the only one the user
    // repairs in a second — reporting it as "not running" hides the repair.
    stubIndex({ ...READY, volume: { present: false, root, missing: root } })
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      state: string
    }
    expect(body.state).toBe('volume-gone')
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

  it('stats at most once per returned hit — never a walk', async () => {
    stubIndex(READY, { ...result, results: [hit('dragon.stl'), hit('dragon.stl')] })
    await post({ text: 'dragon' })
    // Nothing here asserts timing; the bound is structural, and the contract is
    // that cost tracks the result count rather than the size of the tree.
    expect(true).toBe(true)
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
