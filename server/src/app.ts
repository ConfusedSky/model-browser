import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { relative, resolve as resolvePath } from 'node:path'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { LightingMode, OrbitAxis, ThumbPutRequest } from '../../shared/types'
import { ThumbCache } from './cache'
import { guard } from './guard'
import { LaunchError, type Launcher, ZipTempStore, createLauncher } from './launch'
import { LibraryError, type Library, canonicalLibPath, createLibrary } from './library'
import { ListingError, complete, listDir, listFlat } from './listing'
import {
  IndexError,
  hitsToEntries,
  indexStatus,
  modelEntryAt,
  probeStatus,
  query as indexQuery,
  scopeWithin,
  similar as indexSimilar,
} from './semantic'
import { VPathError } from './vpath'
import { ZipError, extractEntry } from './zip'

const ORBIT_AXES: readonly OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']
/**
 * The one lighting label a client can produce. Not a list: `remove-axis-lighting`
 * left `LightingMode` a two-value union so entries written under the retired
 * spindle-aligned rig stay readable, and a `LIGHTING_MODES` array would say the
 * server still accepts both. A GET echoes whatever the cache holds, `'axis'`
 * included; only writes are narrowed.
 */
const PRODUCIBLE_LIGHTING: LightingMode = 'camera'

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

/**
 * The end of a chain of narrowing branches, which the compiler reaches only if
 * one is missing: `never` accepts nothing, so an unhandled member of the union
 * is a type error at the call rather than a wrong answer at runtime. It throws
 * if it is ever reached anyway — a hand-written state object from a test, say —
 * because an unrecognised state is not something to answer 200 to.
 */
function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`)
}

export function createApp(
  cache: ThumbCache = new ThumbCache(),
  launcher: Launcher = createLauncher(),
  // Per server run, per app: nothing in it is deleted while the server runs,
  // since a launched application may still be reading (app-launch L7). A test
  // can inject its own store (its own root) so it never litters the real
  // tmpdir (4.5) — additive and trailing, like `cache` and `launcher` above.
  zipTemp: ZipTempStore = new ZipTempStore(),
  // The only translator between a request's path and a filesystem path
  // (library-root D3). Injected like the three above so a test drives its own
  // tree rather than the machine's configured library.
  library: Library = createLibrary(),
): Hono {
  const app = new Hono()

  app.use('/api/*', guard)

  /**
   * The library's state, and — while it is not `ready` — the answer every path
   * route gives instead of a listing (D4). 503 with a state envelope is the
   * shape `indexErrorReply` already gives the client for an absent index: "the
   * thing is not there" is a state the UI renders, not a fault.
   *
   * The exceptions are the routes that are about the *app* rather than about a
   * path: the state itself, the machine's application registry, and the index's
   * availability. Re-asked per request, because `missing` is re-evaluated each
   * time — a volume mounted after start needs no restart.
   */
  const UNGATED = new Set(['/api/library', '/api/apps', '/api/semantic/status'])
  app.use('/api/*', async (c, next) => {
    if (UNGATED.has(c.req.path)) return next()
    const s = await library.state()
    if (s.state === 'ready') return next()
    if (s.state === 'missing') {
      return c.json(
        { error: `the library at ${s.root} is not present`, state: s.state, root: s.root },
        503,
      )
    }
    if (s.state === 'nested') {
      // The root encloses a library rather than being one (R1). Both paths are
      // named because the remedy is to point the root at the second.
      return c.json(
        {
          error: `the root ${s.root} contains a library at ${s.library}`,
          state: s.state,
          root: s.root,
          library: s.library,
        },
        503,
      )
    }
    if (s.state === 'unconfigured') {
      return c.json({ error: 'no library root is configured', state: s.state }, 503)
    }
    // Every state is handled above, and the compiler is what says so. This
    // branch used to be the fall-through, answering "no library root is
    // configured" for anything it did not recognise — so a state added to
    // `LibraryState` would have been reported to the user as a missing
    // configuration, and nothing would have failed to build.
    return unreachable(s)
  })

  app.get('/api/library', async (c) => c.json(await library.state()))

  app.onError((err, c) => {
    if (err instanceof LibraryError) return c.json({ error: err.message }, err.status)
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
    // Canonicalised once, then used for everything downstream: what a listing
    // echoes as its `path` is what the client asks for next, so a spelling
    // taken in verbatim (`//kit`, `/kit/.`) would be handed straight back and
    // carried forward.
    const libPath = canonicalLibPath(path)
    if (flat) return c.json(await listFlat(library, libPath, q, { folderMatching }))
    return c.json(await listDir(library, libPath))
  })

  app.get('/api/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path is required' }, 400)
    const { fsPath, entry } = await library.resolve(path)

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
    if (s === null || !s.isFile()) return c.json({ error: `no such file: ${path}` }, 404)
    const stream = Readable.toWeb(createReadStream(fsPath)) as ReadableStream
    return c.body(stream, 200, { ...headers, 'content-length': String(s.size) })
  })

  /**
   * The one path pipeline both launch endpoints share: validated exactly as
   * `/api/file` validates (resolved through the library, nested zips rejected,
   * existence), zip entries temp-extracted, and the result **always absolute**
   * — a relative path breaks applications that resolve it against a running
   * instance's working directory (app-launch L5/L7). A path the library
   * refuses throws a `LibraryError` that `onError` renders, the same refusal
   * every other route gives.
   */
  type Resolved =
    | { ok: true; file: string }
    | { ok: false; body: { error: string }; status: 400 | 404 }

  async function resolveEntryFile(raw: string): Promise<Resolved> {
    // One spelling before the temp file is named: `fileFor` keys the extracted
    // entry on this string, and two spellings of one entry would otherwise
    // stage the same bytes twice.
    const path = canonicalLibPath(raw)
    const { fsPath, entry } = await library.resolve(path)
    if (entry !== undefined && /\.zip$/i.test(entry)) {
      return { ok: false, body: { error: 'nested zips are unsupported' }, status: 400 }
    }
    const s = await stat(fsPath).catch(() => null)
    if (s === null || !s.isFile()) {
      return { ok: false, body: { error: `no such file: ${path}` }, status: 404 }
    }
    if (entry !== undefined) {
      return { ok: true, file: await zipTemp.fileFor(path, fsPath, entry) }
    }
    return { ok: true, file: resolvePath(fsPath) }
  }

  /**
   * What the platform registry says about the model types this app handles.
   *
   * No path parameter and no path validation: the report is about the machine,
   * not an entry. Read fresh every request — the chooser can rewrite the
   * registry mid-session, so a memoized answer would go stale exactly when it
   * mattered (L5).
   */
  app.get('/api/apps', async (c) => c.json(await launcher.report()))

  /**
   * Launch an application with an entry's file. The client sends an
   * application id, never a command.
   *
   * A failed launch is a 502, on `indexErrorReply`'s reasoning: the command ran
   * and the thing downstream failed, which is a bad gateway rather than a fault
   * of this server's own code. Success means the launch command succeeded and
   * nothing more — `wine start` exits 0 once it hands off, so a Wine app that
   * then fails to open the file reads as success here, and pretending otherwise
   * would be false precision (L8).
   */
  app.post('/api/open', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { path?: unknown; appId?: unknown }
      | null
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return c.json({ error: 'path is required' }, 400)
    }
    const appId = body?.appId
    if (typeof appId !== 'string' || appId.trim() === '') {
      return c.json({ error: 'appId is required' }, 400)
    }
    const target = await resolveEntryFile(path)
    if (!target.ok) return c.json(target.body, target.status)
    try {
      await launcher.launch(appId, target.file)
    } catch (err) {
      if (err instanceof LaunchError) return c.json({ error: err.message }, 502)
      throw err
    }
    return c.json({ ok: true })
  })

  /**
   * Hand an entry's file to the machine's own configured chooser.
   *
   * Unconfigured is **unavailable, not a failed launch** — a state the UI
   * renders by withholding the action, which is `/api/semantic`'s reasoning for
   * its own 503 rather than a 500. Nothing is spawned on that path.
   *
   * The request completes when the chooser command does, however long the human
   * takes (L9). No timeout and no abort are wired here — `SpawnOptions` has no
   * `signal` to wire — because a dismissed chooser and a killed one must never
   * read the same.
   */
  app.post('/api/open-with', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return c.json({ error: 'path is required' }, 400)
    }
    if (!launcher.chooserConfigured) {
      return c.json({ error: 'no chooser is configured', unavailable: true }, 503)
    }
    const target = await resolveEntryFile(path)
    if (!target.ok) return c.json(target.body, target.status)
    try {
      await launcher.chooser(target.file)
    } catch (err) {
      if (err instanceof LaunchError) return c.json({ error: err.message }, 502)
      throw err
    }
    return c.json({ ok: true })
  })

  /**
   * Availability of the semantic index. Cached per state by `indexStatus`, so
   * this is cheap enough for the client to re-read on the interactions it
   * already makes; `fresh=true` is the explicit retry (D4).
   */
  app.get('/api/semantic/status', async (c) => {
    const s = await indexStatus(library, { fresh: c.req.query('fresh') === 'true' })
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
    // Both halves of availability from one probe: the library path the client
    // is told about, and the absolute root the index itself must be asked
    // about (D6). The gate is the *index's* root — a collection the library
    // does not hold is not unavailability, it is a collection that covers
    // nothing here, and every scope inside the library then fails the
    // containment test below on its own.
    const { status, collectionRootFs } = await probeStatus(library)
    if (status.state !== 'ready' || collectionRootFs === undefined) {
      // Not a 500: "the index is not there" is a state the UI renders, and the
      // state itself is what tells the user which thing to do about it.
      return c.json({ error: 'index unavailable', state: status.state, detail: status.detail }, 503)
    }
    // Virtual paths never leave this server (D7), and a scope outside the
    // collection is not the index's to answer.
    const scope =
      body?.path === undefined || body.path === ''
        ? null
        : await scopeWithin(library, body.path, collectionRootFs)
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
    const { entries, poses, scores } = await hitsToEntries(library, result.results, collectionRootFs)
    return c.json({
      // A library path, like every other path on the wire (D2): the scope's,
      // else the collection's. A collection the library does not hold has no
      // library path — and no hit inside it does either, so what comes back is
      // the library root and an empty set of tiles.
      path: scope !== null ? library.libPathOf(scope) : (status.collectionRoot ?? '/'),
      entries,
      poses,
      scores,
      weak: result.weak,
      // The index's ceiling, not the ranking's horizon (D2): it returned fewer
      // than was asked for, and what was asked for is the user's control.
      capped: result.truncated === true,
      // What the count cut from, forwarded only when the index reports it —
      // the field is additive both ways, so an older index leaves it absent
      // and the client says nothing extra (D9).
      ...(result.matched !== undefined ? { matched: result.matched } : {}),
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
    const { status, collectionRootFs } = await probeStatus(library)
    if (status.state !== 'ready' || collectionRootFs === undefined) {
      return c.json({ error: 'index unavailable', state: status.state, detail: status.detail }, 503)
    }
    const model = await scopeWithin(library, path, collectionRootFs)
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
    const { entries, poses, scores } = await hitsToEntries(library, result.results, collectionRootFs)
    // The model the neighbours were computed *from*, resolved into a tile of its
    // own. The index excludes the query model from its own ranking by design (it
    // scores 1.0 against itself and skews the z), so if the question is to be
    // visible beside its answer, this app is the only place that can add it.
    //
    // Its own field, never prepended into `entries`: the entries are the answer
    // and the anchor is the question, and a client that counted it would say a
    // model with no neighbours had one.
    //
    // Addressed by its library path, like every tile, and *named* the way a hit
    // is — relative to the collection — so it reads like the neighbours beside
    // it rather than as a path from the index's own view of the volume.
    // Omitted silently when it no longer stats: a model can be deleted after it
    // was embedded, and the neighbours are still a true answer without it.
    const anchor = await modelEntryAt(
      model,
      library.libPathOf(model),
      relative(collectionRootFs, model),
    )
    // Deliberately without the index's `scope` dict. A similarity view reads
    // none of the meaning residue — `weak`, `capped`, the scope's coverage
    // counts are all facts about a *phrase's* result — and forwarding it would
    // make the client's label read the view as a meaning search (4.7).
    return c.json({
      // The collection as a library path (D2), and the library root where the
      // collection has none — it then encloses or misses the library, and the
      // entries are empty either way.
      path: status.collectionRoot ?? '/',
      entries,
      poses,
      // Keyed by resolved path like `poses`, so the anchor below is simply not
      // in it: the index excludes the query model from its own ranking rather
      // than scoring it, and there is no hit to carry a number (D1).
      scores,
      ...(anchor !== null ? { anchor } : {}),
    })
  })

  app.get('/api/complete', async (c) => {
    const prefix = c.req.query('prefix') ?? ''
    return c.json(await complete(library, prefix))
  })

  app.get('/api/thumb', async (c) => {
    const path = c.req.query('path')
    const mtime = Number(c.req.query('mtime'))
    if (path === undefined || Number.isNaN(mtime)) {
      return c.json({ error: 'path and mtime are required' }, 400)
    }
    // Validated, not translated: the cache keys on the library path itself, so
    // what the library decides here is only whether this path is one the server
    // will speak about at all. Canonical, though — the key *is* the string, and
    // `/kit/../kit/a.stl` must not be a second entry beside `/kit/a.stl`.
    // Which render is wanted. Absent is `on`: that is what every request meant
    // before renders were keyed by occlusion, so a client from before this
    // change reads exactly what it always read (ao-as-recipe-dimension D2).
    const aoParam = c.req.query('ao')
    if (aoParam !== undefined && aoParam !== 'on' && aoParam !== 'off') {
      return c.json({ error: `invalid ao: ${aoParam}` }, 400)
    }
    const libPath = canonicalLibPath(path)
    await library.resolve(libPath)
    return c.json(await cache.get(libPath, mtime, aoParam !== 'off'))
  })

  app.put('/api/thumb', async (c) => {
    const body = (await c.req.json()) as ThumbPutRequest
    if (typeof body.path !== 'string' || typeof body.mtime !== 'number') {
      return c.json({ error: 'path and mtime are required' }, 400)
    }
    // Before any write: a cache entry for a path this server would not serve is
    // a write the request had no standing to ask for. Canonical for the same
    // reason the read above is — one file, one entry, whatever it was spelled.
    const libPath = canonicalLibPath(body.path)
    await library.resolve(libPath)
    // `null` is the discard, not a bad axis: absence keeps, a value sets, null
    // clears (entry-context-menu D7). Only a value is worth validating.
    if (body.axis !== undefined && body.axis !== null && !ORBIT_AXES.includes(body.axis)) {
      return c.json({ error: `invalid axis: ${String(body.axis)}` }, 400)
    }
    if (body.lighting !== undefined && body.lighting !== PRODUCIBLE_LIGHTING) {
      return c.json({ error: `invalid lighting: ${String(body.lighting)}` }, 400)
    }
    if (body.rig !== undefined && typeof body.rig !== 'number') {
      return c.json({ error: `invalid rig: ${String(body.rig)}` }, 400)
    }
    // Absent is the occluded render, for the reason the GET says: an old client
    // never rendered an unoccluded thumbnail, so an absent `ao` can only ever
    // have meant this one. Anything but a boolean is a client bug, not a
    // default — refused in the shape every other invalid field uses.
    if (body.ao !== undefined && typeof body.ao !== 'boolean') {
      return c.json({ error: `invalid ao: ${String(body.ao)}` }, 400)
    }
    await cache.put(libPath, {
      mtime: body.mtime,
      png: body.png !== undefined ? Buffer.from(body.png, 'base64') : undefined,
      camera: body.camera,
      axis: body.axis,
      lighting: body.lighting,
      rig: body.rig,
      posed: body.posed,
      ao: body.ao,
    })
    return c.json({ ok: true })
  })

  return app
}
