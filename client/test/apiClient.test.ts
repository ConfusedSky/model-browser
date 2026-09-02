import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpApiClient, HttpError, POSES_MAX } from '../src/api/client'

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
      png: new Blob(['raw-png']),
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
      png: btoa('raw-png'),
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
      png: new Blob(['raw-png']),
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
})
