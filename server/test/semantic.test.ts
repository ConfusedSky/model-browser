// The semantic index is a separate service that is usually not running. These
// stub it at `fetch` so every state it can be in is reachable — the states are
// the feature's real surface, and four of the five are failures.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

// The library's top *is* the collection root here, so a hit's library path is
// its `rel_path` with a leading slash. The collections that sit elsewhere —
// beneath the top, and outside it altogether — get their own describes below.
const root = realTempDir('mb-sem-')
writeFileSync(join(root, 'dragon.stl'), stlBytes(1))
mkdirSync(join(root, 'kits'), { recursive: true })
writeFileSync(join(root, 'kits', 'a.stl'), stlBytes(2))
// A collection the library does not hold — a sibling of the top, not under it.
const outside = realTempDir('mb-sem-out-')
writeFileSync(join(outside, 'dragon.stl'), stlBytes(3))
// Two links inside the collection: one leaving the library, one staying. The
// index follows both when it embeds, so both can come back as hits.
symlinkSync(join(outside, 'dragon.stl'), join(root, 'escape.stl'))
symlinkSync(join(root, 'kits', 'a.stl'), join(root, 'alias.stl'))
const cacheDir = mkdtempSync(join(tmpdir(), 'mb-sem-cache-'))
const library = libraryFor(root)
const app = createApp(new ThumbCache(cacheDir), undefined, undefined, library)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
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

beforeEach(async () => {
  resetIndexStatus()
  // The library's first `state()` stats the configured root, and the stat count
  // below is asserted exactly. Warmed here so the number is the query's cost
  // whether the whole file runs or one test does.
  await library.state()
})
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

  it('a /status body that is an array is absent, not warming', async () => {
    // Valid JSON, and an object by `typeof` — but its every field reads as
    // absent, so `ready !== true` classified it as warming: a state that says
    // waiting will help, for an index answering garbage.
    stubIndex([])
    const res = await app.request('/api/semantic/status', { headers: LOOPBACK })
    expect(((await res.json()) as { state: string }).state).toBe('absent')
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
      entries: { name: string; path: string; size: number; mtime: number; kind: string }[]
      scope: { indexed: number; scanned: number; covers: string[]; status: string }
      scores: Record<string, unknown>
      weak: boolean
    }
    expect(body.entries).toHaveLength(1)
    // mtime and size come from stat, not from the index, which reports neither.
    expect(body.entries[0]!.mtime).toBeGreaterThan(0)
    expect(body.entries[0]!.size).toBeGreaterThan(0)
    // The index's two numbers ride along, keyed by the same resolved path the
    // entry carries, and verbatim — a text-query cosine really does run this
    // low, and rescaling it here would break the one thing it can be checked
    // against (the index's own `WEAK_Z`).
    expect(body.scores['/dragon.stl']).toEqual({ score: 0.16, z: 3.9 })
    expect(body.scope).toEqual({ path: null, status: 'partial', indexed: 2801, scanned: 3396, covers: ['stl'] })
  })

  it('a hit whose pose is not a pose still becomes a tile, with no pose', async () => {
    // A hit's pose rides straight to the client, which reads `up` positionally
    // (`client/src/three/pose.ts`) — so it is checked here rather than trusted
    // because the wire type says so. A malformed one costs the hit its
    // orientation and nothing else: the tile is still a tile, still scored,
    // still addressed, and renders at its default framing.
    for (const pose of ['face-up', { ...hit('x.stl').pose, up: [0, 1] }, 0, []]) {
      stubIndex(READY, { ...result, results: [{ ...hit('dragon.stl'), pose }] })
      const body = (await (await post({ text: 'dragon' })).json()) as {
        entries: { path: string }[]
        poses: Record<string, unknown>
        scores: Record<string, unknown>
      }
      expect(body.entries.map((e) => e.path)).toEqual(['/dragon.stl'])
      expect(body.poses).toEqual({})
      expect(body.scores['/dragon.stl']).toEqual({ score: 0.16, z: 3.9 })
    }
    // The control: the same hit with the pose it was built with. Without it a
    // route that never forwarded a pose at all would pass the loop above.
    stubIndex(READY, result)
    const good = (await (await post({ text: 'dragon' })).json()) as {
      poses: Record<string, unknown>
    }
    expect(good.poses['/dragon.stl']).toEqual(hit('dragon.stl').pose)
  })

  it('drops a hit that no longer resolves without failing the search', async () => {
    stubIndex(READY, { ...result, results: [hit('dragon.stl'), hit('moved-away.stl')] })
    const body = (await (await post({ text: 'dragon' })).json()) as {
      entries: unknown[]
      scores: Record<string, unknown>
    }
    expect(body.entries).toHaveLength(1)
    // The dropped hit leaves no score behind: one key, one fact.
    expect(Object.keys(body.scores)).toEqual(['/dragon.stl'])
  })

  it('stats once per returned hit — the bound that lets the two caches disagree', async () => {
    const cost = async (hits: number): Promise<number> => {
      stubIndex(READY, { ...result, results: Array.from({ length: hits }, () => hit('dragon.stl')) })
      stats.n = 0
      await post({ text: 'dragon' })
      return stats.n
    }

    // Cost tracks the result count, never the size of the tree. Asserted
    // rather than asserted-about: this bound is the whole reason a query needs
    // no walk, and the previous version of this test could not fail.
    //
    // Measured as a slope *and* an intercept because a request now pays a
    // couple of stats that are not the query's: since library-root 1.7
    // `library.state()` stats the library's top, and this route asks for the
    // state twice — the gate, then `probeStatus`. Two constants, whatever the
    // result count; three hits still cost exactly three stats more than none.
    expect(await cost(0)).toBe(2)
    expect(await cost(3)).toBe(5)
    expect((await cost(3)) - (await cost(1))).toBe(2)
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
    expect(body.entries.map((e) => e.path)).toEqual(['/dragon.stl'])
  })

  it('drops a hit that escapes the library, and keeps one that only aliases inside it', async () => {
    // Inside the collection is not yet inside the library: the collection root
    // sits in the library, but a symlink in it resolves wherever it points and
    // the index embedded what it found. An escaping hit was named and scored
    // on a surface where `/api/file` refuses the very same path.
    stubIndex(READY, {
      ...result,
      results: [hit('escape.stl'), hit('alias.stl'), hit('dragon.stl')],
    })
    const body = (await (await post({ text: 'dragon' })).json()) as {
      entries: { path: string }[]
      poses: Record<string, unknown>
      scores: Record<string, unknown>
    }
    expect(body.entries.map((e) => e.path)).toEqual(['/alias.stl', '/dragon.stl'])
    // All three maps or none: a tile that is not there must carry no pose and
    // no number anywhere.
    expect(Object.keys(body.poses).sort()).toEqual(['/alias.stl', '/dragon.stl'])
    expect(Object.keys(body.scores).sort()).toEqual(['/alias.stl', '/dragon.stl'])
    // The path the search would have offered is the one the file route refuses.
    const file = await app.request(`/api/file?path=${encodeURIComponent('/escape.stl')}`, {
      headers: LOOPBACK,
    })
    expect(file.status).toBe(400)
  })

  /** What this server last asked the index for, tuning included. */
  function lastIndexRequest(): Record<string, unknown> {
    return JSON.parse(
      ((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls
        .filter((c) => !String(c[0]).endsWith('/status'))
        .at(-1)![1].body),
    ) as Record<string, unknown>
  }

  it('sends the tuning it is given, and a count when the tuning names no bound', async () => {
    stubIndex(READY, result)
    await post({ text: 'dragon' })
    const body = lastIndexRequest()
    expect(body.top).toBe(60)
    expect(body).not.toHaveProperty('min_score')
    expect(body).not.toHaveProperty('raw')
    expect(body).not.toHaveProperty('pool')
  })

  it('sends both bounds when both are in force, since the index composes them', async () => {
    stubIndex(READY, result)
    await post({ text: 'dragon', minScore: 0.2, top: 5, raw: true, pool: 'max' })
    const body = lastIndexRequest()
    expect(body.min_score).toBe(0.2)
    expect(body.top).toBe(5)
    expect(body.raw).toBe(true)
    expect(body.pool).toBe('max')
  })

  it('sends a floor alone as a floor alone — no count the user did not set', async () => {
    // The count's absence is the assertion: the index reads a missing `top` as
    // "no cap", so adding one here would silently bound an unbounded search.
    stubIndex(READY, result)
    await post({ text: 'dragon', minScore: 0.2 })
    const body = lastIndexRequest()
    expect(body.min_score).toBe(0.2)
    expect(body).not.toHaveProperty('top')
  })

  it('sends a count alone as a count alone', async () => {
    stubIndex(READY, result)
    await post({ text: 'dragon', top: 5 })
    const body = lastIndexRequest()
    expect(body.top).toBe(5)
    expect(body).not.toHaveProperty('min_score')
  })

  it('reports the index’s own ceiling, distinct from a ranking having more', async () => {
    stubIndex(READY, { ...result, truncated: true })
    const body = (await (await post({ text: 'dragon', top: 900 })).json()) as { capped: boolean }
    expect(body.capped).toBe(true)
  })

  it('forwards what the count cut from, so a capped view can say what it sampled', async () => {
    stubIndex(READY, { ...result, matched: 875 })
    const body = (await (await post({ text: 'dragon', minScore: 0.1, top: 60 })).json()) as {
      matched?: number
    }
    expect(body.matched).toBe(875)
  })

  it('omits what the count cut from when the index does not report it', async () => {
    // Additive both ways: an older index sends no `matched`, and the client
    // renders nothing rather than a zero it would read as "none matched".
    stubIndex(READY, result)
    const body = (await (await post({ text: 'dragon', minScore: 0.1, top: 60 })).json()) as Record<
      string,
      unknown
    >
    expect(body).not.toHaveProperty('matched')
  })

  it('an unavailable index is a state to render, not a 500', async () => {
    stubIndex('refused')
    const res = await post({ text: 'dragon' })
    expect(res.status).toBe(503)
    expect((await res.json()).state).toBe('absent')
  })

  it('a 200 missing the answer’s own fields is an index that is not answering', async () => {
    // An object body that carries no `results` array and no `scope` dict:
    // trusted, it threw in the route handler (`hitsToEntries`' map, then
    // `result.scope.path`) — a 500 for what is really the index talking
    // nonsense. Gated where the cast happens, it classifies like any other
    // non-answer.
    for (const body of [{}, { scope: result.scope, weak: false, results: 5 }, { results: [] }]) {
      resetIndexStatus()
      stubIndex(READY, body)
      const res = await post({ text: 'dragon' })
      expect(res.status).toBe(503)
      expect(((await res.json()) as { state: string }).state).toBe('absent')
    }
  })

  it('a garbage element inside a real results array is dropped, not a 500', async () => {
    // The array gate cannot vouch for the elements — still another process's
    // JSON. A hit with no string `rel_path` has no join key (`resolve` throws
    // on a non-string), so it is dropped the way a moved-away hit is, and the
    // real hit beside it still becomes a tile.
    stubIndex(READY, {
      ...result,
      results: [null, 5, { ...hit('x.stl'), rel_path: 7 }, hit('dragon.stl')],
    })
    const res = await post({ text: 'dragon' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: { path: string }[] }
    expect(body.entries.map((e) => e.path)).toEqual(['/dragon.stl'])
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
    const res = await post({ text: 'dragon', path: '/kit.zip!/inner' })
    expect(res.status).toBe(400)
  })

  it('rejects a scope the library does not hold', async () => {
    // A library path that is not there. The collection root *is* the library
    // top in this file, so this is as far outside the collection as a library
    // path can be — a scope inside the library and outside the *collection*
    // needs a collection below the top, which the describe further down builds.
    stubIndex(READY, result)
    const res = await post({ text: 'dragon', path: '/nowhere' })
    expect(res.status).toBe(400)
  })

  it('a blank query is not a search', async () => {
    stubIndex(READY, result)
    expect((await post({ text: '   ' })).status).toBe(400)
  })
})

describe('a collection beneath the library top', () => {
  // The index keeps its own absolute root; what reaches the client is that root
  // as a library path, and every hit named under it (D6).
  const KITS = { ...READY, collection_root: join(root, 'kits') }
  const result = {
    scope: { path: null, status: 'indexed', n_indexed: 1, n_scanned: 1, covers: ['stl'] },
    weak: false,
    results: [hit('a.stl')],
  }

  it('names the covered subtree by its library path, not by the index’s own', async () => {
    stubIndex(KITS, result)
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      collectionRoot?: string
    }
    expect(body.collectionRoot).toBe('/kits')
  })

  it('names hits by library path, so they address the same tile a listing does', async () => {
    stubIndex(KITS, result)
    const body = (await (await post({ text: 'dragon' })).json()) as {
      entries: { name: string; path: string; mtime: number }[]
      poses: Record<string, unknown>
      scores: Record<string, unknown>
    }
    expect(body.entries.map((e) => e.path)).toEqual(['/kits/a.stl'])
    // Named as a hit is — relative to the collection — which the addresses
    // changing does not touch.
    expect(body.entries[0]!.name).toBe('a.stl')
    expect(body.entries[0]!.mtime).toBeGreaterThan(0)
    // Both maps keyed by the path the entry carries, which is what
    // `useThumbnails` looks a pose up by (`poses[entry.path]`). Keyed by the
    // absolute path instead, every index pose is silently never found.
    expect(body.poses['/kits/a.stl']).toBeDefined()
    expect(body.scores['/kits/a.stl']).toEqual({ score: 0.16, z: 3.9 })
  })

  it('scopes to a library path inside the collection, and refuses one above it', async () => {
    stubIndex(KITS, result)
    const inside = await post({ text: 'dragon', path: '/kits' })
    expect(inside.status).toBe(200)
    // The library top is inside the library and outside the collection — the
    // case the index is not the one to answer.
    stubIndex(KITS, result)
    expect((await post({ text: 'dragon', path: '/' })).status).toBe(400)
  })
})

describe('the collection root as the index spelled it, not as this server would', () => {
  /**
   * A root with a trailing slash. `serve_api.py --collection-root <dir>/` is an
   * ordinary way to start it and `/status` reports back whatever it was given,
   * so this is a spelling the wire really produces — not a hostile one.
   *
   * It used to empty every search. Containment was `full.startsWith(root + sep)`
   * against the raw string: `resolve` puts the hit at `<root>/a.stl` while the
   * prefix reads `<root>//`, which nothing can match, so every hit was dropped
   * as "outside the collection" and a search the index had answered came back
   * with no tiles and no error anywhere to say why.
   */
  const SLASHED = { ...READY, collection_root: `${join(root, 'kits')}/` }
  const result = {
    scope: { path: null, status: 'indexed', n_indexed: 1, n_scanned: 1, covers: ['stl'] },
    weak: false,
    results: [hit('a.stl')],
  }

  it('still yields its hits, addressed exactly as the un-slashed spelling does', async () => {
    stubIndex(SLASHED, result)
    const body = (await (await post({ text: 'dragon' })).json()) as {
      entries: { name: string; path: string }[]
      poses: Record<string, unknown>
      scores: Record<string, unknown>
    }
    expect(body.entries.map((e) => e.path)).toEqual(['/kits/a.stl'])
    expect(body.entries[0]!.name).toBe('a.stl')
    // The two riders are keyed off the same join, so they go with it.
    expect(body.poses['/kits/a.stl']).toBeDefined()
    expect(body.scores['/kits/a.stl']).toEqual({ score: 0.16, z: 3.9 })
  })

  it('a hit that escapes the collection is still refused, slash or no slash', async () => {
    // The normalisation must not have been a loosening: `..` out of the
    // collection is what the containment test is there for, and it is spelled
    // through `rel_path` because that is the only field the join trusts.
    stubIndex(SLASHED, { ...result, results: [hit('../dragon.stl')] })
    const body = (await (await post({ text: 'dragon' })).json()) as { entries: unknown[] }
    expect(body.entries).toEqual([])
  })
})

describe('a collection outside the library', () => {
  // It covers nothing this app can address: no hit inside it has a library
  // path, and neither has the root itself.
  const ELSEWHERE = { ...READY, collection_root: outside }
  const result = {
    scope: { path: null, status: 'indexed', n_indexed: 1, n_scanned: 1, covers: ['stl'] },
    weak: false,
    results: [hit('dragon.stl')],
  }

  it('reports no collection root, and says why instead of naming a path', async () => {
    stubIndex(ELSEWHERE, result)
    const body = (await (await app.request('/api/semantic/status', { headers: LOOPBACK })).json()) as {
      state: string
      collectionRoot?: string
      detail?: string
    }
    expect(body.state).toBe('ready')
    // Absent rather than absolute: the side panel would otherwise offer a path
    // the user cannot navigate to, and `indexCovers` would read it as coverage.
    expect(body.collectionRoot).toBeUndefined()
    expect(body.detail).toBe('the index covers a location outside the library')
  })

  it('offers no scope at any library path', async () => {
    for (const path of ['/', '/kits']) {
      stubIndex(ELSEWHERE, result)
      const res = await post({ text: 'dragon', path })
      expect([path, res.status]).toEqual([path, 400])
    }
  })

  it('answers an unscoped query with nothing, rather than tiles nothing can address', async () => {
    stubIndex(ELSEWHERE, result)
    const res = await post({ text: 'dragon' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: unknown[]; scores: Record<string, unknown> }
    expect(body.entries).toEqual([])
    expect(body.scores).toEqual({})
  })
})

// The status the index actually answers when its cache is unusable: `ready:
// false` with every root it lacks spelled as JSON `null`, `collection_root`
// included. A null there is not `undefined`, so before the boundary
// normalised it (`probe`'s `??`), it passed every `=== undefined` guard and
// crashed `libPathOf(null)` — and once peeks probed the index
// (`posedFirstPeek`), that took every contact sheet down with it, live.
describe('an index answering null roots', () => {
  const CACHE_UNUSABLE = {
    ready: false,
    elapsed: 275.0,
    loaded_at: null,
    collection_root: null,
    covers: null,
    volume: { present: null, root: null, missing: null },
    failure: {
      reason: 'no cached embeddings found — run classify_stls.py first',
      hint: null,
      kind: 'CacheUnusable',
    },
  }

  it('reports a state, never a 500, from the status route', async () => {
    stubIndex(CACHE_UNUSABLE)
    const res = await app.request('/api/semantic/status', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      state: string
      collectionRoot?: unknown
      covers?: unknown
      elapsed?: unknown
    }
    // 275s past start is past WEDGED_AFTER_S — the state is a diagnosis, not
    // the point here; the point is that it answered at all.
    expect(body.state).toBe('wedged')
    expect(body.collectionRoot).toBeUndefined()
    // Every nullable wire field is normalised, not only the one that crashed:
    // a JSON null must never reach the typed side (found by review — the
    // covers half of the fix was unfalsified). A PRESENT number passes.
    expect(body.covers).toBeUndefined()
    expect(body.elapsed).toBe(275)
  })

  it('normalises a null elapsed instead of rendering it as a number', async () => {
    // The side panel does `elapsed !== undefined ? Math.round(elapsed) : ''` —
    // a null slipping through drew "(0s)" where nothing belongs.
    stubIndex({ ...CACHE_UNUSABLE, elapsed: null, failure: null })
    const res = await app.request('/api/semantic/status', { headers: LOOPBACK })
    const body = (await res.json()) as { state: string; elapsed?: unknown }
    expect(res.status).toBe(200)
    expect(body.elapsed).toBeUndefined()
  })

  it('leaves the peek the plain walk it always was', async () => {
    stubIndex(CACHE_UNUSABLE)
    const res = await app.request(`/api/peek?path=${encodeURIComponent('/kits')}`, {
      headers: LOOPBACK,
    })
    expect(res.status).toBe(200)
    const entries = (await res.json()) as { name: string }[]
    expect(entries.map((e) => e.name)).toEqual(['a.stl'])
  })
})
