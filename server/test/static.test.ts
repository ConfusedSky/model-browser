import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { clientDist, createStaticHandler, isApiRequest, route } from '../src/static'
import { realTempDir } from './helpers'

/**
 * Serving the built client from the runtime entry point (`public-deployment`
 * D8, tasks 5.1–5.3).
 *
 * A dist directory built here rather than a real `client/dist`, so the cells
 * assert the rules and not a particular build: an entry document, a hashed
 * asset, an image, and a file whose name collides with nothing.
 */
const dist = realTempDir('mb-static-dist-')
mkdirSync(join(dist, 'assets'))
const INDEX = '<!doctype html><title>model browser</title>'
const BUNDLE = `console.log(${JSON.stringify('x'.repeat(4096))})\n`
writeFileSync(join(dist, 'index.html'), INDEX)
writeFileSync(join(dist, 'assets', 'main-abc123.js'), BUNDLE)
writeFileSync(join(dist, 'assets', 'main-abc123.css'), 'body{margin:0}')
writeFileSync(join(dist, 'assets', 'logo-abc123.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
writeFileSync(join(dist, 'favicon.ico'), Buffer.from([0, 0, 1, 0]))
const secret = realTempDir('mb-static-outside-')
writeFileSync(join(secret, 'secret.txt'), 'not yours')

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
  rmSync(secret, { recursive: true, force: true })
})

const serve = createStaticHandler(dist)
const ask = (path: string, headers: Record<string, string> = {}) =>
  serve(new Request(`http://models.example${path}`, { headers }))

describe('the static handler', () => {
  it('serves a file that exists, with its own content type', async () => {
    const js = await ask('/assets/main-abc123.js')
    expect(js?.status).toBe(200)
    expect(js?.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await js?.text()).toBe(BUNDLE)

    const png = await ask('/assets/logo-abc123.png')
    expect(png?.headers.get('content-type')).toBe('image/png')
    const ico = await ask('/favicon.ico')
    expect(ico?.headers.get('content-type')).toBe('image/x-icon')
  })

  it('caches the hashed assets immutably and revalidates the entry document', async () => {
    // The build is content-hashed, so a changed asset is a changed name and a
    // visitor far from the origin fetches each one once; the entry document is
    // the one name that does not change and the only thing that names the new
    // build's assets, so it is revalidated every visit (5.3).
    expect((await ask('/assets/main-abc123.js'))?.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect((await ask('/assets/main-abc123.css'))?.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect((await ask('/'))?.headers.get('cache-control')).toBe('no-cache')
    expect((await ask('/index.html'))?.headers.get('cache-control')).toBe('no-cache')
    expect((await ask('/favicon.ico'))?.headers.get('cache-control')).toBe('no-cache')
  })

  it('answers a path matching no file with the entry document', async () => {
    // A deep link opened cold: the server has no such file, and the client
    // resolves the location itself (5.1).
    for (const path of ['/', '/kits/dragons', '/assets/gone-deadbeef.js']) {
      const res = await ask(path)
      expect(res?.status, path).toBe(200)
      expect(res?.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(await res?.text()).toBe(INDEX)
    }
  })

  it('refuses a path that names its way out of the dist directory', async () => {
    // `new URL` normalises a literal `..` away, so the case that reaches a
    // handler is the percent-encoded one. It is refused rather than normalised:
    // `posix.normalize` would rewrite `/../../etc/passwd` to `/etc/passwd` and
    // serve whatever that names *inside* the build, which is a 200 for a
    // request that asked for a traversal.
    // What actually reaches a handler, measured rather than assumed: WHATWG URL
    // resolves a literal `..` **and** a `%2e%2e` segment away before `pathname`
    // is read (`/%2e%2e/%2e%2e/etc/passwd` arrives as `/etc/passwd`), so the
    // traversal that survives is the one whose *slash* is encoded — the handler
    // decodes, and only then are there `..` segments to find.
    const escaped = `/assets%2f..%2f..%2f${secret.slice(1).split('/').join('%2f')}%2fsecret.txt`
    for (const path of ['/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/assets%2f..%2f..%2fsecret.txt', escaped]) {
      const res = await ask(path)
      expect(res?.status, path).toBe(403)
      expect(await res?.text()).not.toContain('not yours')
    }
    // And a path that cannot be decoded at all is a bad request, not a throw.
    expect((await ask('/%'))?.status).toBe(400)
  })

  it('encodes nothing, whatever the requester accepts', async () => {
    // Deliberate (D8): the transfer cost is owned by the proxy that fronts the
    // deployment this is for (`demo-infrastructure`'s `encode zstd gzip`), and
    // a rule here would bind every loopback install, where it is free, to a
    // deployment shape nobody is building. So the bytes are the file's, and
    // nothing varies by the request.
    for (const path of ['/assets/main-abc123.js', '/index.html', '/kits/dragons']) {
      const res = await ask(path, { 'accept-encoding': 'gzip, deflate, br, zstd' })
      expect(res?.headers.get('content-encoding'), path).toBeNull()
      expect(res?.headers.get('vary'), path).toBeNull()
    }
    const js = await ask('/assets/main-abc123.js', { 'accept-encoding': 'gzip' })
    expect(await js?.text()).toBe(BUNDLE)
  })

  it('has nothing to serve when there is no entry document', async () => {
    // The null the composition falls back to the API on.
    const empty = realTempDir('mb-static-empty-')
    const bare = createStaticHandler(empty)
    expect(await bare(new Request('http://models.example/anything'))).toBeNull()
    rmSync(empty, { recursive: true, force: true })
  })
})

describe('the composition index.ts wires', () => {
  const api = (req: Request) =>
    new Response(JSON.stringify({ api: new URL(req.url).pathname }), {
      status: new URL(req.url).pathname === '/api/gone' ? 404 : 200,
      headers: { 'content-type': 'application/json' },
    })

  it('reserves the API prefix — a 404 under it is final', async () => {
    // D8: a client's bad request answered with the entry document and a 200
    // would make the bug invisible.
    const res = await route(new Request('http://models.example/api/gone'), api, serve)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ api: '/api/gone' })
  })

  it('sends every API path to the app, and nothing else', async () => {
    expect(isApiRequest('/api')).toBe(true)
    expect(isApiRequest('/api/dir')).toBe(true)
    expect(isApiRequest('/apiary')).toBe(false)
    expect(isApiRequest('/')).toBe(false)
    expect(isApiRequest('/kits/api/x')).toBe(false)
    // The prefix is reserved case-insensitively (9.11b): the reservation is
    // about which handler answers, and `/API/dir` falling through to the
    // client's entry document with a 200 is the invisible bug the rule exists
    // to prevent. The near miss keeps its answer — the case rule widens the
    // prefix, not the match.
    expect(isApiRequest('/API/dir')).toBe(true)
    expect(isApiRequest('/Api')).toBe(true)
    expect(isApiRequest('/APIary')).toBe(false)
    // Routed to the API, not to the client: the stub answers with the path it
    // saw, where the client would have answered the entry document.
    const upper = await route(new Request('http://models.example/API/gone'), api, serve)
    expect(await upper.json()).toEqual({ api: '/API/gone' })

    const dir = await route(new Request('http://models.example/api/dir?path=/'), api, serve)
    expect(await dir.json()).toEqual({ api: '/api/dir' })
  })

  it('sends everything else to the client', async () => {
    const page = await route(new Request('http://models.example/kits/dragons'), api, serve)
    expect(await page.text()).toBe(INDEX)
    const asset = await route(new Request('http://models.example/assets/main-abc123.js'), api, serve)
    expect(await asset.text()).toBe(BUNDLE)
  })

  it('serves the API exactly as before when there is no built client', async () => {
    // 5.1: the development loop, where Vite serves the client, must not start
    // depending on a build.
    for (const path of ['/api/dir', '/', '/kits/dragons']) {
      const res = await route(new Request(`http://models.example${path}`), api, null)
      expect(await res.json()).toEqual({ api: path })
    }
  })
})

describe('where the built client is', () => {
  it('is client/dist beside the server package, overridable', () => {
    expect(clientDist({})).toMatch(/[/\\]client[/\\]dist$/)
    expect(clientDist({ MODEL_BROWSER_CLIENT: '/elsewhere/dist' })).toBe('/elsewhere/dist')
    expect(clientDist({ MODEL_BROWSER_CLIENT: '' })).toMatch(/[/\\]client[/\\]dist$/)
  })
})
