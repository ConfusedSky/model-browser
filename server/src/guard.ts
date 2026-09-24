import type { MiddlewareHandler } from "hono";

/**
 * What loopback means, in the two shapes a request names it. Names under
 * `.localhost` are included because RFC 6761 §6.3 reserves that TLD to loopback
 * and browsers resolve it there with no DNS lookup, so `build-a.localhost` is
 * this machine and nothing else can claim it. The anchors carry the safety: `$`
 * keeps `localhost.evil.com` out — the name must end at `localhost` — and `^`
 * with the dot each label ends in keeps `notlocalhost` out, since the word can
 * only be reached from the start of the string or across a dot. The `i` is
 * because DNS names are case-insensitive.
 */
const LOOPBACK_ORIGIN =
  /^https?:\/\/(([a-z0-9-]+\.)*localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_HOST =
  /^(([a-z0-9-]+\.)*localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Loopback in the `scheme://host[:port]` spelling. Exported so the guard's rule
 * and the preview resolver's "not a public origin" test cannot drift apart
 * (link-previews D3).
 */
export function isLoopbackOrigin(origin: string): boolean {
  return LOOPBACK_ORIGIN.test(origin);
}

/**
 * One origin in the two shapes a request can name it. A `Host` may or may not
 * carry the scheme's default port — a proxy sends either — so both spellings are
 * held; an explicit non-default port is named by that spelling alone.
 */
export interface AllowedOrigin {
  origin: string;
  hosts: ReadonlySet<string>;
}

/** Entries are already `scheme://host[:port]`: `config.ts` refuses the rest. */
export function normalize(origins: readonly string[]): AllowedOrigin[] {
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
 * The `Host` rule, over an already-normalised allowlist: loopback, which is
 * always allowed, plus the hosts the configured origins name. The entry document
 * is served under no guard at all, so its preview resolver applies this itself
 * rather than describing the library to a rebound name (link-previews D6).
 */
export function isAllowedHost(
  host: string,
  allowed: readonly AllowedOrigin[],
): boolean {
  if (LOOPBACK_HOST.test(host)) return true;
  const lower = host.toLowerCase();
  return allowed.some((a) => a.hosts.has(lower));
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
        !isLoopbackOrigin(origin) &&
        !allowed.some((a) => a.origin === lower)
      ) {
        return c.json({ error: "forbidden origin" }, 403);
      }
    }
    const host = c.req.header("host");
    if (host === undefined) return c.json({ error: "forbidden host" }, 403);
    if (!isAllowedHost(host, allowed)) {
      return c.json({ error: "forbidden host" }, 403);
    }
    await next();
  };
}
