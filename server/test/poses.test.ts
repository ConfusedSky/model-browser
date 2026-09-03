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
 *
 * It counts as well as passes through, because *how wide the peek walked* is
 * the thing one cell below is about and it is invisible in the answer: an
 * uncovered folder returns the same entries either way and differs only in what
 * it read to get them. `readdir` is the width itself (one per directory
 * entered) and `realpath` is what a wide walk pays per find; both are counted
 * against a control run of `peek()` in the same cell, never against a number
 * written down here, so neither can rot as the walk's own bookkeeping changes.
 */
const rd = vi.hoisted(() => ({ reverse: false, readdir: 0, realpath: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      rd.readdir++
      const out = await actual.readdir(...args)
      return rd.reverse ? [...out].reverse() : out
    }) as typeof actual.readdir,
    realpath: (async (...args: Parameters<typeof actual.realpath>) => {
      rd.realpath++
      return actual.realpath(...args)
    }) as typeof actual.realpath,
  }
})

import type { DirEntry, IndexPose } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { createLibrary } from '../src/library'
import { PEEK_MAX_FINDS, peek } from '../src/listing'
import {
  POSES_MAX,
  UNDER_LIMIT,
  entriesUnder,
  posesForPaths,
  probeStatus,
  resetIndexStatus,
} from '../src/semantic'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * libTop/
 *   mixed/   a.stl b.stl c.stl d.stl e.stl f.stl       (c and e are posed)
 *   links/   real.stl  alias -> real.stl  escape -> outsideFs/secret.stl
 *   wide/    m00.stl … m79.stl                         (80 models, over budget)
 *   nest/    a.stl  sub/{p.stl,q.stl}
 *   mix2/    m.stl  notes.txt  kit.zip  sub/s.stl
 *   only/    one.stl
 *   cover/   a.stl b.stl c.stl d.stl  s1/x.stl  s2/y.stl  s3/z.stl
 *   lich/    01-presupported/{00..79}.txt   02-kit/{guard,hero,minion,scout}.stl
 *   bulk/    b0000.stl … b1024.stl                     (POSES_MAX + 1: two chunks)
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

// Four models at the top level and three subdirectories under them: a sheet of
// four is satisfied without descending at all, so the narrow walk reads one
// directory and the walk-to-the-bound reads four. That gap is what the
// coverage cell measures.
mkdirSync(join(libTop, 'cover'))
for (const n of ['a.stl', 'b.stl', 'c.stl', 'd.stl']) {
  writeFileSync(join(libTop, 'cover', n), stlBytes(70))
}
for (const [sub, model] of [
  ['s1', 'x.stl'],
  ['s2', 'y.stl'],
  ['s3', 'z.stl'],
] as const) {
  mkdirSync(join(libTop, 'cover', sub))
  writeFileSync(join(libTop, 'cover', sub, model), stlBytes(71))
}

/**
 * The Lich Lord shape (D5), the folder this whole section exists for: a folder
 * of folders whose **first-sorted** subtree is deep and holds no model at all,
 * and whose kit sits behind it. Eighty entries in `01-presupported` is more than
 * the peek's 64-entry budget, so the walk dies inside it and never reaches
 * `02-kit` — the sheet is empty however much of the folder the index knows. It
 * is asserted empty as a control in the cell itself rather than taken on faith
 * here, so the fixture cannot quietly stop being the shape it is named for.
 */
mkdirSync(join(libTop, 'lich', '01-presupported'), { recursive: true })
for (let i = 0; i < 80; i++) {
  writeFileSync(join(libTop, 'lich', '01-presupported', `${String(i).padStart(2, '0')}.txt`), 'x')
}
mkdirSync(join(libTop, 'lich', '02-kit'))
const LICH_KIT = ['guard.stl', 'hero.stl', 'minion.stl', 'scout.stl']
LICH_KIT.forEach((n, i) => writeFileSync(join(libTop, 'lich', '02-kit', n), stlBytes(80 + i)))

/**
 * A second, equally real spelling of `lich/`. The index is a separate run with
 * its own view of the volume, and one invoked through a symlinked root answers
 * paths under *that* root — `aka/lich/02-kit/hero.stl` for the file this server
 * calls `lich/02-kit/hero.stl`. Nothing here peeks `/aka`; it exists so a cell
 * can hand the peek an answer in a spelling it did not ask in.
 */
mkdirSync(join(libTop, 'aka'))
symlinkSync(join(libTop, 'lich'), join(libTop, 'aka', 'lich'))

/**
 * One model more than one `/poses` call may carry, so `askPoses` really splits
 * — the only way the per-chunk tolerance is reachable from outside. Distinct
 * *files*, not names: the batch is keyed by real path, and 1025 aliases of one
 * model would collapse back to a single chunk.
 */
const BULK = Array.from({ length: POSES_MAX + 1 }, (_, i) => `b${String(i).padStart(4, '0')}.stl`)
mkdirSync(join(libTop, 'bulk'))
for (const n of BULK) writeFileSync(join(libTop, 'bulk', n), stlBytes(100))

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

/**
 * What `/under` holds beneath the folder it is asked about (D5). `models` is the
 * index's own order — relative-path sorted, *not* posed-first, since ranking is
 * this server's job — and the stub scopes it to the asked prefix and honours the
 * asked `limit`, the way the index does.
 */
interface UnderStub {
  /** Real filesystem paths the index holds, in its answer order. */
  models: readonly string[]
  /** Which of them carry an orientation. Everything else answers `pose: null`. */
  posed?: readonly string[]
  /**
   * Re-spell the paths the answer carries, *after* the scoping and the cut have
   * been done on the real ones. A classify run invoked through a symlinked root
   * answers in that root's spelling for a tree this server names another way,
   * and there is no other way to produce that from out here. Applied last on
   * purpose: the stub stays as strict about the prefix and the limit as the
   * index is, so a confinement bug still cannot pass as a green cell.
   */
  spellAs?: { from: string; to: string }
}

interface Stub {
  /** `/status`, or `'refused'` for a connection nobody is listening on. */
  status?: unknown | 'refused'
  /**
   * Answer `/status` with a 200 carrying literal `null`. Its own flag and not
   * `status: null`, because `stub.status ?? READY` reads a null `status` as
   * "unset" — the very `??` that is the point of the cell.
   */
  statusNull?: boolean
  /**
   * One `/status` body per ask, in order, each with its own delay — the only way
   * to make two probes overlap *and* disagree, which is what the cache's
   * ordering is about. Past the end of the series, `status` answers as usual.
   */
  statusSeries?: readonly { body: unknown; delayMs?: number }[]
  /**
   * `/under`'s answer. **Absent means `"unindexed"`** — the index reaches the
   * folder and has never scanned it — which is the walk fallback, so every cell
   * written before D5 keeps exercising exactly the path it was written about.
   */
  under?: UnderStub
  /** Answer `/under` with this status instead of 200 (503 = still loading). */
  underStatus?: number
  /** Hold `/under` open forever, answering only the caller's abort. */
  underHangs?: boolean
  /** Answer `/under` 200 with a body that is not JSON at all. */
  underMalformed?: boolean
  /** Answer `/under`'s *headers* at once and never finish its body. */
  underBodyStalls?: boolean
  /** Answer `/under` 200 with a body of literal `null` — valid JSON, no answer. */
  underNull?: boolean
  /**
   * Answer `/under` 200 with exactly this JSON body, bypassing the fixture's
   * scoping and cutting — for bodies whose *shape* is the point (an object
   * whose fields hold the wrong types), which `under` cannot spell.
   */
  underBody?: unknown
  /** Which real paths have a pose. Everything else asked about answers `null`. */
  posed?: readonly string[]
  /**
   * Real paths the index answers with something that is *not* an `IndexPose`,
   * whatever `badPose` holds. Applied by both `/poses` and `/under`, since a
   * pose enters from either.
   */
  badPosed?: readonly string[]
  /** What a `badPosed` path gets. Deliberately `unknown`: the point is a value
   *  the declared type forbids and the wire does not. */
  badPose?: unknown
  /** Answer `/poses` with this status instead of 200 (503 = still loading). */
  posesStatus?: number
  /** Answer `/poses` 200 with a body of literal `null`. */
  posesNull?: boolean
  /**
   * Which `/poses` **chunks**, by 0-based order within one `askPoses` call,
   * answer 500 instead of 200. The only way to make one chunk of a batch fail
   * while its siblings answer, which is what the partial merge is about.
   */
  posesFailAt?: readonly number[]
  /**
   * Hold `/poses` open forever, answering only the caller's abort — the only way
   * the request's own timeout is observable from out here.
   */
  posesHangs?: boolean
  /** Answer `/poses` 200 with a body that is not JSON at all. */
  posesMalformed?: boolean
  /** Answer `/poses`' *headers* at once and never finish its body. */
  posesBodyStalls?: boolean
  /** Make `/status` take long enough that concurrent callers really overlap. */
  statusDelayMs?: number
}

/** Every `/poses` body this server sent, in order. */
let sent: { paths: string[] }[] = []
/** Every `/under` body this server sent, in order. */
let asked: { path: string; limit: number }[] = []
/** How many times `/status` was asked — the probe count, per cell. */
let statusAsks = 0

/** A connection the caller can only abort — what a real `fetch` does when the
 *  service accepted it and then stopped saying anything. */
function hang(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (signal === undefined) return // nothing to abort it: hang for real
    signal.addEventListener('abort', () => reject(signal.reason))
  })
}

/**
 * `hang()`'s other half: a **200 that arrives** and then says nothing more. The
 * status line and the headers are in on time, so `fetch` resolves and the
 * request's own `try` is already behind us; the body never lands, and the
 * timeout that was going to abort the request aborts the *read* instead.
 *
 * A real `fetch` wires its signal to the body stream it hands back. This one is
 * a stub, so the wiring is done by hand — the same `signal.reason` `hang`
 * rejects with, delivered to the stream rather than to the promise. Without it
 * the read would hang for real and nothing would ever fail.
 */
function stalledBody(signal: AbortSignal | undefined): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        if (signal === undefined) return
        signal.addEventListener('abort', () => controller.error(signal.reason))
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

/** A 200 whose body is not JSON: the other way a request that *arrived* has no
 *  answer in it. */
const malformedBody = (): Response =>
  new Response('{"status": "ok", "models": [', {
    headers: { 'content-type': 'application/json' },
  })

/**
 * A 200 whose body is literal `null` — the case a parse guard does not catch,
 * because `null` *is* valid JSON. Every read the callers make of it
 * (`answer.poses`, `raw.status`, `raw.collection_root`) is a `TypeError` on
 * this body, and none of them is an `IndexError`.
 */
const nullBody = (): Response =>
  new Response('null', { headers: { 'content-type': 'application/json' } })

function stubIndex(stub: Stub): void {
  sent = []
  asked = []
  statusAsks = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
      if (String(url).endsWith('/status')) {
        const turn = stub.statusSeries?.[statusAsks]
        statusAsks++
        const delayMs = turn?.delayMs ?? stub.statusDelayMs
        if (delayMs !== undefined) await new Promise((r) => setTimeout(r, delayMs))
        if (turn !== undefined) {
          return new Response(JSON.stringify(turn.body), {
            headers: { 'content-type': 'application/json' },
          })
        }
        if (stub.statusNull === true) return nullBody()
        if (stub.status === 'refused') throw new TypeError('fetch failed')
        return new Response(JSON.stringify(stub.status ?? READY), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (String(url).endsWith('/under') && init?.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { path: string; limit: number }
        asked.push(body)
        if (stub.underHangs === true) return hang(init.signal)
        if (stub.underMalformed === true) return malformedBody()
        if (stub.underNull === true) return nullBody()
        if (stub.underBody !== undefined) {
          return new Response(JSON.stringify(stub.underBody), {
            headers: { 'content-type': 'application/json' },
          })
        }
        if (stub.underBodyStalls === true) return stalledBody(init.signal)
        if (stub.underStatus !== undefined && stub.underStatus !== 200) {
          return new Response(JSON.stringify({ detail: 'no' }), { status: stub.underStatus })
        }
        const held = stub.under
        if (held === undefined) {
          return new Response(
            JSON.stringify({ status: 'unindexed', models: [], matched: 0, truncated: false }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        // Scoped to the prefix and cut to the asked limit, as the index scopes
        // and cuts: a stub that answered a sibling's models would let a
        // confinement bug through as a passing cell.
        const under = held.models.filter((p) => p.startsWith(`${body.path}/`))
        const spell = held.spellAs
        const models = under.slice(0, body.limit).map((p) => ({
          path:
            spell !== undefined && p.startsWith(spell.from)
              ? spell.to + p.slice(spell.from.length)
              : p,
          pose: (stub.badPosed ?? []).includes(p)
            ? stub.badPose
            : (held.posed ?? []).includes(p)
              ? POSE
              : null,
        }))
        return new Response(
          JSON.stringify({
            status: 'ok',
            models,
            matched: under.length,
            truncated: under.length > body.limit,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      if (String(url).endsWith('/poses') && init?.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { paths: string[] }
        // Pushed before any refusal, so `sent` is every chunk *attempted* — the
        // number the per-chunk cells assert, and the one a batch that gave up
        // after its first failure would get wrong.
        sent.push(body)
        if (stub.posesHangs === true) return hang(init.signal)
        if (stub.posesMalformed === true) return malformedBody()
        if (stub.posesNull === true) return nullBody()
        if (stub.posesBodyStalls === true) return stalledBody(init.signal)
        if ((stub.posesFailAt ?? []).includes(sent.length - 1)) {
          return new Response(JSON.stringify({ detail: 'this chunk is not for you' }), {
            status: 500,
          })
        }
        if (stub.posesStatus !== undefined && stub.posesStatus !== 200) {
          return new Response(JSON.stringify({ detail: 'no' }), { status: stub.posesStatus })
        }
        const poses: Record<string, unknown> = {}
        for (const p of body.paths) {
          poses[p] = (stub.badPosed ?? []).includes(p)
            ? stub.badPose
            : (stub.posed ?? []).includes(p)
              ? POSE
              : null
        }
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

/** The paths form of the same supply: the entries a listing landed, by name. */
const posesFor = async (
  paths: readonly string[],
): Promise<Record<string, IndexPose>> => {
  const res = await app.request('/api/semantic/poses', {
    method: 'POST',
    headers: { ...LOOPBACK, 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { poses: Record<string, IndexPose> }).poses
}

/** The same POST, with whatever body a cell wants to send. */
const postPoses = async (body: unknown): Promise<Response> =>
  app.request('/api/semantic/poses', {
    method: 'POST',
    headers: { ...LOOPBACK, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

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

describe('a pose is validated where it enters, not trusted because it is typed', () => {
  const BAD: [string, unknown][] = [
    ['a bare string', 'up is that way'],
    ['an `up` of the wrong arity', { ...POSE, up: [0, 1] }],
    ['an `up` whose members are not numbers', { ...POSE, up: ['0', '1', '0'] }],
    ['a missing `azimuth_zero`', { ...POSE, azimuth_zero: undefined }],
    ['a `front` that is not the shape it claims', { ...POSE, front: { view: 5 } }],
    ['null-adjacent: a number', 7],
  ]

  for (const [label, badPose] of BAD) {
    it(`${label}: dropped, and the listing still answers`, async () => {
      stubIndex({ badPosed: [fs('mixed', 'c.stl')], badPose })
      expect(await posesOf('/mixed')).toEqual({})
    })
  }

  it('the control: the same route, the same fixture, a pose that is one', async () => {
    // Without this every cell above would pass on a route that answered `{}`
    // for everything.
    stubIndex({ posed: [fs('mixed', 'c.stl')] })
    expect(await posesOf('/mixed')).toEqual({ '/mixed/c.stl': POSE })
  })

  it('a `front` that is absent is still a pose — the client reads it through `?.`', async () => {
    // The one shape the wire may legitimately shorten: `client/src/three/pose.ts`
    // reads `pose.front?.azimuth_deg ?? 0`, so an orientation with no front view
    // is usable and must not be thrown away with the malformed ones.
    const noFront = { ...POSE, front: null }
    stubIndex({ badPosed: [fs('mixed', 'c.stl')], badPose: noFront })
    expect(await posesOf('/mixed')).toEqual({ '/mixed/c.stl': noFront })
  })

  it('one bad pose costs only itself', async () => {
    stubIndex({
      posed: [fs('mixed', 'e.stl')],
      badPosed: [fs('mixed', 'c.stl')],
      badPose: 'nope',
    })
    expect(await posesOf('/mixed')).toEqual({ '/mixed/e.stl': POSE })
  })
})

describe('a batch splits into chunks, and a chunk that fails costs only its own', () => {
  /** Every model in `/bulk`, by library path: one more than fits in a chunk. */
  const bulkPaths = BULK.map((n) => `/bulk/${n}`)

  it('keeps the chunks that answered when one of them fails', async () => {
    // The client's rule (`pose-for-every-model` §5.4 finding 4) on this side of
    // the wire. All-or-nothing here means one 500 on the second chunk discards
    // the 1024 poses the first chunk already answered with — every tile in the
    // folder un-posed because of the models it does *not* show.
    stubIndex({ posed: [fs('bulk', BULK[0]!), fs('bulk', BULK[POSES_MAX]!)], posesFailAt: [1] })
    const poses = await posesForPaths(library, bulkPaths, libTop)
    // The surviving chunk's pose is there; the failed chunk's is simply absent,
    // which is indistinguishable from "no orientation" and is what the next
    // wave re-asks about.
    expect(Object.keys(poses)).toEqual(['/bulk/b0000.stl'])
    expect(sent).toHaveLength(2)
    expect(sent[0]!.paths).toHaveLength(POSES_MAX)
    expect(sent[1]!.paths).toHaveLength(1)
  })

  it('every chunk failing is an empty answer, with every chunk still attempted', async () => {
    // A failure stops that chunk, not the batch: giving up on the first would
    // leave the second's models unasked *and* look identical in the answer, so
    // the attempt count is the assertion that separates them.
    stubIndex({ posed: [fs('bulk', BULK[0]!)], posesFailAt: [0, 1] })
    expect(await posesForPaths(library, bulkPaths, libTop)).toEqual({})
    expect(sent).toHaveLength(2)
  })

  it('the control: nothing failing answers from both chunks', async () => {
    stubIndex({ posed: [fs('bulk', BULK[0]!), fs('bulk', BULK[POSES_MAX]!)] })
    const poses = await posesForPaths(library, bulkPaths, libTop)
    expect(Object.keys(poses).sort()).toEqual(['/bulk/b0000.stl', '/bulk/b1024.stl'])
    expect(sent).toHaveLength(2)
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

  it('a 200 of literal null is empty as well — parsing is not answering', async () => {
    // The body a parse guard cannot catch: `null` is valid JSON, so `res.json()`
    // resolves and the guard that catches a `SyntaxError` never fires. What
    // fires instead is the *next* read — `answer.poses` in `askPoses` — as a
    // `TypeError`, outside every `IndexError` catch in the module, which is a
    // 500 for a wave that may never be made to fail by the index.
    stubIndex({ posesNull: true, posed: [fs('mixed', 'c.stl')] })
    expect(await posesOf('/mixed')).toEqual({})
    expect(sent).toHaveLength(1)
    // The paths form takes the same route in and the same way out.
    stubIndex({ posesNull: true, posed: [fs('mixed', 'c.stl')] })
    expect(await posesFor(['/mixed/c.stl', '/mixed/a.stl'])).toEqual({})
  })

  it('a /status of literal null is an index that has not said what it is', async () => {
    // The probe reads its body outside `askIndex` and so needs the same guard of
    // its own: `raw.collection_root` is the first read, and on `null` it throws
    // past the catch that classifies a refusal. Every state below it — the
    // volume check, `ready`, the wedged arithmetic — is unreachable, so a peek
    // and a wave both died on the probe rather than on the call they wanted.
    stubIndex({ statusNull: true })
    const res = await app.request('/api/semantic/status', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'absent' })
    // …and the routes that ride behind it answer, rather than 500.
    expect(await posesOf('/mixed')).toEqual({})
    expect(names(await peekOf('/mixed', 4))).toEqual(['a.stl', 'b.stl', 'c.stl', 'd.stl'])
    expect(sent).toHaveLength(0)
    expect(asked).toHaveLength(0)
  })

  it('a 200 whose body never lands is empty as well, and still a 200', async () => {
    // The failures that happen *after* `fetch` resolved: a body that does not
    // parse, and one whose read is aborted by the request's own timeout with
    // the headers long since in. Neither is a `TypeError` from the network, so
    // before the body read moved inside a `try` they came out of `askIndex` as
    // a bare `SyntaxError`/`AbortError` — past the `IndexError` catch that is
    // the whole of "a pose never fails a listing", and a 500 for the wave.
    for (const stub of [{ posesMalformed: true }, { posesBodyStalls: true }]) {
      stubIndex({ ...stub, posed: [fs('mixed', 'c.stl')] })
      expect(await posesOf('/mixed')).toEqual({})
      expect(sent).toHaveLength(1)
      // The paths form takes the same route in, so it takes the same way out.
      stubIndex({ ...stub, posed: [fs('mixed', 'c.stl')] })
      expect(await posesFor(['/mixed/c.stl', '/mixed/a.stl'])).toEqual({})
    }
  }, 20_000)
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
   *
   * **Two requirements meet here, and the strip below is the seam between
   * them.** `directory-browsing`'s *Folder tiles preview their contents* is
   * about what is **chosen**: with the index silent the models "SHALL be chosen
   * entirely by a bounded, deterministic walk", and its Determinism scenario
   * asks for "the same models … in the same order". That is what these cells
   * pin, and this change does not touch it. `listing-cache`'s *Derived
   * annotations ride the listing* then attaches additive fields to those entries
   * from what this server's own caches already hold — expressly including while
   * the index is down: "listings emit at full speed, carrying whatever
   * annotations the layers already held and omitting the rest". An earlier cell
   * in this file asks `/api/semantic/poses` about `/mixed`, and this file's `app`
   * is one server for the whole run, so by the time these cells arrive the pose
   * layer legitimately holds `/mixed/c.stl` and the sheet carries it.
   *
   * So exactly those three fields are removed before comparing, and nothing
   * else is. A change to any entry's name, path, kind, size, mtime, format or
   * order — an entry more, an entry fewer, or a fourth annotation nobody
   * declared — still fails, which is the whole of what the archived requirement
   * asks these cells to defend.
   */
  const ANNOTATIONS = ['thumb', 'pose', 'preview'] as const
  const identical = async (path: string, n: number): Promise<void> => {
    const before = JSON.stringify(await peek(library, path, n))
    const res = await app.request(`/api/peek?path=${encodeURIComponent(path)}&n=${n}`, {
      headers: LOOPBACK,
    })
    expect(res.status).toBe(200)
    const got = (await res.json()) as Record<string, unknown>[]
    // Deleting a key leaves the rest in insertion order, so the serialisation
    // below still compares key order — which is the point of stringifying.
    for (const entry of got) for (const field of ANNOTATIONS) delete entry[field]
    expect(JSON.stringify(got)).toBe(before)
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


describe('the sheet asks the index before it walks', () => {
  /**
   * The walk path spelled out, as `posedFirstPeek`'s body spelled it before D5:
   * walk to the entry bound, one `/poses` batch over the finds, stable
   * posed-first partition, cut to `n`. The same idiom as `identical` above —
   * which compares against `peek()`, the body one change earlier — and it exists
   * for the same reason: "byte-identical to the fallback" has to be measured
   * against the fallback rather than against entries typed out here.
   */
  const walkSheet = async (path: string, n: number): Promise<DirEntry[]> => {
    const finds = await peek(library, path, PEEK_MAX_FINDS)
    if (finds.length === 0) return finds
    const poses = await posesForPaths(
      library,
      finds.map((e) => e.path),
      libTop,
    )
    return [
      ...finds.filter((e) => poses[e.path] !== undefined),
      ...finds.filter((e) => poses[e.path] === undefined),
    ].slice(0, n)
  }

  const kit = (n: string) => fs('lich', '02-kit', n)

  it('reaches the kit the walk’s budget can never get to', async () => {
    // The control, and the whole reason this section exists: `/lich`'s first
    // subtree is eighty entries of nothing, so the walk spends its budget there
    // and comes back with an empty sheet. Every folder-of-folders tile Masa
    // found under-used posed models this way.
    stubIndex({})
    expect(await peek(library, '/lich', 4)).toEqual([])

    stubIndex({
      under: {
        models: LICH_KIT.map(kit),
        posed: [kit('hero.stl'), kit('minion.stl')],
      },
    })
    const sheet = await peekOf('/lich', 4)
    // Posed first in the index's own order, then its unposed ones — models the
    // walk could not have reached at all.
    expect(names(sheet)).toEqual(['hero.stl', 'minion.stl', 'guard.stl', 'scout.stl'])
    // Addressed and shaped like any other listing entry, stat'd here rather than
    // described by the index: the sheet's cells are indistinguishable from the
    // walk's.
    expect(sheet[0]!.path).toBe('/lich/02-kit/hero.stl')
    expect(Object.keys(sheet[0]!).sort()).toEqual([
      'format',
      'kind',
      'mtime',
      'name',
      'path',
      'size',
    ])
    expect(sheet[0]!.mtime).toBeGreaterThan(0)
    // A full sheet from the index means no walk at all, so no `/poses` batch.
    expect(sent).toHaveLength(0)
  })

  it('asks about the folder by its real path, and for one answer’s worth', async () => {
    stubIndex({ under: { models: [fs('mixed', 'c.stl')], posed: [fs('mixed', 'c.stl')] } })
    await peekOf('/mixed', 4)
    expect(asked).toEqual([{ path: fs('mixed'), limit: UNDER_LIMIT }])
  })

  it('an unindexed answer is the walk’s own sheet, byte for byte', async () => {
    // The fallback the requirement pins: `"unindexed"` is not "no poses", it is
    // "walk", and what the walk then produces must be what it produced before
    // the index was ever asked — ranking and all.
    stubIndex({ posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
    const before = JSON.stringify(await walkSheet('/mixed', 4))
    expect(JSON.stringify(await peekOf('/mixed', 4))).toBe(before)
    // And the branch really was taken: an `"unindexed"` answer came back, and
    // the walk happened after it rather than instead of it.
    expect(asked).toHaveLength(1)
    expect(names(await peekOf('/mixed', 4))).toEqual(['c.stl', 'e.stl', 'a.stl', 'b.stl'])
  })

  it('an index refusal and a 503 fall back the same way', async () => {
    for (const underStatus of [400, 503]) {
      stubIndex({ underStatus, posed: [fs('mixed', 'c.stl')] })
      expect(names(await peekOf('/mixed', 4))).toEqual(['c.stl', 'a.stl', 'b.stl', 'd.stl'])
      expect(asked).toHaveLength(1)
    }
  })

  it('fills a short answer from the walk, without repeating what it already has', async () => {
    // Two models under a folder holding six. `f.stl` is posed and `a.stl` is
    // not, so the index half is [f, a] — and `a.stl` is also the walk's first
    // find, which is what makes the dedup observable rather than incidental.
    stubIndex({
      under: { models: [fs('mixed', 'a.stl'), fs('mixed', 'f.stl')], posed: [fs('mixed', 'f.stl')] },
      posed: [],
    })
    expect(names(await peekOf('/mixed', 4))).toEqual(['f.stl', 'a.stl', 'b.stl', 'c.stl'])
    // The walk really did run — a short answer costs the peek its walk, which is
    // the price D5 accepts for never showing a two-cell sheet over a full folder.
    expect(sent).toHaveLength(1)
  })

  it('an "ok" answer holding nothing is the walk’s sheet too', async () => {
    // Not the same fact as `"unindexed"` upstream, and deliberately the same
    // answer here: an empty list fills from the walk by the same arithmetic a
    // short one does.
    stubIndex({ under: { models: [] }, posed: [fs('mixed', 'e.stl')] })
    expect(names(await peekOf('/mixed', 4))).toEqual(['e.stl', 'a.stl', 'b.stl', 'c.stl'])
    expect(asked).toHaveLength(1)
  })

  it('a chosen model that is no longer there gives its cell to the next candidate', async () => {
    // The index embedded it and the file has since gone — an ordinary outcome
    // for two independently-cached views of one removable volume, not an error.
    //
    // Asserted over `/lich`, whose walk finds nothing at all, precisely so the
    // fill cannot stand in for the recovery: a peek that stat'd the first four
    // candidates and kept what survived would come back with three cells and
    // have nowhere to get a fourth.
    const ghost = kit('ghost.stl')
    stubIndex({
      under: { models: [ghost, ...LICH_KIT.map(kit)], posed: [ghost, ...LICH_KIT.map(kit)] },
    })
    expect(names(await peekOf('/lich', 4))).toEqual([
      'guard.stl',
      'hero.stl',
      'minion.stl',
      'scout.stl',
    ])
    // Four cells from the index, so nothing walked and nothing was asked about
    // poses — the drop cost a candidate, not a round trip.
    expect(sent).toHaveLength(0)
  })

  it('never previews a model that leaves the library, whatever the index says', async () => {
    // `escape.stl` is a symlink out of the library. The index followed it when
    // it embedded, and it still must not reach a surface `/api/file` refuses the
    // same path on — dropped, and its cell goes to the walk's fill.
    const escape = fs('links', 'escape.stl')
    stubIndex({
      under: { models: [escape, fs('links', 'real.stl')], posed: [escape, fs('links', 'real.stl')] },
      posed: [],
    })
    const sheet = await peekOf('/links', 4)
    expect(sheet.map((e) => e.path)).toEqual(['/links/real.stl', '/links/alias.stl'])
    expect(names(sheet)).not.toContain('secret.stl')
  })

  it('a directory outside the library lends its inside to nothing', async () => {
    // Candidates are confined against the peeked directory and nothing else,
    // which is only safe because that directory is inside the library by
    // construction (`scopeWithin`, over a root `mapCollectionRoot` already
    // proved the library holds). The premise is checked rather than assumed,
    // and here is where it is observable: no route can hand `entriesUnder` such
    // a directory, so the boundary itself is what has to hold the line.
    // Both halves empty: no cell, and — since `listing-tree-cache` §6.9 made
    // this routine hand back what `/under` told it about poses — nothing for a
    // caller to record either. A pose keyed by a library path this directory
    // could not lend is the same escape as an entry named on the sheet.
    expect(
      await entriesUnder(
        library,
        [{ path: join(outsideFs, 'secret.stl'), pose: POSE }],
        outsideFs,
        '/links',
        4,
      ),
    ).toEqual({ entries: [], poses: {} })
  })

  it('takes the index’s answer in whatever spelling the index walked in', async () => {
    // The divergence a lexical prefix test cannot survive: the classify run was
    // invoked through `aka/lich`, so it answers about `aka/lich/02-kit/…` for a
    // folder this server asked about as `lich/`. Same files, same inodes, two
    // spellings — and confined on the realpath, so the sheet fills exactly as it
    // does when the two agree.
    stubIndex({
      under: {
        models: LICH_KIT.map(kit),
        posed: [kit('hero.stl'), kit('minion.stl')],
        spellAs: { from: fs('lich'), to: fs('aka', 'lich') },
      },
    })
    const sheet = await peekOf('/lich', 4)
    expect(names(sheet)).toEqual(['hero.stl', 'minion.stl', 'guard.stl', 'scout.stl'])
    // Addressed by the spelling the *tile* was addressed by, never the index's:
    // the alias is the index's business and `/aka/lich/…` is not what the client
    // asked about. `/lich` walks up empty, so every cell here came from the
    // index — a lexical test would leave the sheet empty rather than wrong.
    expect(sheet.map((e) => e.path)).toEqual([
      '/lich/02-kit/hero.stl',
      '/lich/02-kit/minion.stl',
      '/lich/02-kit/guard.stl',
      '/lich/02-kit/scout.stl',
    ])
    expect(sent).toHaveLength(0)
  })

  it('a 200 the index cannot finish saying falls back to the walk', async () => {
    // Two ways an answer that *arrived* still is not one: a body that does not
    // parse, and a body that never lands until the request's own timeout aborts
    // the read. Both fail after `fetch` resolved — outside the try that catches
    // a refusal — and neither is an `IndexError`, so before the body read moved
    // inside the try they escaped `modelsUnder` and 500'd the peek. A peek may
    // not fail because the index did: silence, of any kind, is the walk.
    for (const stub of [{ underMalformed: true }, { underBodyStalls: true }]) {
      stubIndex({ ...stub, posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
      expect(names(await peekOf('/mixed', 4))).toEqual(['c.stl', 'e.stl', 'a.stl', 'b.stl'])
      expect(asked).toHaveLength(1)
    }
  }, 15_000)

  it('a 200 of literal null falls back to the walk too', async () => {
    // `malformedBody` fails in the parse and is already covered; this one
    // *parses*. `raw.status` on `null` is a `TypeError` thrown past the
    // `IndexError` catch in `modelsUnder`, so the peek 500'd on a body the
    // index could perfectly well send.
    stubIndex({ underNull: true, posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
    expect(names(await peekOf('/mixed', 4))).toEqual(['c.stl', 'e.stl', 'a.stl', 'b.stl'])
    // The branch really was taken: `/under` was asked, and the walk ran after it.
    expect(asked).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('an "ok" answer whose models is not a list reads as an empty one', async () => {
    // The next layer in from literal `null`: an object body whose *field*
    // holds the wrong type. `raw.models` of `5` made `flatMap` a `TypeError`
    // thrown past the `IndexError` catch, so the peek 500'd on a body that
    // parsed and even said `"ok"`. Now it lands as the empty ok answer — the
    // walk's sheet, by the same arithmetic a short answer fills by.
    stubIndex({ underBody: { status: 'ok', models: 5 }, posed: [fs('mixed', 'e.stl')] })
    expect(names(await peekOf('/mixed', 4))).toEqual(['e.stl', 'a.stl', 'b.stl', 'c.stl'])
    expect(asked).toHaveLength(1)
  })

  it('a garbage element inside a real models list is dropped, not a crash', async () => {
    // Elements are the layer after the list: `m.path` on a `null` element is
    // the same `TypeError` one layer down. A model that is not an object
    // naming a string path has no cell; the real one beside it keeps its own,
    // and the walk fills the rest.
    stubIndex({
      underBody: {
        status: 'ok',
        models: [null, 'a.stl', { path: 5 }, { path: fs('mixed', 'f.stl'), pose: null }],
      },
      posed: [],
    })
    expect(names(await peekOf('/mixed', 4))).toEqual(['f.stl', 'a.stl', 'b.stl', 'c.stl'])
  })

  it('a pose the index sent that is not a pose is no pose, never an error', async () => {
    // `/under`'s poses cross straight to `entriesUnder`'s partition and, for a
    // hit, straight to the client — which reads `up` positionally
    // (`client/src/three/pose.ts`). A model carrying one is still a model: it
    // sorts into the *unposed* half rather than being dropped, so the sheet
    // still fills.
    for (const badPose of ['tilted-a-bit', { ...POSE, up: [0, 1] }]) {
      stubIndex({
        under: { models: LICH_KIT.map(kit), posed: [kit('hero.stl')] },
        badPosed: [kit('hero.stl')],
        badPose,
      })
      // `/lich` walks up empty, so every cell here came from the index — and
      // `hero` has fallen out of the posed half to the back of walk order.
      expect(names(await peekOf('/lich', 4))).toEqual([
        'guard.stl',
        'hero.stl',
        'minion.stl',
        'scout.stl',
      ])
    }
    // The control, same fixture and a *well-formed* pose: `hero` leads. Without
    // it a peek that ignored poses entirely would pass the loop above.
    stubIndex({ under: { models: LICH_KIT.map(kit), posed: [kit('hero.stl')] } })
    expect(names(await peekOf('/lich', 4))[0]).toBe('hero.stl')
  })

  it('a stalling /under does not hold the sheet', async () => {
    // The `/poses` stall cell's shape, one call earlier: `/under` is advisory and
    // is given that call's budget, so a tile falls back to the walk rather than
    // waiting the half-minute a scoring query is allowed.
    stubIndex({ underHangs: true, posed: [fs('mixed', 'c.stl'), fs('mixed', 'e.stl')] })
    const started = Date.now()
    expect(names(await peekOf('/mixed', 4))).toEqual(['c.stl', 'e.stl', 'a.stl', 'b.stl'])
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(asked).toHaveLength(1)
  }, 15_000)

  it('an index that is not answering is never asked at all', async () => {
    // The two gates come before `/under` as well as before the walk: an index
    // with nothing to say about the folder costs the peek not one request.
    for (const stub of [
      { status: 'refused' as const },
      { status: { ...READY, ready: false, elapsed: 3 } },
      { status: { ...READY, collection_root: join(libTop, 'nest') } },
    ]) {
      stubIndex(stub)
      await peekOf('/mixed', 4)
      expect(asked).toHaveLength(0)
      expect(sent).toHaveLength(0)
    }
  })
})

describe('what the probe cache remembers is what was last asked', () => {
  it('a fresh look is not overwritten by the stale one it raced', async () => {
    // The confirmed race: a memoised probe is slow and says `warming`, the
    // client's explicit retry overtakes it and says `ready`, and then the slow
    // one settles. Written in settle order, the cache would hold `warming` — the
    // user pressed retry, the index said it was up, and the next tile was told
    // it was still loading, for the whole of the warming TTL.
    stubIndex({
      statusSeries: [
        { body: { ...READY, ready: false, elapsed: 3 }, delayMs: 80 },
        { body: READY, delayMs: 0 },
      ],
    })
    const slow = probeStatus(library)
    expect((await probeStatus(library, { fresh: true })).status.state).toBe('ready')
    expect((await slow).status.state).toBe('warming')
    // The stale answer was returned to whoever awaited it and not remembered:
    // the next read is served from the cache, and the cache says `ready`.
    expect((await probeStatus(library)).status.state).toBe('ready')
    expect(statusAsks).toBe(2)
  })

  it('two retries at once: the later look wins, not the later answer', async () => {
    // The other side of the same rule, and the one no memo is involved in: two
    // explicit retries overlap, because `fresh` deliberately never joins a probe
    // already on the wire. The second bump discards the first look's write, so
    // what the cache ends up holding is the answer to the question asked *last*
    // — which is the whole meaning of pressing retry twice. Settle order would
    // give the opposite: the slow first look lands afterwards and the user is
    // told `warming` by the retry they made after being told `ready`.
    stubIndex({
      statusSeries: [
        { body: { ...READY, ready: false, elapsed: 3 }, delayMs: 80 },
        { body: READY, delayMs: 0 },
      ],
    })
    const first = probeStatus(library, { fresh: true })
    const second = probeStatus(library, { fresh: true })
    expect((await second).status.state).toBe('ready')
    // The slow one really did answer, and really did answer differently.
    expect((await first).status.state).toBe('warming')
    expect((await probeStatus(library)).status.state).toBe('ready')
    // Served from the cache: two looks, and the third read paid for none.
    expect(statusAsks).toBe(2)
  })

  it('a probe started before a reset does not land its answer after it', async () => {
    // `resetIndexStatus` drops the memo so the next caller looks again — but the
    // probe it referred to is still running, and its pre-reset answer would
    // otherwise be written into the cache the reset just emptied, standing for a
    // 30 s TTL.
    stubIndex({ statusSeries: [{ body: READY, delayMs: 80 }] })
    const inFlight = probeStatus(library)
    resetIndexStatus()
    expect((await inFlight).status.state).toBe('ready')
    await probeStatus(library)
    expect(statusAsks).toBe(2)
  })
})

describe('the paths route, for the listings a directory cannot name', () => {
  it('answers the entries it was given, wherever in the library they live', async () => {
    // The flat and name-search case: models drawn from three folders at once.
    // `?path=<dir>` could answer for at most one of them, which is the whole
    // reason this form exists.
    stubIndex({ posed: [fs('mixed', 'c.stl'), fs('nest', 'sub', 'q.stl'), fs('only', 'one.stl')] })
    expect(
      await posesFor(['/mixed/c.stl', '/mixed/a.stl', '/nest/sub/q.stl', '/only/one.stl']),
    ).toEqual({
      '/mixed/c.stl': POSE,
      '/nest/sub/q.stl': POSE,
      '/only/one.stl': POSE,
    })
    // One request, carrying exactly the real paths of what was asked about —
    // no directory was listed and no tree was walked to answer it.
    expect(sent).toHaveLength(1)
    expect(sent[0]!.paths).toEqual([
      fs('mixed', 'c.stl'),
      fs('mixed', 'a.stl'),
      fs('nest', 'sub', 'q.stl'),
      fs('only', 'one.stl'),
    ])
  })

  it('canonicalises every path, like the GET canonicalises its one', async () => {
    stubIndex({ posed: [fs('mixed', 'c.stl')] })
    expect(await posesFor(['//mixed/./c.stl'])).toEqual({ '/mixed/c.stl': POSE })
  })

  it('drops what the library refuses instead of failing the whole answer', async () => {
    // A stale tile, a model outside the library, a path inside an archive: each
    // is silent on its own, and the good entries beside them still get poses.
    stubIndex({ posed: [fs('mixed', 'c.stl'), join(outsideFs, 'secret.stl')] })
    expect(
      await posesFor(['/gone.stl', '/links/escape.stl', '/mix2/kit.zip!/box.stl', '/mixed/c.stl']),
    ).toEqual({ '/mixed/c.stl': POSE })
    expect(sent[0]!.paths).toEqual([fs('mixed', 'c.stl')])
  })

  it('drops a path that is not spelled like one, rather than failing the batch', async () => {
    // A path with no leading slash and one past the length bound are the two
    // ways `canonicalLibPath` refuses a string outright. Canonicalised in one
    // expression, either threw out of the map and 400'd the whole request — so
    // one stale tile cost every other tile on screen its pose. Each is a
    // per-path refusal like any other on this route: dropped, silently.
    stubIndex({ posed: [fs('mixed', 'c.stl')] })
    const overLong = `/${'a'.repeat(5000)}.stl`
    expect(await posesFor(['mixed/c.stl', '/mixed/c.stl', overLong])).toEqual({
      '/mixed/c.stl': POSE,
    })
    expect(sent[0]!.paths).toEqual([fs('mixed', 'c.stl')])
  })

  it('requires an array of strings, and says so in the shape every field does', async () => {
    stubIndex({})
    for (const body of [{}, { paths: '/mixed/a.stl' }, { paths: ['/mixed/a.stl', 7] }, []]) {
      const res = await postPoses(body)
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400])
      expect(await res.json()).toEqual({ error: 'paths is required' })
    }
    expect(sent).toHaveLength(0)
  })

  it('refuses more than one upstream call’s worth, and takes exactly that many', async () => {
    stubIndex({})
    const one = Array.from({ length: POSES_MAX }, () => '/mixed/a.stl')
    // At the bound: taken, and it is one request out for one request in.
    expect(await posesFor(one)).toEqual({})
    expect(sent).toHaveLength(1)
    expect(sent[0]!.paths).toHaveLength(1) // one real path, named 1024 times

    const res = await postPoses({ paths: [...one, '/mixed/b.stl'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: `invalid paths: ${POSES_MAX + 1} (max ${POSES_MAX})`,
    })
    expect(sent).toHaveLength(1) // nothing asked upstream for the refused one
  })

  it('an index that cannot answer costs it nothing either', async () => {
    for (const stub of [
      { status: 'refused' as const },
      { status: { ...READY, ready: false, elapsed: 3 } },
      { status: { ...READY, collection_root: join(libTop, 'nest') } },
    ]) {
      stubIndex(stub)
      expect(await posesFor(['/mixed/c.stl'])).toEqual({})
      expect(sent).toHaveLength(0)
    }
  })

  it('is the same path route the GET is: the not-ready state envelope', async () => {
    stubIndex({})
    const home = realTempDir('mb-poses-post-unconfigured-')
    const cache = realTempDir('mb-poses-post-unconfigured-cache-')
    const bare = createApp(
      new ThumbCache(cache),
      undefined,
      undefined,
      createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') }),
    )
    const res = await bare.request('/api/semantic/poses', {
      method: 'POST',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['/mixed/a.stl'] }),
    })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'no library root is configured',
      state: 'unconfigured',
    })
    rmSync(home, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  })
})

describe('an index with nothing to say about the folder costs the peek nothing', () => {
  /**
   * The answers alone cannot say this. Every state below previews the same
   * models — an uncovered folder because coverage fails per path, a silent one
   * because there are no poses to rank by — so a peek that walked the whole
   * entry bound and then threw the extra finds away would look identical from
   * the outside. What separates them is the walk: a sheet of four is satisfied
   * by `/cover`'s own level, so the narrow walk reads one directory while the
   * walk-to-the-bound reads all four, and pays a `realpath` per find it will be
   * told nothing about.
   *
   * Measured against a control run of `peek()` in the same cell rather than
   * against numbers written here, so the walk's own bookkeeping is free to
   * change without making these cells wrong.
   *
   * `/cover` and not `/mixed`: a flat directory reads once whatever the bound
   * is, and would report "the same width" for both walks.
   */
  const cases: [string, Stub][] = [
    ['absent — nobody started it', { status: 'refused' }],
    ['warming — SigLIP is still loading', { status: { ...READY, ready: false, elapsed: 3 } }],
    ['wedged — the load will not finish', { status: { ...READY, ready: false, elapsed: 400 } }],
    [
      'ready, but rooted somewhere this folder is not',
      { status: { ...READY, collection_root: join(libTop, 'nest') } },
    ],
  ]

  for (const [label, stub] of cases) {
    it(`${label}: walks no wider than it did before poses, and asks nothing`, async () => {
      stubIndex(stub)
      rd.readdir = 0
      rd.realpath = 0
      const control = await peek(library, '/cover', 4)
      const narrow = { readdir: rd.readdir, realpath: rd.realpath }

      rd.readdir = 0
      rd.realpath = 0
      const sheet = await peekOf('/cover', 4)

      // The width itself: one `readdir` per directory entered.
      expect(rd.readdir).toBe(narrow.readdir)
      // And the per-find cost a wide walk pays. What the route may spend on top
      // of the walk is asking *where the index is looking*, and all of it is
      // about the folder rather than about its contents: the probe's own
      // `realpath` of the collection root (`mapCollectionRoot`), and the three
      // `scopeWithin` makes for one path — resolving it through the library,
      // then resolving it and the collection root together.
      const ASKING = 4
      expect(rd.realpath).toBeLessThanOrEqual(narrow.realpath + ASKING)

      // The selection is still today's, byte for byte, and the index was never
      // asked about a single model.
      expect(JSON.stringify(sheet)).toBe(JSON.stringify(control))
      expect(sent).toHaveLength(0)
    })
  }
})

describe('a stalling index does not hold the sheet', () => {
  it(
    'gives up on /poses within its own budget and previews the walk’s own order',
    async () => {
      // Ready, covering, and then silent: the one state where the peek has
      // already committed to the wide walk and the batch is what does not come
      // back. `/poses` is advisory, so the budget is the probe's rather than
      // the query's — a folder tile may not wait half a minute for an answer
      // that is allowed to be empty.
      stubIndex({ posesHangs: true })
      const started = Date.now()
      expect(names(await peekOf('/mixed', 4))).toEqual(['a.stl', 'b.stl', 'c.stl', 'd.stl'])
      const waited = Date.now() - started
      expect(sent).toHaveLength(1)
      // Loose enough that a loaded machine cannot fail it, and far tighter than
      // the 30 s a scoring query is allowed — which is the whole assertion.
      expect(waited).toBeLessThan(10_000)

      // And the stall is not remembered as "ready": the timeout lands in
      // `askIndex`'s network catch, which forgets the status, so the next tile
      // probes again instead of trusting a 30 s TTL taken before the stall.
      const asked = statusAsks
      await probeStatus(library)
      expect(statusAsks).toBe(asked + 1)
    },
    15_000,
  )
})

describe('a screenful of tiles probes the index once', () => {
  it('shares the probe that is already on the wire', async () => {
    // Every folder tile reads the index's state before it decides how to walk,
    // and a grid brings them on screen together. The cache is only written when
    // a probe *resolves*, so without the in-flight memo each of these opens its
    // own connection to learn the one fact they are all waiting for.
    stubIndex({ statusDelayMs: 25 })
    const seen = await Promise.all(Array.from({ length: 6 }, () => probeStatus(library)))
    expect(statusAsks).toBe(1)
    // One probe, and every caller got its answer — not one answer and five
    // empty ones.
    expect(seen.map((s) => s.status.state)).toEqual(Array.from({ length: 6 }, () => 'ready'))
    expect(seen.every((s) => s.collectionRootFs === libTop)).toBe(true)
  })

  it('the memo is the request’s, not a second cache: the TTL still decides', async () => {
    stubIndex({ statusDelayMs: 25 })
    await Promise.all([probeStatus(library), probeStatus(library)])
    expect(statusAsks).toBe(1)
    // Settled, so the next caller reads the cache the probe wrote…
    await probeStatus(library)
    expect(statusAsks).toBe(1)
    // …and forgetting that cache really does mean the next one looks again.
    resetIndexStatus()
    await probeStatus(library)
    expect(statusAsks).toBe(2)
  })

  it('the explicit retry never joins it — that is the point of asking', async () => {
    // `fresh` is the client's "look again now". A probe already on the wire was
    // started before the user asked, so answering with it would answer the
    // question they did not ask.
    stubIndex({ statusDelayMs: 25 })
    await Promise.all([probeStatus(library), probeStatus(library, { fresh: true })])
    expect(statusAsks).toBe(2)
  })
})
