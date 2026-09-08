/**
 * Serving the built client alongside the API, so a deployment is one process
 * rather than a static host beside an application server (public-deployment
 * D8).
 *
 * Node APIs only, and **no Hono routes**: serving files is adapter-specific, so
 * it is wired in the runtime entry point rather than mounted on the app, which
 * must keep running on Node unchanged for the Electron seam (global D1). What
 * lives here is the part that has behaviour worth testing — the path rules, the
 * cache headers, and the one composition rule `index.ts` wires.
 *
 * **Nothing here compresses.** Deliberate (D8): the transfer cost is real and
 * already owned — `demo-infrastructure` puts `encode zstd gzip` in the Caddyfile
 * that fronts the deployment this is for — and making it a rule here would bind
 * every loopback install, where the transfer is free, to a deployment shape
 * nobody is building. What this module owes is the caching rule below, which a
 * proxy cannot supply for it.
 *
 * Serving the client is never required: with no built client, `index.ts` skips
 * this module entirely and the API answers exactly as before, so the local
 * development loop — where Vite serves the client — does not start depending
 * on a build.
 */

import { readFile, stat } from 'node:fs/promises'
import { posix, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The API's prefix is **reserved**: a request under it that names no route is a
 * missing route, and must never fall through to the client's entry document, or
 * a client's bad request comes back as an HTML body with a 200 and the bug is
 * invisible (D8).
 *
 * `/api` itself is reserved for the same reason it reads as reserved: it is the
 * prefix, not a document.
 */
export function isApiRequest(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * The whole composition, as one function so it is testable rather than being
 * three lines of the entry point nobody can reach. API first and API only under
 * its prefix; anything else is the client's, and falls back to the app when
 * there is no client to serve.
 */
export async function route(
  req: Request,
  api: (req: Request) => Response | Promise<Response>,
  client: ((req: Request) => Promise<Response | null>) | null,
): Promise<Response> {
  if (client === null || isApiRequest(new URL(req.url).pathname)) return api(req)
  return (await client(req)) ?? (await api(req))
}

/**
 * Where the built client is: `client/dist` beside the server package, or
 * wherever `MODEL_BROWSER_CLIENT` says. A parameter rather than a read of
 * `process.env` so a test can point it at a temp tree, like `xdg.ts`.
 */
export function clientDist(env: NodeJS.ProcessEnv): string {
  const override = env.MODEL_BROWSER_CLIENT
  if (override !== undefined && override !== '') return override
  return fileURLToPath(new URL('../../client/dist', import.meta.url))
}

/** Content types for what a Vite build actually emits. */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}

/**
 * A year, and `immutable`: the build's assets are content-hashed, so a changed
 * file is a changed name and a visitor far from the origin fetches each one
 * once. The entry document is `no-cache` — revalidated every visit — because it
 * is the one file whose name does not change and the only thing that names the
 * new build's assets.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

/**
 * Serves `distDir`, or `null` when there is nothing there to serve.
 *
 * Rules, all four of them:
 * - the requested path resolves under `distDir`, and anything naming its way
 *   out of it is refused — a `..` that survives URL normalisation arrived
 *   percent-encoded, and is a traversal attempt rather than a filename;
 * - a file that exists is served with its own content type;
 * - anything under `/assets/` is `immutable` for a year, the entry document is
 *   `no-cache`;
 * - a request matching no file is answered with the entry document, so a deep
 *   link opened cold resolves in the client rather than 404-ing at the server.
 */
export function createStaticHandler(distDir: string): (req: Request) => Promise<Response | null> {
  const root = resolvePath(distDir)
  const indexPath = resolvePath(root, 'index.html')

  async function send(file: string, cacheControl: string): Promise<Response | null> {
    try {
      if (!(await stat(file)).isFile()) return null
    } catch {
      return null
    }
    return new Response(new Uint8Array(await readFile(file)), {
      headers: {
        'content-type': TYPES[extensionOf(file)] ?? 'application/octet-stream',
        'cache-control': cacheControl,
      },
    })
  }

  return async function handle(req: Request): Promise<Response | null> {
    const { pathname } = new URL(req.url)
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return new Response('bad request', { status: 400 })
    }
    // A `..` reaching here survived URL normalisation, which means it arrived
    // percent-encoded — a traversal attempt rather than a filename. Refused
    // outright rather than normalised away, so what is refused is legible;
    // `posix.normalize` would silently rewrite `/../../etc/passwd` to
    // `/etc/passwd` and serve whatever that names inside the build. A NUL goes
    // the same way: `node:fs` throws on one, and a thrown path is a 500 saying
    // something about this machine.
    const parts = decoded.split('/')
    if (parts.includes('..') || decoded.includes('\0')) {
      return new Response('forbidden', { status: 403 })
    }
    const normalized = posix.normalize(decoded)
    const candidate = resolvePath(root, `.${normalized}`)
    // Belt and braces: whatever the rules above let through must still land
    // under the build, and this is the one check a later rule cannot weaken by
    // accident.
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    if (candidate !== root) {
      const file = await send(candidate, normalized.startsWith('/assets/') ? IMMUTABLE : REVALIDATE)
      if (file !== null) return file
    }
    // No file of that name: the client's entry document, so the client resolves
    // the location itself.
    return send(indexPath, REVALIDATE)
  }
}
