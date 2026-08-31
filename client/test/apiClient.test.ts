import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpApiClient, HttpError } from '../src/api/client'

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

  it('throws HttpError with the server message on failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'nested zips are unsupported' }, 400))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await expect(api.listDir('/a.zip!/b.zip')).rejects.toThrow('nested zips are unsupported')
    await expect(api.listDir('/a.zip!/b.zip')).rejects.toBeInstanceOf(HttpError)
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
