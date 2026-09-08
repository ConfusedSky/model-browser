import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureReport } from '../../shared/types'
import { HttpApiClient, HttpError, POSES_MAX, type ThumbSave } from '../src/api/client'
import {
  readLocalFraming,
  withLocalFramings,
  type FramingStorage,
} from '../src/api/localFramings'

const CAM = { az: 1, el: 0.5, distR: 2, target: [0, 0, 0] as [number, number, number] }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
  })
})

describe('HttpApiClient contract', () => {
  it('listDir encodes the path (spaces, !/ virtual separator)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ path: '', entries: [] }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.listDir('/my models/kit.zip!/parts')
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/dir?path=${encodeURIComponent('/my models/kit.zip!/parts')}`,
      { signal: undefined },
    )
  })

  it('listDir emits flat=true only when asked', async () => {
    const fetchFn = vi.fn((_url: string) => Promise.resolve(jsonResponse({ path: '', entries: [] })))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.listDir('/models', { flat: true })
    expect(fetchFn).toHaveBeenCalledWith(`/api/dir?path=${encodeURIComponent('/models')}&flat=true`, {
      signal: undefined,
    })
    await api.listDir('/models', { flat: false })
    await api.listDir('/models')
    expect(fetchFn).toHaveBeenCalledWith(`/api/dir?path=${encodeURIComponent('/models')}`, {
      signal: undefined,
    })
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('flat'))).toHaveLength(1)
  })

  it('listDir appends q, escaped, only when non-blank', async () => {
    const fetchFn = vi.fn((_url: string) => Promise.resolve(jsonResponse({ path: '', entries: [] })))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.listDir('/models', { flat: true, q: 'nuts & bolts' })
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/dir?path=${encodeURIComponent('/models')}&flat=true&q=${encodeURIComponent('nuts & bolts')}`,
      { signal: undefined },
    )
    fetchFn.mockClear()
    await api.listDir('/models', { flat: true, q: '   ' })
    expect(fetchFn).toHaveBeenCalledWith(`/api/dir?path=${encodeURIComponent('/models')}&flat=true`, {
      signal: undefined,
    })
  })

  it('listDir hands its signal to fetch — a superseded walk is cancellable', async () => {
    // The client half of search-cancellation's premise: without the signal
    // reaching fetch, the connection stays open and the server's
    // `c.req.raw.signal` never fires, however promptly the client stops
    // caring about the answer.
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ path: '', entries: [] }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const controller = new AbortController()
    await api.listDir('/models', { flat: true }, controller.signal)
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/api/dir?path='), {
      signal: controller.signal,
    })
  })

  it('semanticPoses asks about one directory, escaped', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ poses: {} }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    // No second argument and no signal: the wave is one bounded question about
    // the directory the client is already looking at, and a superseded one is
    // dropped on arrival rather than stopped in flight.
    await expect(api.semanticPoses('/my models/kit')).resolves.toEqual({ poses: {} })
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/semantic/poses?path=${encodeURIComponent('/my models/kit')}`,
    )
  })

  it('semanticPosesFor posts the models it was handed, in one request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ poses: { '/a/x.stl': 1 } }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    // Paths in the body, not in the URL: a listing's worth of them does not fit
    // in a query string, and nothing about them needs escaping twice.
    await expect(api.semanticPosesFor(['/a/x.stl', '/b/y.stl'])).resolves.toEqual({
      poses: { '/a/x.stl': 1 },
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/semantic/poses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['/a/x.stl', '/b/y.stl'] }),
    })
  })

  it('semanticPosesFor chunks a listing past the route bound and merges the answers', async () => {
    // A plain directory listing has no model cap — `MODEL_BROWSER_FLAT_CAP` is
    // the flat walk's — so a folder can land more entries than one request may
    // name. Slicing to the bound would leave the tail permanently unposed, and
    // silently, since a missing key reads as "the index has no orientation for
    // this": the exact un-posed tile this whole change exists to remove.
    const paths = Array.from({ length: POSES_MAX + 1 }, (_, i) => `/models/m${i}.stl`)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ poses: { '/models/m0.stl': 1 } }))
      .mockResolvedValueOnce(jsonResponse({ poses: { [`/models/m${POSES_MAX}.stl`]: 2 } }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)

    await expect(api.semanticPosesFor(paths)).resolves.toEqual({
      poses: { '/models/m0.stl': 1, [`/models/m${POSES_MAX}.stl`]: 2 },
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    const sent = fetchFn.mock.calls.map(
      (c) => (JSON.parse((c[1] as { body: string }).body) as { paths: string[] }).paths,
    )
    expect(sent[0]).toHaveLength(POSES_MAX)
    expect(sent[1]).toEqual([`/models/m${POSES_MAX}.stl`])
    // Every path asked about exactly once, in order and with none dropped.
    expect([...sent[0]!, ...sent[1]!]).toEqual(paths)
  })

  it('semanticPosesFor keeps the chunks that answered when one of them fails', async () => {
    // The chunking was all-or-nothing: chunk k rejecting rejected the whole
    // promise and discarded chunks 1..k-1's poses, and `App` swallows the
    // rejection — so one 500 in the middle of a large folder left *every* tile
    // un-posed, which is the same silent un-posed tail the chunking exists to
    // prevent, reached the other way round. A failed chunk now contributes
    // nothing and the rest land; its paths are simply absent from the map,
    // indistinguishable from "the index has no orientation for these".
    const paths = Array.from({ length: POSES_MAX + 1 }, (_, i) => `/models/m${i}.stl`)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ poses: { '/models/m0.stl': 1 } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'index exploded' }, 500))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)

    await expect(api.semanticPosesFor(paths)).resolves.toEqual({
      poses: { '/models/m0.stl': 1 },
    })
    // Both chunks were still attempted — the failure does not stop the loop.
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('semanticPosesFor rejects only when every chunk failed', async () => {
    // Nothing arrived, so the caller's silent-failure path has to still mean
    // that. The first failure is the one raised: a later chunk's message would
    // describe the same outage from further along.
    const paths = Array.from({ length: POSES_MAX + 1 }, (_, i) => `/models/m${i}.stl`)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'index exploded' }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: 'still exploded' }, 500))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)

    await expect(api.semanticPosesFor(paths)).rejects.toThrow('index exploded')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('semanticPosesFor asks nothing, and fails at nothing, for no paths', async () => {
    // "Every chunk failed" must not read as true when there were no chunks:
    // zero paths is an empty answer, not an outage.
    const fetchFn = vi.fn()
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await expect(api.semanticPosesFor([])).resolves.toEqual({ poses: {} })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('semanticPoses raises the server failure rather than swallowing it', async () => {
    // Silence is `App`'s decision, not the client's: the wire reports, and the
    // wave's caller is the one that says nothing about it.
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'no such directory' }, 404))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await expect(api.semanticPoses('/gone')).rejects.toThrow('no such directory')
  })

  it('throws HttpError with the server message on failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'nested zips are unsupported' }, 400))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await expect(api.listDir('/a.zip!/b.zip')).rejects.toThrow('nested zips are unsupported')
    await expect(api.listDir('/a.zip!/b.zip')).rejects.toBeInstanceOf(HttpError)
  })

  it('overrides asks the route for one path, encoded, and throws like its siblings', async () => {
    // The client half of `library-overrides` D3. Encoding is the whole risk on
    // this one: a kit folder is named from a corpus title and the demo's own
    // keys carry spaces and `&`, which unescaped would truncate the query the
    // way `listDir`'s `q` would. No second parameter and no signal — the panel
    // ignores a stale answer rather than aborting it (D4).
    const credits = { author: 'Valandar', license: 'CC-BY' }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ name: 'Pack 03', credits }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    expect(await api.overrides('/Player & Pack 03/hero.stl')).toEqual({
      name: 'Pack 03',
      credits,
    })
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/overrides?path=${encodeURIComponent('/Player & Pack 03/hero.stl')}`,
    )

    // `jsonOrThrow`, not a swallowed failure: the *panel* renders a failed read
    // as an uncredited model, but that is the panel's rule and it can only make
    // it if the client tells it. A resolving stub here would hide the day this
    // route starts 503ing behind an unconfigured library.
    fetchFn.mockResolvedValue(jsonResponse({ error: 'path is required' }, 400))
    await expect(api.overrides('/x.stl')).rejects.toBeInstanceOf(HttpError)
  })

  it('getThumb decodes base64 png to an object URL and passes camera and axis through', async () => {
    const png = btoa('png-bytes')
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'hit', png, camera: CAM, axis: '-z', lighting: 'camera', rig: 2 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const res = await api.getThumb('/m.stl', 42)
    expect(fetchFn).toHaveBeenCalledWith(`/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42`)
    expect(res).toEqual({ status: 'hit', camera: CAM, axis: '-z', lighting: 'camera', rig: 2, pngUrl: 'blob:mock' })
  })

  // The whole point of appending `ao` only when it is off: an occlusion-on
  // request must be the same bytes it was before renders were keyed by
  // occlusion, so an old cache and an old server answer it unchanged (D2).
  // The cell above pins the on-request; this one pins the off-request beside
  // it, and the two together are what "only when off" means.
  it('getThumb names the unoccluded render, and only then', async () => {
    // A fresh Response per call: one instance cannot be read three times.
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ status: 'miss' })))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)

    await api.getThumb('/m.stl', 42, false)
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42&ao=off`,
    )

    // Explicitly on, and defaulted on: neither may add a parameter.
    await api.getThumb('/m.stl', 42, true)
    await api.getThumb('/m.stl', 42)
    const urls = fetchFn.mock.calls.slice(1).map((c) => (c as unknown[])[0])
    expect(urls).toEqual([
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42`,
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42`,
    ])
  })

  // The generation is appended only when the caller has one, for exactly the
  // reason `ao` is appended only when off: a client that has learned nothing
  // yet must send the bytes it sent before this change existed, so an old
  // server and a warm browser cache both answer it unchanged.
  it('getThumb names the generation it knows, and only then', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ status: 'miss' })))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)

    await api.getThumb('/m.stl', 42, true, 7)
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42&gen=7`,
    )

    // Beside `ao=off`, in that order — one URL, both dimensions.
    await api.getThumb('/m.stl', 42, false, 7)
    expect(fetchFn).toHaveBeenLastCalledWith(
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42&ao=off&gen=7`,
    )

    // Absent, and explicitly undefined: neither may add a parameter. This is
    // the byte-identity claim — the URL is the one the cell above pins.
    await api.getThumb('/m.stl', 42, true, undefined)
    await api.getThumb('/m.stl', 42)
    const urls = fetchFn.mock.calls.slice(2).map((c) => (c as unknown[])[0])
    expect(urls).toEqual([
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42`,
      `/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42`,
    ])
  })

  it('getThumb carries the generation the server reported', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'miss', gen: 99 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    expect((await api.getThumb('/m.stl', 42)).gen).toBe(99)
  })

  it('putThumb reports the generation its write landed under', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 1234 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    expect(await api.putThumb({ path: '/m.stl', mtime: 42 })).toEqual({ gen: 1234 })
  })

  // An older server answers `{ok:true}` and nothing else. That is a successful
  // write with no generation to report, not a failure: the caller degrades to
  // the validator tier rather than throwing.
  it('putThumb treats a generation-less answer as a success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    expect(await api.putThumb({ path: '/m.stl', mtime: 42 })).toEqual({ gen: undefined })
  })

  /**
   * `webp-thumbnails` D6: `canvas.toBlob` answers PNG when it cannot encode
   * the type asked for, silently, so the only place a wrong format can be
   * caught is the moment before it is uploaded.
   */
  it('putThumb drops a render the browser encoded as something else', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 7 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    expect(await api.putThumb({ path: '/m.stl', mtime: 42, png })).toEqual({ dropped: true })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  /**
   * The orbit release, the axis set and the reframe all send a camera in the
   * same write as the pixels. Refusing the whole request would lose the
   * orientation the user just chose — silently, and on WebKit only.
   */
  it('putThumb keeps the orientation when it drops the render', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 9 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    expect(
      await api.putThumb({
        path: '/m.stl',
        mtime: 42,
        png,
        camera: CAM,
        axis: '-z',
        lighting: 'camera',
        rig: 7,
        posed: 2,
      }),
    ).toEqual({ gen: 9, dropped: true })
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.camera).toEqual(CAM)
    expect(body.axis).toBe('-z')
    // The pixels and the three labels that describe pixels stay behind: a label
    // without a render would relabel the stored one as current.
    expect(body.png).toBeUndefined()
    expect(body.lighting).toBeUndefined()
    expect(body.rig).toBeUndefined()
    expect(body.posed).toBeUndefined()
  })

  // The flag exists so a caller that counts renders — the generate job — can
  // tell a write that stored pixels from one that stored only an orientation.
  it('putThumb reports nothing dropped on an ordinary write', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 11 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const webp = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
    const res = await api.putThumb({ path: '/m.stl', mtime: 42, png: webp })
    expect(res).toEqual({ gen: 11 })
    expect(res.dropped).toBeUndefined()
  })

  it('putThumb passes a discard through even when the render is dropped', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 10 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await api.putThumb({ path: '/m.stl', mtime: 42, png, camera: null, axis: null })
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.camera).toBeNull()
    expect(body.axis).toBeNull()
  })

  it('putThumb sends a render the browser encoded as WebP', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 7 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const webp = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
    expect(await api.putThumb({ path: '/m.stl', mtime: 42, png: webp })).toEqual({ gen: 7 })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  // The deletion is not a render, so the guard above must not stand in its way.
  it('putThumb still sends the deletion a null carries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 8 }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    expect(await api.putThumb({ path: '/m.stl', mtime: 42, png: null })).toEqual({ gen: 8 })
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).png).toBeNull()
  })

  it('getThumb on miss has no pngUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'miss' }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const res = await api.getThumb('/m.stl', 42)
    expect(res.pngUrl).toBeUndefined()
  })

  it('putThumb sends png as base64, camera, and axis in one request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.putThumb({
      path: '/m.stl',
      mtime: 42,
      png: new Blob(['raw-webp'], { type: 'image/webp' }),
      camera: CAM,
      axis: '-z',
      lighting: 'camera',
      rig: 2,
    })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/thumb')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({
      path: '/m.stl',
      mtime: 42,
      png: btoa('raw-webp'),
      camera: CAM,
      axis: '-z',
      lighting: 'camera',
      rig: 2,
    })
  })

  it('putThumb declares which render its pixels are', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.putThumb({
      path: '/m.stl',
      mtime: 42,
      png: new Blob(['raw-webp'], { type: 'image/webp' }),
      lighting: 'camera',
      rig: 2,
      ao: false,
    })
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    // `false` has to survive serialisation as a value, not vanish the way an
    // absent field does — absent means occluded, so a dropped `false` would
    // file unoccluded pixels over the shipped render.
    expect(body.ao).toBe(false)
    expect(Object.hasOwn(body, 'ao')).toBe(true)
  })

  it('fetchModel returns raw bytes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const buf = await api.fetchModel('/m.stl')
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]))
  })

  // The pixel field has three states on the wire, and `null` is the one that
  // survives only if it is passed through deliberately — `JSON.stringify` drops
  // an `undefined` field, and the ternary this replaced turned a deletion into
  // absence, which *keeps* the pixels (`bulk-thumbnail-jobs` D3). Asserted
  // against the raw body string, because the bug was in the serialisation.
  it('putThumb sends a deletion as null, and an absent png not at all', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.putThumb({ path: '/m.stl', mtime: 42, png: null, camera: null })
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(init.body as string).toContain('"png":null')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.png).toBeNull()
    expect(Object.hasOwn(body, 'png')).toBe(true)

    fetchFn.mockClear()
    await api.putThumb({ path: '/m.stl', mtime: 42, camera: CAM })
    const [, plain] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(plain.body as string).not.toContain('png')
    expect(Object.hasOwn(JSON.parse(plain.body as string) as object, 'png')).toBe(false)
  })

  it('putThumb sends the generation it is conditional on, and only when it has one', async () => {
    // Typed arguments so `mock.calls` is the pair this cell destructures; a
    // fresh Response per call, since one cannot be read twice.
    const fetchFn = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true })),
    )
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.putThumb({ path: '/m.stl', mtime: 42, png: null, ifGen: 7 })
    const [, conditional] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect((JSON.parse(conditional.body as string) as Record<string, unknown>).ifGen).toBe(7)

    // Absent for every ordinary write, so a client that is not running a job
    // sends the bytes it sent before this change and the write is unconditional.
    fetchFn.mockClear()
    await api.putThumb({ path: '/m.stl', mtime: 42, png: new Blob(['raw-webp'], { type: 'image/webp' }) })
    const [, plain] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(Object.hasOwn(JSON.parse(plain.body as string) as object, 'ifGen')).toBe(false)
  })

  // A refused conditional write is an `HttpError` carrying 412 — no error class
  // of its own, because what the job does with it is a status check (D4).
  it('putThumb surfaces a refusal as a 412 HttpError', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'generation moved', gen: 99 }, 412))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const err = await api
      .putThumb({ path: '/m.stl', mtime: 42, png: null, ifGen: 7 })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(412)
    expect((err as HttpError).message).toBe('generation moved')
  })

  it('models asks for every model beneath one path, escaped', async () => {
    const listing = { path: '/kit', entries: [], complete: true }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(listing))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    // No second argument and no signal: an explicit action's scope is not
    // superseded by scrolling, and a stale answer is dropped by the caller.
    await expect(api.models('/kit')).resolves.toEqual(listing)
    expect(fetchFn).toHaveBeenCalledWith(`/api/models?path=${encodeURIComponent('/kit')}`)
  })
})

// The local-framing decorator (`public-deployment` D6, tasks 4.1/4.2/0.3).
//
// Storage is injected per cell rather than shared through a global
// `localStorage`: "one browser's framing is nobody else's" is a claim about two
// stores, and it cannot be made against one. The inner client is a real
// `HttpApiClient` over a spy `fetchFn`, so "sends nothing" is asserted at the
// network and not merely at a mock's method.
describe('withLocalFramings', () => {
  const OFF: FeatureReport = { thumbWrites: false }
  const ON: FeatureReport = { thumbWrites: true }

  /** A `Storage`-shaped map. `raw` is the bytes, for asserting what was kept. */
  function memStorage(): FramingStorage & { raw: Map<string, string> } {
    const raw = new Map<string, string>()
    return {
      raw,
      getItem: (k: string) => raw.get(k) ?? null,
      setItem: (k: string, v: string) => {
        raw.set(k, v)
      },
      removeItem: (k: string) => {
        raw.delete(k)
      },
    }
  }

  /** An orbit release: pixels, both orientation halves, and the pixel labels. */
  function orbitRelease(): ThumbSave {
    return {
      path: '/m.stl',
      mtime: 42,
      png: new Blob(['pixels'], { type: 'image/webp' }),
      camera: CAM,
      axis: '-z',
      // Literals here, and deliberately: these three are being asserted
      // **absent** from what is kept, so their values cannot mask a recipe bump
      // the way a literal in a cache-hit fixture would (client/test/CLAUDE.md).
      lighting: 'camera',
      rig: 7,
      posed: 3,
    }
  }

  it('keeps an orbit release in this browser, sends nothing, and reports the pixels as not stored', async () => {
    // A `fetchFn` that would *succeed* if it were reached, deliberately: a bare
    // `vi.fn()` returning undefined makes a forwarding decorator crash instead
    // of fail, and a crash is a weaker statement than "the request was made".
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, gen: 5 })))
    const store = memStorage()
    const api = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => OFF,
      store,
    )

    const written = await api.putThumb(orbitRelease())

    // Nothing left the browser — asserted at the network, since the whole point
    // is that a public deployment's cache is never reached.
    expect(fetchFn).not.toHaveBeenCalled()
    // `dropped` and no generation: the orientation landed, the pixels did not,
    // which is the account `renderEntryThumbnail` turns into `skipped` so a
    // generate job never counts this as a render made (0.3).
    expect(written).toEqual({ dropped: true })
    expect(written.gen).toBeUndefined()
    // Only the orientation is kept. The PNG and the three labels that describe
    // pixels are dropped together, for `withoutUnusableRender`'s reason.
    expect(JSON.parse(store.raw.get('mb:framing:/m.stl') as string)).toEqual({
      camera: CAM,
      axis: '-z',
    })
  })

  it('answers a pixels-only write as dropped too, keeping nothing', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, gen: 5 })))
    const store = memStorage()
    const api = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => OFF,
      store,
    )
    const written = await api.putThumb({
      path: '/m.stl',
      mtime: 42,
      png: new Blob(['pixels'], { type: 'image/webp' }),
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(written).toEqual({ dropped: true })
    expect(store.raw.size).toBe(0)
  })

  it("prefers this browser's framing over the one the server holds", async () => {
    const store = memStorage()
    const server = { az: 9, el: 9, distR: 9, target: [1, 1, 1] as [number, number, number] }
    // A fresh Response per call — one cannot be read twice, and these cells
    // read more than once.
    const fetchFn = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 'miss', camera: server, axis: 'y', gen: 4 })),
    )
    const api = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => OFF,
      store,
    )

    await api.putThumb({ path: '/m.stl', mtime: 42, camera: CAM, axis: '-z' })
    const read = await api.getThumb('/m.stl', 42)

    expect(read.camera).toEqual(CAM)
    expect(read.axis).toBe('-z')
    // The overlay is about orientation only: the pixels and the status are the
    // server's business, and a miss with a local camera is still a miss.
    expect(read.status).toBe('miss')
    expect(read.gen).toBe(4)
  })

  it("a discard deletes the local half, and the next read shows the server's", async () => {
    const store = memStorage()
    const server = { az: 9, el: 9, distR: 9, target: [1, 1, 1] as [number, number, number] }
    const fetchFn = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 'miss', camera: server, axis: 'y' })),
    )
    const api = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => OFF,
      store,
    )

    await api.putThumb({ path: '/m.stl', mtime: 42, camera: CAM, axis: '-z' })
    expect((await api.getThumb('/m.stl', 42)).camera).toEqual(CAM)

    // Give the framing up, as a tile or the viewer does. A stale local override
    // must not outlive the discard, or nothing the server holds could ever
    // reach this model again on this browser.
    await api.putThumb({ path: '/m.stl', mtime: 42, camera: null })
    const after = await api.getThumb('/m.stl', 42)
    expect(after.camera).toEqual(server)
    // The axis was not named by the discard, so it is kept — three states, and
    // absence is the one that changes nothing.
    expect(after.axis).toBe('-z')

    await api.putThumb({ path: '/m.stl', mtime: 42, axis: null })
    expect((await api.getThumb('/m.stl', 42)).axis).toBe('y')
    // Nothing of this model is held any more — an emptied record is removed,
    // not left as an empty object for later reads to step over.
    expect(store.raw.size).toBe(0)
  })

  it("one browser's framing is nobody else's", async () => {
    const first = memStorage()
    const second = memStorage()
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ status: 'miss', axis: 'y' })))
    const mine = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => OFF,
      first,
    )
    const theirs = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => OFF,
      second,
    )

    await mine.putThumb({ path: '/m.stl', mtime: 42, camera: CAM, axis: '-z' })

    expect((await mine.getThumb('/m.stl', 42)).camera).toEqual(CAM)
    // The second visitor sees the deployment's own framing, not the first's.
    expect((await theirs.getThumb('/m.stl', 42)).camera).toBeUndefined()
    expect((await theirs.getThumb('/m.stl', 42)).axis).toBe('y')
    expect(second.raw.size).toBe(0)
  })

  // 4.2, and normative in the feature-report capability: not knowing must never
  // relocate where a user's data is stored. Both cells assert the *same object*
  // reached the inner client, so a pass-through that rebuilt the save — and
  // could therefore have dropped a field — would fail.
  it('passes through untouched while the report is unknown', async () => {
    const store = memStorage()
    const inner = new HttpApiClient(
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, gen: 5 }))) as unknown as typeof fetch,
    )
    const put = vi.spyOn(inner, 'putThumb')
    const get = vi.spyOn(inner, 'getThumb')
    const api = withLocalFramings(inner, () => null, store)

    const save = orbitRelease()
    expect(await api.putThumb(save)).toEqual({ gen: 5 })
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]![0]).toBe(save)
    // Nothing was kept here — the write went to the server, as it does today.
    expect(store.raw.size).toBe(0)

    await api.getThumb('/m.stl', 42, false, 5)
    expect(get).toHaveBeenCalledWith('/m.stl', 42, false, 5)
  })

  it('passes through untouched where the deployment accepts writes', async () => {
    const store = memStorage()
    const inner = new HttpApiClient(
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, gen: 5 })) as unknown as typeof fetch,
    )
    const put = vi.spyOn(inner, 'putThumb')
    const api = withLocalFramings(inner, () => ON, store)

    const save = orbitRelease()
    expect(await api.putThumb(save)).toEqual({ gen: 5 })
    expect(put.mock.calls[0]![0]).toBe(save)
    expect(store.raw.size).toBe(0)
  })

  // The report resolves *after* the client is built (App holds one identity for
  // the session), so the gate has to be read per call and not at construction.
  it('reads the report per call, not at construction', async () => {
    const store = memStorage()
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, gen: 5 })))
    let report: FeatureReport | null = null
    const api = withLocalFramings(
      new HttpApiClient(fetchFn as unknown as typeof fetch),
      () => report,
      store,
    )

    await api.putThumb({ path: '/m.stl', mtime: 42, camera: CAM })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    report = OFF
    await api.putThumb({ path: '/m.stl', mtime: 42, camera: CAM })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(readLocalFraming('/m.stl', store)).toEqual({ camera: CAM })
  })

  it('reads a hand-edited or malformed record as nothing stored', () => {
    const store = memStorage()
    store.raw.set('mb:framing:/m.stl', 'not json')
    expect(readLocalFraming('/m.stl', store)).toBeUndefined()
    store.raw.set('mb:framing:/m.stl', JSON.stringify({ camera: { az: 'left' }, axis: 'w' }))
    expect(readLocalFraming('/m.stl', store)).toBeUndefined()
  })
})
