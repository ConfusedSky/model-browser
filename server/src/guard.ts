import type { MiddlewareHandler } from "hono";

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * One origin in the two shapes a request can name it. A `Host` may or may not
 * carry the scheme's default port — a proxy sends either — so both spellings are
 * held; an explicit non-default port is named by that spelling alone.
 */
interface AllowedOrigin {
  origin: string;
  hosts: ReadonlySet<string>;
}

/** Entries are already `scheme://host[:port]`: `config.ts` refuses the rest. */
function normalize(origins: readonly string[]): AllowedOrigin[] {
  return origins.map((raw) => {
    const url = new URL(raw);
    // `URL.origin` is the spelling a browser sends.
    const origin = url.origin.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const hosts = new Set<string>([url.host.toLowerCase()]);
    if (url.port === "")
      hosts.add(`${hostname}:${url.protocol === "https:" ? "443" : "80"}`);
    return { origin, hosts };
  });
}

/**
 * Same-origin guard for `/api/*` only — guarding the built client would make the
 * app unloadable from its own origin. Configured origins plus loopback, which is
 * always allowed (public-deployment D3/D8), so a local curl cannot reproduce a
 * proxy that rewrites `Host`. An absent `Origin` passes (curl, same-origin GETs)
 * and the `Host` test is what closes DNS rebinding; no-cors embeds send neither
 * and are left to `nosniff` and CORP. It stops other *sites*, never a visitor:
 * that is confinement (`library`) and refusal (`feature-report`).
 */
export function guard(origins: readonly string[] = []): MiddlewareHandler {
  const allowed = normalize(origins);
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      const lower = origin.toLowerCase();
      if (
        !LOOPBACK_ORIGIN.test(origin) &&
        !allowed.some((a) => a.origin === lower)
      ) {
        return c.json({ error: "forbidden origin" }, 403);
      }
    }
    const host = c.req.header("host");
    if (host === undefined) return c.json({ error: "forbidden host" }, 403);
    const lowerHost = host.toLowerCase();
    if (
      !LOOPBACK_HOST.test(host) &&
      !allowed.some((a) => a.hosts.has(lowerHost))
    ) {
      return c.json({ error: "forbidden host" }, 403);
    }
    await next();
  };
}
