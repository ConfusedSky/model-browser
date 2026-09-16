/**
 * Serving the built client alongside the API (public-deployment D8): path rules,
 * cache headers, and the composition `index.ts` wires. **No Hono routes** —
 * serving files is adapter-specific and the app must stay Node-portable (D1).
 * **Nothing here compresses**: the proxy in front of a public deployment owns
 * that, and a loopback install pays nothing for the transfer.
 */

import { readFile, stat } from "node:fs/promises";
import { posix, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The API prefix is **reserved**, case-insensitively: a request under it that
 * names no route must 404 rather than fall through to the entry document, or a
 * bad request comes back as HTML with a 200 and the bug is invisible (D8).
 */
export function isApiRequest(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return p === "/api" || p.startsWith("/api/");
}

/** One function so the composition is testable rather than entry-point lines. */
export async function route(
  req: Request,
  api: (req: Request) => Response | Promise<Response>,
  client: ((req: Request) => Promise<Response | null>) | null,
): Promise<Response> {
  if (client === null || isApiRequest(new URL(req.url).pathname))
    return api(req);
  return (await client(req)) ?? (await api(req));
}

/** `client/dist`, or `MODEL_BROWSER_CLIENT`. `env` is a parameter, as in `xdg.ts`. */
export function clientDist(env: NodeJS.ProcessEnv): string {
  const override = env.MODEL_BROWSER_CLIENT;
  if (override !== undefined && override !== "") return override;
  return fileURLToPath(new URL("../../client/dist", import.meta.url));
}

/** Content types for what a Vite build actually emits. */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

/**
 * Assets are content-hashed, so a changed file is a changed name. The entry
 * document is the one name that does not change, and names the new assets.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

/**
 * Serves `distDir`, or `null` when there is nothing to serve. A path matching no
 * file gets the entry document, so a cold deep link resolves in the client.
 *
 * One gate: `/about.html` is the introduction's document (`landing-page` D2), so
 * a deployment with `intro` off withholds it — the build ships it either way.
 */
export function createStaticHandler(
  distDir: string,
  { intro }: { intro: boolean } = { intro: true },
): (req: Request) => Promise<Response | null> {
  const root = resolvePath(distDir);
  const indexPath = resolvePath(root, "index.html");
  /**
   * The resolved path, because the gate must refuse **every spelling that
   * reaches the file** — `/about.html/`, `/about.html/.` and `/about.html%2F`
   * all name it and none equals `"/about.html"`. Case-sensitive, like the disk.
   */
  const aboutPath = resolvePath(root, "about.html");

  async function send(
    file: string,
    cacheControl: string,
  ): Promise<Response | null> {
    try {
      if (!(await stat(file)).isFile()) return null;
    } catch {
      return null;
    }
    // A view, never a copy: `new Uint8Array(buf)` re-copies the bundle per request.
    const bytes = await readFile(file);
    return new Response(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      {
        headers: {
          "content-type":
            TYPES[extensionOf(file)] ?? "application/octet-stream",
          "cache-control": cacheControl,
        },
      },
    );
  }

  return async function handle(req: Request): Promise<Response | null> {
    const { pathname } = new URL(req.url);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    // A `..` here survived URL normalisation, so it arrived percent-encoded: a
    // traversal attempt, refused rather than normalised away. A NUL likewise —
    // `node:fs` throws on one, and the 500 would name this machine.
    const parts = decoded.split("/");
    if (parts.includes("..") || decoded.includes("\0")) {
      return new Response("forbidden", { status: 403 });
    }
    const normalized = posix.normalize(decoded);
    const candidate = resolvePath(root, `.${normalized}`);
    // Belt and braces, and the one check a later rule cannot weaken by accident.
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      return new Response("forbidden", { status: 403 });
    }
    // On the resolved candidate, never on how the request spelled it.
    if (!intro && candidate === aboutPath) {
      return new Response("not found", { status: 404 });
    }
    if (candidate !== root) {
      const file = await send(
        candidate,
        normalized.startsWith("/assets/") ? IMMUTABLE : REVALIDATE,
      );
      if (file !== null) return file;
    }
    return send(indexPath, REVALIDATE);
  };
}
