import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { LightingMode, OrbitAxis, ThumbPutRequest } from '../../shared/types'
import { ThumbCache } from './cache'
import { guard } from './guard'
import { ListingError, complete, listDir, listFlat } from './listing'
import {
  IndexError,
  hitsToEntries,
  indexStatus,
  modelEntryAt,
  query as indexQuery,
  scopeWithin,
  similar as indexSimilar,
} from './semantic'
import { VPathError, parseVPath } from './vpath'
import { ZipError, extractEntry } from './zip'

const ORBIT_AXES: readonly OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']
const LIGHTING_MODES: readonly LightingMode[] = ['axis', 'camera']

/**
 * How an `IndexError` reaches the client — one mapping, shared by both scoring
 * routes, because the same upstream status means the same thing whichever route
 * met it.
 *
 * - **No `upstreamStatus`** — the index never answered. That is availability,
 *   and it keeps the 503 envelope the UI renders, state and all. Not a 500:
 *   "the index is not there" is a state, and the state itself is what tells the
 *   user which thing to do about it.
 * - **404** — the index answered, about the thing that was named: this model
 *   has no embedding. The UI owns a distinct sentence for it ("not indexed yet
 *   — run the classifier"), so it travels as the status rather than as text to
 *   sniff. Unambiguous because the one *other* reason a model can be
 *   unembeddable — living inside an archive — never reaches this server: the
 *   command is not offered on archive entries (D6) and the client refuses a
 *   `!/` subject without asking.
 * - **any other 4xx** — the index answered and refused (a virtual path, a name
 *   matching more than one model). A refusal, reported as the refusal in the
 *   index's own words. A 503 carrying `state: 'ready'` would contradict itself
 *   and tell the client to re-probe availability over a request it should have
 *   fixed.
 * - **5xx** — the index failed on its own side: a bad gateway, not an absent
 *   service.
 */
function indexErrorReply(err: IndexError): {
  body: { error: string; state?: string }
  status: 400 | 404 | 502 | 503
} {
  if (err.upstreamStatus === undefined) {
    return { body: { error: err.message, state: err.state }, status: 503 }
  }
  if (err.upstreamStatus === 404) return { body: { error: err.message }, status: 404 }
  const bad = err.upstreamStatus >= 400 && err.upstreamStatus < 500
  return { body: { error: err.message }, status: bad ? 400 : 502 }
}

export function createApp(cache: ThumbCache = new ThumbCache()): Hono {
  const app = new Hono()

  app.use('/api/*', guard)

  app.onError((err, c) => {
    if (err instanceof ListingError) return c.json({ error: err.message }, err.status === 404 ? 404 : 400)
    if (err instanceof VPathError) return c.json({ error: err.message }, 400)
    if (err instanceof ZipError) return c.json({ error: err.message }, 422)
    return c.json({ error: err.message }, 500)
  })

  app.get('/api/dir', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const flat = c.req.query('flat') === 'true'
    const q = c.req.query('q')
    const blankQ = q === undefined || q.trim() === ''
    if (!blankQ && !flat) return c.json({ error: 'q requires flat=true' }, 400)
    // Additive and default-on: absent means the shipped predicate.
    const folderMatching = c.req.query('folders') !== 'false'
    if (flat) return c.json(await listFlat(path, q, { folderMatching }))
    return c.json(await listDir(path))
  })

  app.get('/api/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const { fsPath, entry } = parseVPath(path)
    if (!isAbsolute(fsPath)) return c.json({ error: 'path must be absolute' }, 400)

    // octet-stream + nosniff make ORB dependably block no-cors embeds, which
    // carry no Origin and so pass the guard's origin check.
    const headers = {
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    }
    if (entry !== undefined) {
      if (/\.zip$/i.test(entry)) return c.json({ error: 'nested zips are unsupported' }, 400)
      const bytes = await extractEntry(fsPath, entry)
      return c.body(new Uint8Array(bytes), 200, headers)
    }
    const s = await stat(fsPath).catch(() => null)
    if (s === null || !s.isFile()) return c.json({ error: `no such file: ${fsPath}` }, 404)
    const stream = Readable.toWeb(createReadStream(fsPath)) as ReadableStream
    return c.body(stream, 200, { ...headers, 'content-length': String(s.size) })
  })

  /**
   * Availability of the semantic index. Cached per state by `indexStatus`, so
   * this is cheap enough for the client to re-read on the interactions it
   * already makes; `fresh=true` is the explicit retry (D4).
   */
  app.get('/api/semantic/status', async (c) => {
    const s = await indexStatus({ fresh: c.req.query('fresh') === 'true' })
    return c.json(s)
  })

  /**
   * A meaning query. Deliberately not folded into `/api/dir`: it consults a
   * different corpus, and its failure modes are its own — an index that is not
   * running is a state this app reports, not an error it raises (D1).
   */
  app.post('/api/semantic', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | {
          text?: string
          path?: string
          raw?: boolean
          pool?: 'mean' | 'max' | 'softmax'
          top?: number
          minScore?: number
        }
      | null
    const text = body?.text
    if (typeof text !== 'string' || text.trim() === '') {
      return c.json({ error: 'text is required' }, 400)
    }
    const status = await indexStatus()
    if (status.state !== 'ready' || status.collectionRoot === undefined) {
      // Not a 500: "the index is not there" is a state the UI renders, and the
      // state itself is what tells the user which thing to do about it.
      return c.json({ error: 'index unavailable', state: status.state, detail: status.detail }, 503)
    }
    // Virtual paths never leave this server (D7), and a scope outside the
    // collection is not the index's to answer.
    const scope =
      body?.path === undefined || body.path === ''
        ? null
        : await scopeWithin(body.path, status.collectionRoot)
    if (body?.path !== undefined && body.path !== '' && scope === null) {
      return c.json({ error: 'path is outside the indexed collection' }, 400)
    }
    let result
    try {
      result = await indexQuery(text, scope, {
        raw: body?.raw,
        pool: body?.pool,
        top: body?.top,
        minScore: body?.minScore,
      })
    } catch (err) {
      if (err instanceof IndexError) {
        const { body: reply, status } = indexErrorReply(err)
        return c.json(reply, status)
      }
      throw err
    }
    const { entries, poses } = await hitsToEntries(result.results, status.collectionRoot)
    return c.json({
      path: scope ?? status.collectionRoot,
      entries,
      poses,
      weak: result.weak,
      // The index's ceiling, not the ranking's horizon (D2): it returned fewer
      // than was asked for, and what was asked for is the user's control.
      capped: result.truncated === true,
      scope: {
        path: result.scope.path,
        status: result.scope.status,
        indexed: result.scope.n_indexed,
        scanned: result.scope.n_scanned,
        covers: result.scope.covers,
      },
    })
  })

  /**
   * A model's nearest neighbours. Beside the meaning query rather than folded
   * into it: it asks a different question of the same service — a model instead
   * of a phrase — and its one distinctive failure (this model is not embedded)
   * is not a failure `/api/semantic` has.
   *
   * **No scope is sent** (D4/4.1a): neighbours come from the whole indexed
   * collection, which is the index's own default, so this states that default
   * rather than passing a value. The model's own path is still resolved through
   * `scopeWithin` first — not to be sent as a scope, but because a virtual path
   * must never leave this server (D7) and a path outside the collection is not
   * the index's to answer. The honest client never sends either: the command is
   * absent on archive entries and outside the collection (D6). This is the
   * boundary refusing a hand-made request, and it is what keeps the 404 below
   * meaning exactly one thing.
   */
  app.post('/api/semantic/similar', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { path?: string; k?: number; pool?: string }
      | null
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return c.json({ error: 'path is required' }, 400)
    }
    // Validated, not defaulted: `k` is the client's deliberate choice (D4), and
    // silently substituting one here would mint a second default for a number
    // this server has no opinion about. Absent, the index's own applies.
    const k = body?.k
    if (k !== undefined && (!Number.isInteger(k) || k < 1 || k > 1000)) {
      return c.json({ error: `invalid k: ${String(k)}` }, 400)
    }
    // The same rule for the pooling, which is settable on screen now. Absent
    // still leaves the index's own — the value in force is whatever
    // `serve_api.py --pool` was started with — and only the three the index
    // names are forwarded, so a hand-made request cannot make it guess.
    const pool = body?.pool
    if (pool !== undefined && pool !== 'mean' && pool !== 'max' && pool !== 'softmax') {
      return c.json({ error: `invalid pool: ${String(pool)}` }, 400)
    }
    const status = await indexStatus()
    if (status.state !== 'ready' || status.collectionRoot === undefined) {
      return c.json({ error: 'index unavailable', state: status.state, detail: status.detail }, 503)
    }
    const model = await scopeWithin(path, status.collectionRoot)
    if (model === null) {
      return c.json({ error: 'path is outside the indexed collection' }, 400)
    }
    let result
    try {
      result = await indexSimilar(model, k, pool)
    } catch (err) {
      if (err instanceof IndexError) {
        const { body: reply, status: code } = indexErrorReply(err)
        return c.json(reply, code)
      }
      throw err
    }
    // The same hit→tile join a meaning answer takes: this server's own view of
    // the tree, stat'd once per returned hit, never the index's description of a
    // model (D3).
    const { entries, poses } = await hitsToEntries(result.results, status.collectionRoot)
    // The model the neighbours were computed *from*, resolved into a tile of its
    // own. The index excludes the query model from its own ranking by design (it
    // scores 1.0 against itself and skews the z), so if the question is to be
    // visible beside its answer, this app is the only place that can add it.
    //
    // Its own field, never prepended into `entries`: the entries are the answer
    // and the anchor is the question, and a client that counted it would say a
    // model with no neighbours had one.
    //
    // Named the way a hit is — relative to the collection — so the anchor tile
    // reads like the neighbours beside it rather than as an absolute path.
    // Omitted silently when it no longer stats: a model can be deleted after it
    // was embedded, and the neighbours are still a true answer without it.
    const anchor = await modelEntryAt(model, relative(status.collectionRoot, model))
    // Deliberately without the index's `scope` dict. A similarity view reads
    // none of the meaning residue — `weak`, `capped`, the scope's coverage
    // counts are all facts about a *phrase's* result — and forwarding it would
    // make the client's label read the view as a meaning search (4.7).
    return c.json({
      path: status.collectionRoot,
      entries,
      poses,
      ...(anchor !== null ? { anchor } : {}),
    })
  })

  app.get('/api/complete', async (c) => {
    const prefix = c.req.query('prefix') ?? ''
    return c.json(await complete(prefix))
  })

  app.get('/api/thumb', async (c) => {
    const path = c.req.query('path')
    const mtime = Number(c.req.query('mtime'))
    if (path === undefined || Number.isNaN(mtime)) {
      return c.json({ error: 'path and mtime are required' }, 400)
    }
    return c.json(await cache.get(path, mtime))
  })

  app.put('/api/thumb', async (c) => {
    const body = (await c.req.json()) as ThumbPutRequest
    if (typeof body.path !== 'string' || typeof body.mtime !== 'number') {
      return c.json({ error: 'path and mtime are required' }, 400)
    }
    // `null` is the discard, not a bad axis: absence keeps, a value sets, null
    // clears (entry-context-menu D7). Only a value is worth validating.
    if (body.axis !== undefined && body.axis !== null && !ORBIT_AXES.includes(body.axis)) {
      return c.json({ error: `invalid axis: ${String(body.axis)}` }, 400)
    }
    if (body.lighting !== undefined && !LIGHTING_MODES.includes(body.lighting)) {
      return c.json({ error: `invalid lighting: ${String(body.lighting)}` }, 400)
    }
    if (body.rig !== undefined && typeof body.rig !== 'number') {
      return c.json({ error: `invalid rig: ${String(body.rig)}` }, 400)
    }
    await cache.put(body.path, {
      mtime: body.mtime,
      png: body.png !== undefined ? Buffer.from(body.png, 'base64') : undefined,
      camera: body.camera,
      axis: body.axis,
      lighting: body.lighting,
      rig: body.rig,
      posed: body.posed,
    })
    return c.json({ ok: true })
  })

  return app
}
