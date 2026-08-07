import type { MiddlewareHandler } from 'hono'

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Same-origin guard for every /api/* route. Localhost binding alone is not a
 * threat model: any open web page can fetch a localhost port, and this server
 * reads arbitrary local paths as the user.
 *
 * - Non-loopback `Origin` → refused. Absent Origin is allowed (curl, tests,
 *   same-origin GETs); DNS rebinding without an Origin is caught by the Host
 *   check below.
 * - Non-loopback `Host` → refused (closes DNS rebinding).
 * - CORS headers are never emitted.
 * - No-cors embeds (`<img src>`, `<script src>`) send no Origin; they are
 *   neutralized by `application/octet-stream` + `nosniff` on model bytes.
 */
export const guard: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin')
  if (origin !== undefined && !LOOPBACK_ORIGIN.test(origin)) {
    return c.json({ error: 'forbidden origin' }, 403)
  }
  const host = c.req.header('host')
  if (host === undefined || !LOOPBACK_HOST.test(host)) {
    return c.json({ error: 'forbidden host' }, 403)
  }
  await next()
}
