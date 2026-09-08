import type { MiddlewareHandler } from 'hono'

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * One configured origin, in the two shapes a request can name it: the value an
 * `Origin` header carries, and the values a `Host` header may.
 *
 * A `Host` header omits the scheme's default port, so `https://models.example`
 * is named by both `models.example` and `models.example:443` — a reverse proxy
 * may pass either. An origin written with an explicit non-default port is
 * named by that spelling alone: `Host: example.com` on an
 * `http://example.com:8080` deployment names a different origin.
 */
interface AllowedOrigin {
  origin: string
  hosts: ReadonlySet<string>
}

/**
 * The configured origins, normalised once at construction. Entries are already
 * known to be `scheme://host[:port]` — `config.ts` refuses anything else where
 * it is written, rather than letting it silently never match here.
 */
function normalize(origins: readonly string[]): AllowedOrigin[] {
  return origins.map((raw) => {
    const url = new URL(raw)
    // `URL.origin` is the lowercased `scheme://host[:port]` with a default port
    // dropped, which is exactly the spelling a browser sends.
    const origin = url.origin.toLowerCase()
    const hostname = url.hostname.toLowerCase()
    const hosts = new Set<string>([url.host.toLowerCase()])
    if (url.port === '') hosts.add(`${hostname}:${url.protocol === 'https:' ? '443' : '80'}`)
    return { origin, hosts }
  })
}

/**
 * Same-origin guard for every /api/* route. Binding alone is not a threat
 * model: on a loopback deployment any open web page can fetch a localhost port,
 * and on a public one any client anywhere can reach the address at all. This
 * server reads and serves the user's model library as the user.
 *
 * Which origins are the app's own comes from the deployment's configuration
 * (public-deployment D3); **loopback is allowed besides, whatever is
 * configured**, so a health check or an operator's own request from the machine
 * itself is not refused by the deployment it is checking — the case a local
 * curl cannot simulate is a reverse proxy that rewrites `Host` (D8). With
 * nothing configured the behaviour is exactly what it was: the two loopback
 * patterns and nothing else.
 *
 * - `Origin` that is neither a configured origin nor loopback → refused. Absent
 *   Origin is allowed (curl, tests, same-origin GETs); DNS rebinding without an
 *   Origin is caught by the Host check below.
 * - `Host` that is neither a configured host nor loopback → refused (closes DNS
 *   rebinding).
 * - CORS headers are never emitted.
 * - No-cors embeds (`<img src>`, `<script src>`) send no Origin; they are
 *   neutralized by `application/octet-stream` + `nosniff` on model bytes —
 *   and, for the one route that serves a real image type
 *   (`GET /api/thumb/image`, `thumbnail-image-serving`), by
 *   `Cross-Origin-Resource-Policy: same-origin`, which browsers enforce on
 *   exactly the no-cors loads this guard cannot see.
 *
 * An allowed origin is **not a trusted user**: on a public deployment the
 * origin check stops other *sites*, and nothing else. Confinement (`library`)
 * and refusal (`feature-report`) are what stop the visitor.
 *
 * Mounted on `/api/*` only. The built client is public files, and guarding them
 * would make the app unloadable from its own origin before the client could
 * tell anyone why; the rebinding defence lives on the API, where the data is.
 */
export function guard(origins: readonly string[] = []): MiddlewareHandler {
  const allowed = normalize(origins)
  return async (c, next) => {
    const origin = c.req.header('origin')
    if (origin !== undefined) {
      const lower = origin.toLowerCase()
      if (!LOOPBACK_ORIGIN.test(origin) && !allowed.some((a) => a.origin === lower)) {
        return c.json({ error: 'forbidden origin' }, 403)
      }
    }
    const host = c.req.header('host')
    if (host === undefined) return c.json({ error: 'forbidden host' }, 403)
    const lowerHost = host.toLowerCase()
    if (!LOOPBACK_HOST.test(host) && !allowed.some((a) => a.hosts.has(lowerHost))) {
      return c.json({ error: 'forbidden host' }, 403)
    }
    await next()
  }
}
