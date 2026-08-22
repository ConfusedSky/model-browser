// The similar proxy: the hit→tile join it shares with meaning search, the scope
// it deliberately does not send, and the four lanes an index failure comes back
// through. Its own file rather than a branch inside semantic.test.ts, because
// the fetch stub there answers every POST with one fixture and this route needs
// `/query` and `/similar` to be told apart.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { resetIndexStatus } from '../src/semantic'
import { LOOPBACK, stlBytes } from './helpers'

const root = mkdtempSync(join(tmpdir(), 'mb-sim-'))
writeFileSync(join(root, 'hero.stl'), stlBytes(1))
writeFileSync(join(root, 'base.stl'), stlBytes(2))
const cacheDir = mkdtempSync(join(tmpdir(), 'mb-sim-cache-'))
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

const POSE = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}

function hit(rel: string, pose: unknown = POSE) {
  return {
    id: `${rel}_abc123`,
    path: join(root, rel),
    rel_path: rel,
    name: rel,
    score: 0.93,
    z: 3.3,
    pose,
  }
}

/**
 * Answer `/status` with `status` and `/similar` with `similar` — routed by URL,
 * so a request that went to `/query` by mistake fails loudly rather than being
 * answered by the fixture meant for the other route.
 */
function stubIndex(
  status: unknown,
  similar?: unknown,
  opts: { similarStatus?: number } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/status')) {
        if (status === 'refused') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(status), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (String(url).endsWith('/similar')) {
        if (similar === 'refused') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(similar ?? {}), { status: opts.similarStatus ?? 200 })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }),
  )
}

/** The body of the last non-status POST — what the index was actually told. */
function sentBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } })
    .mock.calls
  return JSON.parse(calls.filter((c) => !String(c[0]).endsWith('/status')).at(-1)![1].body) as Record<
    string,
    unknown
  >
}

const post = (body: unknown) =>
  app.request('/api/semantic/similar', {
    method: 'POST',
    headers: { ...LOOPBACK, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const RESULT = { scope: { path: null }, results: [hit('base.stl')] }

beforeEach(() => resetIndexStatus())
afterEach(() => vi.unstubAllGlobals())

describe('a model’s neighbours', () => {
  it('joins hits to tiles through the same path a meaning answer takes', async () => {
    stubIndex(READY, RESULT)
    const body = (await (await post({ path: join(root, 'hero.stl'), k: 16 })).json()) as {
      path: string
      entries: { name: string; path: string; kind: string; size: number; mtime: number }[]
      poses: Record<string, unknown>
    }
    expect(body.entries).toHaveLength(1)
    // mtime and size come from this server's stat, not from the index, which
    // reports neither — the same join, and the same reason for it.
    expect(body.entries[0]!.path).toBe(join(root, 'base.stl'))
    expect(body.entries[0]!.kind).toBe('model')
    expect(body.entries[0]!.mtime).toBeGreaterThan(0)
    expect(body.entries[0]!.size).toBeGreaterThan(0)
    // Poses ride along, so a neighbour grid renders at the index's orientation
    // exactly as a meaning grid does.
    expect(body.poses[join(root, 'base.stl')]).toEqual(POSE)
    // The whole collection is what the view is about, and the answer says so.
    expect(body.path).toBe(root)
  })

  it('drops a hit that no longer resolves, without failing the request', async () => {
    stubIndex(READY, { ...RESULT, results: [hit('base.stl'), hit('moved-away.stl')] })
    const body = (await (await post({ path: join(root, 'hero.stl') })).json()) as {
      entries: unknown[]
    }
    expect(body.entries).toHaveLength(1)
  })

  it('a hit cannot name a file outside the collection', async () => {
    // `rel_path` is data from another process, and it is the only field trusted
    // for the join — the same rule the meaning route follows.
    stubIndex(READY, {
      ...RESULT,
      results: [
        { ...hit('base.stl'), rel_path: '../escape.stl', path: '/etc/passwd' },
        { ...hit('base.stl'), rel_path: 'base.stl', path: '/etc/passwd' },
      ],
    })
    const body = (await (await post({ path: join(root, 'hero.stl') })).json()) as {
      entries: { path: string }[]
    }
    expect(body.entries.map((e) => e.path)).toEqual([join(root, 'base.stl')])
  })

  it('sends no scope: neighbours are collection-wide', async () => {
    // 4.1a. The index's `scope` defaults to the whole collection, so stating
    // that default means sending nothing — and this is where it differs from
    // meaning search, which IS rooted at the browsed directory. A reviewer
    // finding the two scoped differently should find this test.
    stubIndex(READY, RESULT)
    await post({ path: join(root, 'hero.stl'), k: 16 })
    const body = sentBody()
    expect(body).not.toHaveProperty('scope')
    expect(body.path).toBe(join(root, 'hero.stl'))
    expect(body.k).toBe(16)
    // `pool` is left at the server's own default for the same reason `k` is not
    // a URL param: nothing on screen sets it (4.2).
    expect(body).not.toHaveProperty('pool')
  })

  it('leaves k to the index when the caller names none, rather than minting a second default', async () => {
    stubIndex(READY, RESULT)
    await post({ path: join(root, 'hero.stl') })
    expect(sentBody()).not.toHaveProperty('k')
  })

  it('refuses a k the index would refuse', async () => {
    stubIndex(READY, RESULT)
    expect((await post({ path: join(root, 'hero.stl'), k: 0 })).status).toBe(400)
    expect((await post({ path: join(root, 'hero.stl'), k: 4.5 })).status).toBe(400)
  })

  it('a model the index has never embedded comes back as a 404, in its own words', async () => {
    // The lane the UI owns a distinct sentence for: "not indexed yet — run the
    // classifier". It travels as the status rather than as text to sniff, and it
    // is unambiguous because the other unembeddable case (an archive interior)
    // never reaches this server.
    stubIndex(READY, { detail: `${join(root, 'hero.stl')} is not in the cache` }, { similarStatus: 404 })
    const res = await post({ path: join(root, 'hero.stl') })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string; state?: string }
    expect(body.error).toContain('not in the cache')
    // Availability is not what went wrong, so no state is claimed.
    expect(body.state).toBeUndefined()
  })

  it('any other refusal is still a 400, not a 404', async () => {
    // The index 422s a virtual path and a name matching more than one model.
    // Those are refusals to fix, not "this model is not embedded", and reading
    // them as the latter would tell the user to run the classifier over a path
    // that can never be in it.
    stubIndex(READY, { detail: 'names 2 models; /similar takes one' }, { similarStatus: 422 })
    const res = await post({ path: join(root, 'hero.stl') })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('takes one')
  })

  it('an index that fails on its own side is a bad gateway', async () => {
    stubIndex(READY, { detail: 'CUDA out of memory' }, { similarStatus: 500 })
    const res = await post({ path: join(root, 'hero.stl') })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('CUDA out of memory')
  })

  it('an unavailable index keeps the 503 envelope, state and all', async () => {
    stubIndex('refused')
    const res = await post({ path: join(root, 'hero.stl') })
    expect(res.status).toBe(503)
    expect((await res.json()).state).toBe('absent')
  })

  it('a 503 racing the warmup folds back into warming', async () => {
    stubIndex(READY, {}, { similarStatus: 503 })
    const res = await post({ path: join(root, 'hero.stl') })
    expect(res.status).toBe(503)
    expect((await res.json()).state).toBe('warming')
  })

  it('refuses a virtual path and a path outside the collection without asking the index', async () => {
    // Defense at the boundary: the honest client sends neither (the command is
    // absent on archive entries and outside the collection), so reaching here
    // means a hand-made request — and it must not become a 404, which would say
    // "index it again" about a path the index can never hold.
    stubIndex(READY, RESULT)
    expect((await post({ path: `${root}/kit.zip!/inner.stl` })).status).toBe(400)
    expect((await post({ path: join(tmpdir(), 'elsewhere.stl') })).status).toBe(400)
    const posts = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(
      (c) => String(c[0]).endsWith('/similar'),
    )
    expect(posts).toHaveLength(0)
  })

  it('a missing path is not a request', async () => {
    stubIndex(READY, RESULT)
    expect((await post({})).status).toBe(400)
    expect((await post({ path: '   ' })).status).toBe(400)
  })

  it('carries none of the meaning residue a similarity view does not read', async () => {
    // 4.7: the index publishes no `weak` for neighbours (measured — model-to-
    // model cosines run 0.85–0.99 where text cosines run ~0.1), and forwarding
    // its `scope` dict would make the client's label read the view as a meaning
    // search. Order carries strength; there is nothing else to say.
    stubIndex(READY, { scope: { path: null, status: 'indexed' }, results: [hit('base.stl')] })
    const body = (await (await post({ path: join(root, 'hero.stl') })).json()) as Record<
      string,
      unknown
    >
    expect(Object.keys(body).sort()).toEqual(['entries', 'path', 'poses'])
  })
})
