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
    )
  })

  it('throws HttpError with the server message on failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'nested zips are unsupported' }, 400))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await expect(api.listDir('/a.zip!/b.zip')).rejects.toThrow('nested zips are unsupported')
    await expect(api.listDir('/a.zip!/b.zip')).rejects.toBeInstanceOf(HttpError)
  })

  it('getThumb decodes base64 png to an object URL and passes camera through', async () => {
    const png = btoa('png-bytes')
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'hit', png, camera: CAM }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const res = await api.getThumb('/m.stl', 42)
    expect(fetchFn).toHaveBeenCalledWith(`/api/thumb?path=${encodeURIComponent('/m.stl')}&mtime=42`)
    expect(res).toEqual({ status: 'hit', camera: CAM, pngUrl: 'blob:mock' })
  })

  it('getThumb on miss has no pngUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'miss' }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const res = await api.getThumb('/m.stl', 42)
    expect(res.pngUrl).toBeUndefined()
  })

  it('putThumb sends png as base64 and camera in one request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    await api.putThumb({ path: '/m.stl', mtime: 42, png: new Blob(['raw-png']), camera: CAM })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/thumb')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ path: '/m.stl', mtime: 42, png: btoa('raw-png'), camera: CAM })
  })

  it('fetchModel returns raw bytes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    const api = new HttpApiClient(fetchFn as unknown as typeof fetch)
    const buf = await api.fetchModel('/m.stl')
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]))
  })
})
