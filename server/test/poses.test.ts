/**
 * The listing-wide pose supply: `GET /api/semantic/poses`, and the contact
 * sheet that now prefers models the index holds an orientation for
 * (`pose-for-every-model` §2).
 *
 * The index is a separate service that is usually not running, so it is stubbed
 * at `fetch` exactly as `semantic.test.ts` stubs `/query` — one handler that
 * tells `/status` from the POSTs, so every state the feature answers
 * differently in is reachable here. The `/poses` contract it stubs is the
 * pinned one: `{ paths: [<real path>…] }` in, `{ poses: { <real path>:
 * pose | null } }` out, 503 while warming, at most 1024 paths.
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `peek.test.ts`'s pass-through `readdir` mock, here for the same reason: the
 * cells that name *which* models the bound reached are order-sensitive, vitest
 * runs on Node (which sorts what libuv returns) and the server runs on Bun
 * (which does not). Reversing is the one order this suite can produce that is
 * definitely not the filesystem's, so a cell run under it asserts the
 * pre-charge sort in `listFsDir` rather than the runtime's own tidiness.
 */
const rd = vi.hoisted(() => ({ reverse: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      const out = await actual.readdir(...args)
      return rd.reverse ? [...out].reverse() : out
    }) as typeof actual.readdir,
  }
})

import type { DirEntry, IndexPose } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { createLibrary } from '../src/library'
import { peek } from '../src/listing'
import { posesForPaths, resetIndexStatus } from '../src/semantic'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * libTop/
 *   mixed/   a.stl b.stl c.stl d.stl e.stl f.stl       (c and e are posed)
 *   links/   real.stl  alias -> real.stl  escape -> outsideFs/secret.stl
 *   wide/    m00.stl … m79.stl                         (80 models, over budget)
 *   nest/    a.stl  sub/{p.stl,q.stl}
 *   mix2/    m.stl  notes.txt  kit.zip  sub/s.stl
 *   only/    one.stl
 *   empty/
 */
const libTop = realTempDir('mb-poses-')
const outsideFs = realTempDir('mb-poses-outside-')
writeFileSync(join(outsideFs, 'secret.stl'), stlBytes(90))

mkdirSync(join(libTop, 'mixed'))
const MIXED = ['a.stl', 'b.stl', 'c.stl', 'd.stl', 'e.stl', 'f.stl']
MIXED.forEach((n, i) => writeFileSync(join(libTop, 'mixed', n), stlBytes(i + 1)))

mkdirSync(join(libTop, 'links'))
writeFileSync(join(libTop, 'links', 'real.stl'), stlBytes(20))
symlinkSync(join(libTop, 'links', 'real.stl'), join(libTop, 'links', 'alias.stl'))
symlinkSync(join(outsideFs, 'secret.stl'), join(libTop, 'links', 'escape.stl'))

mkdirSync(join(libTop, 'wide'))
const WIDE = Array.from({ length: 80 }, (_, i) => `m${String(i).padStart(2, '0')}.stl`)
for (const n of WIDE) writeFileSync(join(libTop, 'wide', n), stlBytes(30))

mkdirSync(join(libTop, 'nest', 'sub'), { recursive: true })
writeFileSync(join(libTop, 'nest', 'a.stl'), stlBytes(40))
writeFileSync(join(libTop, 'nest', 'sub', 'p.stl'), stlBytes(41))
writeFileSync(join(libTop, 'nest', 'sub', 'q.stl'), stlBytes(42))

mkdirSync(join(libTop, 'mix2', 'sub'), { recursive: true })
writeFileSync(join(libTop, 'mix2', 'm.stl'), stlBytes(50))
writeFileSync(join(libTop, 'mix2', 'notes.txt'), 'not a model')
writeFileSync(join(libTop, 'mix2', 'sub', 's.stl'), stlBytes(51))
writeFileSync(
  join(libTop, 'mix2', 'kit.zip'),
  zipSync({ 'box.stl': new Uint8Array(stlBytes(52)) }),
)

mkdirSync(join(libTop, 'only'))
writeFileSync(join(libTop, 'only', 'one.stl'), stlBytes(60))
mkdirSync(join(libTop, 'empty'))

const cacheDir = realTempDir('mb-poses-cache-')
const library = libraryFor(libTop)
const app = createApp(new ThumbCache(cacheDir), undefined, undefined, library)

afterAll(() => {
  rmSync(libTop, { recursive: true, force: true })
  rmSync(outsideFs, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

/** A `/status` body for an index that is up and rooted at the library's top. */
const READY = {
  ready: true,
  elapsed: 18.8,
  collection_root: libTop,
  covers: ['stl'],
  volume: { present: true, root: libTop, missing: null },
}

const POSE: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}

/** A real filesystem path, the only kind the index is ever told about. */
const fs = (...parts: string[]) => join(libTop, ...parts)

interface Stub {
  /** `/status`, or `'refused'` for a connection nobody is listening on. */
  status?: unknown | 'refused'
  /** Which real paths have a pose. Everything else asked about answers `null`. */
  posed?: readonly string[]
  /** Answer `/poses` with this status instead of 200 (503 = still loading). */
  posesStatus?: number
}

/** Every `/poses` body this server sent, in order. */
let sent: { paths: string[] }[] = []

function stubIndex(stub: Stub): void {
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).endsWith('/status')) {
        if (stub.status === 'refused') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(stub.status ?? READY), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (String(url).endsWith('/poses') && init?.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { paths: string[] }
        sent.push(body)
        if (stub.posesStatus !== undefined && stub.posesStatus !== 200) {
          return new Response(JSON.stringify({ detail: 'no' }), { status: stub.posesStatus })
        }
        const poses: Record<string, IndexPose | null> = {}
        for (const p of body.paths) poses[p] = (stub.posed ?? []).includes(p) ? POSE : null
        return new Response(JSON.stringify({ poses }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }),
  )
}

beforeEach(async () => {
  resetIndexStatus()
  await library.state()
})
afterEach(() => vi.unstubAllGlobals())

const posesOf = async (path: string): Promise<Record<string, IndexPose>> => {
  const res = await app.request(`/api/semantic/poses?path=${encodeURIComponent(path)}`, {
    headers: LOOPBACK,
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { poses: Record<string, IndexPose> }).poses
}

const peekOf = async (path: string, n?: number): Promise<DirEntry[]> => {
  const q = n === undefined ? '' : `&n=${n}`
  const res = await app.request(`/api/peek?path=${encodeURIComponent(path)}${q}`, {
    headers: LOOPBACK,
  })
  expect(res.status).toBe(200)
  return (await res.json()) as DirEntry[]
}

const names = (entries: DirEntry[]) => entries.map((e) => e.name)

describe('the poses proxy', () => {
  it('answers a directory’s models keyed by library path, asking about real ones', async () => {
    stubIndex({ posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
    expect(await posesOf('/mixed')).toEqual({ '/mixed/c.stl': POSE, '/mixed/e.stl': POSE })
    // The index speaks the volume's paths and the wire speaks the library's
    // (D2): the translation is this route's whole job, so both halves are
    // asserted rather than only the one that comes back.
    expect(sent).toHaveLength(1)
    expect(sent[0]!.paths).toEqual(MIXED.map((n) => fs('mixed', n)))
  })

  it('asks about models only — not folders, archives, or anything below', async () => {
    stubIndex({})
    await posesOf('/mix2')
    expect(sent[0]!.paths).toEqual([fs('mix2', 'm.stl')])
  })

  it('leaves out a model the index holds no orientation for', async () => {
    // Null and absent are one fact, and the key is simply not there — a client
    // reading `poses[path]` must not have to tell `null` from missing.
    stubIndex({ posed: [fs('mixed', 'c.stl')] })
    expect(Object.keys(await posesOf('/mixed'))).toEqual(['/mixed/c.stl'])
  })

  it('a directory with no models asks nothing at all', async () => {
    stubIndex({})
    expect(await posesOf('/empty')).toEqual({})
    expect(sent).toHaveLength(0)
  })
})

describe('per-path confinement, the rules a hit is mapped under', () => {
  /**
   * Driven through `posesForPaths` rather than the route, deliberately: the
   * listing already drops an out-of-library symlink before a route could ever
   * name one (asserted as the control below), so the *boundary's* own rule is
   * only observable where the boundary is. The peek's finds and the route's
   * models both arrive here, so this is the one place it has to hold.
   */
  it('drops a model that resolves outside the library, and never asks about it', async () => {
    stubIndex({ posed: [fs('links', 'real.stl'), join(outsideFs, 'secret.stl')] })
    const poses = await posesForPaths(
      library,
      ['/links/real.stl', '/links/escape.stl', '/gone.stl', '/mix2/kit.zip!/box.stl'],
      libTop,
    )
    // Only the model that is really in the library. The escape has a pose
    // upstream — the index followed the symlink when it embedded it — and it
    // still must not reach a surface `/api/file` refuses the same path on.
    expect(Object.keys(poses)).toEqual(['/links/real.stl'])
    // Dropped *before* the request, not after the answer: an out-of-library
    // path is not the index's to be asked about.
    expect(sent[0]!.paths).toEqual([fs('links', 'real.stl')])
  })

  it('gives an in-library alias the pose of the model it points at', async () => {
    // Two library paths, one real path, one thing the index knows about.
    stubIndex({ posed: [fs('links', 'real.stl')] })
    const poses = await posesForPaths(library, ['/links/real.stl', '/links/alias.stl'], libTop)
    expect(poses).toEqual({ '/links/real.stl': POSE, '/links/alias.stl': POSE })
    // Asked about once, however many names pointed at it.
    expect(sent[0]!.paths).toEqual([fs('links', 'real.stl')])
  })

  it('the control: the route lists the alias and the model, never the escape', async () => {
    // The escaping model is posed upstream and the listing never names it, so
    // the route asks about one real path and answers for the two library paths
    // that reach it — and `secret.stl` appears in neither half.
    stubIndex({ posed: [fs('links', 'real.stl'), join(outsideFs, 'secret.stl')] })
    expect(Object.keys(await posesOf('/links')).sort()).toEqual([
      '/links/alias.stl',
      '/links/real.stl',
    ])
    expect(sent[0]!.paths).toEqual([fs('links', 'real.stl')])
  })
})

describe('an index that cannot answer costs the listing nothing', () => {
  const silent: [string, Stub][] = [
    ['absent — nobody started it', { status: 'refused' }],
    ['warming — SigLIP is still loading', { status: { ...READY, ready: false, elapsed: 3 } }],
    ['wedged — the load will not finish', { status: { ...READY, ready: false, elapsed: 400 } }],
    [
      'volume-gone — the library’s drive is unplugged',
      { status: { ready: false, elapsed: 5, volume: { present: false, root: '/nope' } } },
    ],
  ]

  for (const [label, stub] of silent) {
    it(`${label}: empty poses, a 200, and no request`, async () => {
      stubIndex(stub)
      expect(await posesOf('/mixed')).toEqual({})
      expect(sent).toHaveLength(0)
    })
  }

  it('a collection that does not cover the location: empty, and nothing asked', async () => {
    // The index is up and ready, but rooted at a subtree this directory is not
    // in — every path fails containment on its own, so there is nothing to ask.
    stubIndex({ status: { ...READY, collection_root: join(libTop, 'nest') } })
    expect(await posesOf('/mixed')).toEqual({})
    expect(sent).toHaveLength(0)
  })

  it('a 503 raced mid-request is empty, not an error', async () => {
    // The probe said ready and the POST said otherwise — the warming race
    // `askIndex` classifies, which must not fail a route that is advisory.
    stubIndex({ posesStatus: 503 })
    expect(await posesOf('/mixed')).toEqual({})
    expect(sent).toHaveLength(1)
  })

  it('a refusal from an index that is up is empty too — a pose never fails a listing', async () => {
    stubIndex({ posesStatus: 400 })
    expect(await posesOf('/mixed')).toEqual({})
  })
})

describe('the poses route', () => {
  it('requires a path', async () => {
    stubIndex({})
    for (const url of ['/api/semantic/poses', '/api/semantic/poses?path=']) {
      const res = await app.request(url, { headers: LOOPBACK })
      expect([url, res.status]).toEqual([url, 400])
      expect(await res.json()).toEqual({ error: 'path is required' })
    }
  })

  it('404s a path that is not there, index up or down', async () => {
    // The path semantics are `/api/dir`'s and are not the index's to change:
    // asking about a directory that does not exist is the same mistake either
    // way, and only the *index's* absence is answered silently.
    for (const stub of [{}, { status: 'refused' as const }]) {
      stubIndex(stub)
      const res = await app.request('/api/semantic/poses?path=/mixed/nope', { headers: LOOPBACK })
      expect(res.status).toBe(404)
    }
  })

  it('400s a file, which is there but has no inside', async () => {
    stubIndex({})
    const res = await app.request('/api/semantic/poses?path=/mixed/a.stl', { headers: LOOPBACK })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'not a directory or zip: /mixed/a.stl' })
  })

  it('canonicalises the path it was given, like every other path route', async () => {
    stubIndex({ posed: [fs('mixed', 'c.stl')] })
    expect(await posesOf('//mixed/.')).toEqual({ '/mixed/c.stl': POSE })
  })

  it('is a path route: the not-ready state envelope, like every other', async () => {
    stubIndex({})
    const home = realTempDir('mb-poses-unconfigured-')
    const cache = realTempDir('mb-poses-unconfigured-cache-')
    const bare = createApp(
      new ThumbCache(cache),
      undefined,
      undefined,
      createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') }),
    )
    const res = await bare.request('/api/semantic/poses?path=/mixed', { headers: LOOPBACK })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'no library root is configured',
      state: 'unconfigured',
    })
    rmSync(home, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  })
})

describe('the contact sheet prefers posed models', () => {
  it('puts the posed finds first and fills the rest in walk order', async () => {
    // /mixed holds a…f; c and e are posed. Today's sheet was a,b,c,d.
    stubIndex({ posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
    expect(names(await peekOf('/mixed', 4))).toEqual(['c.stl', 'e.stl', 'a.stl', 'b.stl'])
  })

  it('falls back to unposed finds when the tree runs out of posed ones', async () => {
    stubIndex({ posed: [fs('mixed', 'f.stl')] })
    expect(names(await peekOf('/mixed', 4))).toEqual(['f.stl', 'a.stl', 'b.stl', 'c.stl'])
  })

  it('prefers a posed model found deeper over an unposed one at the top level', async () => {
    // The walk still takes the level's own models before descending; the
    // ranking is what pulls `q.stl` past `a.stl`, so this is the preference
    // and not the walk order being asserted.
    stubIndex({ posed: [fs('nest', 'sub', 'q.stl')] })
    expect(names(await peekOf('/nest', 3))).toEqual(['q.stl', 'a.stl', 'p.stl'])
  })

  it('previews the same models on two calls', async () => {
    stubIndex({ posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
    expect(await peekOf('/mixed', 4)).toEqual(await peekOf('/mixed', 4))
  })

  it('a sheet that fits shows its posed model first', async () => {
    stubIndex({ posed: [fs('nest', 'sub', 'p.stl')] })
    expect(names(await peekOf('/nest', 8))).toEqual(['p.stl', 'a.stl', 'q.stl'])
  })

  it('one model, one pose, no reordering to do', async () => {
    stubIndex({ posed: [fs('only', 'one.stl')] })
    expect(names(await peekOf('/only', 4))).toEqual(['one.stl'])
  })
})

describe('what the ranking costs', () => {
  it('is one request per peek, never one per level', async () => {
    stubIndex({ posed: [fs('nest', 'sub', 'q.stl')] })
    await peekOf('/nest', 4)
    // /nest has a level of its own and a subdirectory: a per-level batch would
    // be two. The bound caps the finds, so one is all it ever is.
    expect(sent).toHaveLength(1)
  })

  it('never sends an oversized batch: the entry bound caps the finds well under 1024', async () => {
    stubIndex({})
    await peekOf('/wide', 4)
    expect(sent).toHaveLength(1)
    // 80 models, a 64-entry bound: the walk finds 64 and asks about 64. The
    // assertion that matters is the ceiling — the index refuses past 1024, and
    // nothing a peek can walk gets near it.
    expect(sent[0]!.paths.length).toBe(64)
    expect(sent[0]!.paths.length).toBeLessThanOrEqual(1024)
  })

  // Run in both directory orders this suite can produce. *Which* 64 the bound
  // reaches is `listFsDir`'s pre-charge sort's answer, not the runtime's, and
  // the reversed pass is what says so — vitest sorts, the server (Bun) does
  // not, so a one-order cell here would assert nothing about production.
  for (const reverse of [false, true]) {
    it(`the entry bound is unchanged: a posed model past it is never reached (readdir ${reverse ? 'reversed' : 'as given'})`, async () => {
      // m63 is the last entry the 64-step bound pays for and m70 is well past
      // it. Both are posed upstream; only m63 can reach the sheet, and its
      // presence is also what proves the walk no longer stops at the fourth
      // model.
      stubIndex({ posed: [fs('wide', 'm63.stl'), fs('wide', 'm70.stl')] })
      rd.reverse = reverse
      try {
        const sheet = names(await peekOf('/wide', 4))
        expect(sheet).toEqual(['m63.stl', 'm00.stl', 'm01.stl', 'm02.stl'])
        expect(sheet).not.toContain('m70.stl')
        expect(sent[0]!.paths).toHaveLength(64)
        expect(sent[0]!.paths).not.toContain(fs('wide', 'm70.stl'))
      } finally {
        rd.reverse = false
      }
    })
  }
})

describe('an index that is silent selects exactly as it did before poses', () => {
  /**
   * Byte-identity against the pre-change selection, and `peek()` itself is what
   * that selection *was*: the route's body used to be `c.json(await peek(
   * library, libPath, n))` verbatim. Compared as serialised JSON rather than
   * with `toEqual`, so key order counts too — this is the requirement's
   * "exactly today's selection", not "the same models".
   */
  const identical = async (path: string, n: number): Promise<void> => {
    const before = JSON.stringify(await peek(library, path, n))
    const res = await app.request(`/api/peek?path=${encodeURIComponent(path)}&n=${n}`, {
      headers: LOOPBACK,
    })
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).toBe(before)
  }

  for (const [label, stub] of [
    ['absent', { status: 'refused' as const }],
    ['warming', { status: { ...READY, ready: false, elapsed: 3 } }],
    ['wedged', { status: { ...READY, ready: false, elapsed: 400 } }],
  ] as [string, Stub][]) {
    it(`${label}: the same entries, byte for byte`, async () => {
      stubIndex(stub)
      await identical('/mixed', 4)
      await identical('/nest', 4)
      await identical('/wide', 4)
      await identical('/only', 4)
      await identical('/empty', 4)
      // And it costs nothing: no batch at all, and the walk is the narrow
      // stop-at-n one it always was rather than a walk to the bound.
      expect(sent).toHaveLength(0)
    })
  }

  it('a collection that does not cover the folder: the same entries, and nothing asked', async () => {
    // Ready, but rooted at a subtree these folders are not in. Coverage is
    // decided per path by the same confinement a hit is mapped under, so the
    // batch is never sent rather than sent and ignored.
    stubIndex({ status: { ...READY, collection_root: join(libTop, 'nest') } })
    await identical('/mixed', 4)
    await identical('/wide', 4)
    await identical('/only', 4)
    expect(sent).toHaveLength(0)
  })

  it('an index that answers but holds no pose selects the same way too', async () => {
    // The ranked path with an empty answer must still be today's sheet: the
    // first four finds in walk order are a prefix of every find, so the
    // fallback half alone reproduces it.
    stubIndex({ posed: [] })
    await identical('/mixed', 4)
    await identical('/wide', 4)
    expect(sent.length).toBeGreaterThan(0)
  })
})
