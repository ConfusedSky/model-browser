import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { LightingMode, OrbitAxis, ThumbPutRequest } from '../../shared/types'
import { ThumbCache } from './cache'
import { guard } from './guard'
import { ListingError, complete, listDir, listFlat } from './listing'
import { IndexError, hitsToEntries, indexStatus, query as indexQuery, scopeWithin } from './semantic'
import { VPathError, parseVPath } from './vpath'
import { ZipError, extractEntry } from './zip'

const ORBIT_AXES: readonly OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']
const LIGHTING_MODES: readonly LightingMode[] = ['axis', 'camera']

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
        return c.json({ error: err.message, state: err.state }, 503)
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
    if (body.axis !== undefined && !ORBIT_AXES.includes(body.axis)) {
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
