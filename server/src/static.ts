/**
 * Serving the built client alongside the API (public-deployment D8): path rules,
 * cache headers, and the composition `index.ts` wires. **No Hono routes** —
 * serving files is adapter-specific and the app must stay Node-portable (D1).
 * **Nothing here compresses**: the proxy in front of a public deployment owns
 * that, and a loopback install pays nothing for the transfer. Link previews
 * arrive the same way: the handler takes a `describe` function and never learns
 * what a library is (link-previews D1).
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
 * What an entry document says about the view its address names. Only the values
 * that **vary** with the view: `og:site_name` and `og:type` are invariant and
 * the built document carries them, so no consumer has to choose between two
 * answers for anything (link-previews D7).
 */
export interface Preview {
  title: string;
  description?: string;
  image?: string;
  imageType?: string;
  imageWidth?: number;
  imageHeight?: number;
  url?: string;
  card?: "summary" | "summary_large_image";
}

/**
 * An attribute value cannot end its own attribute, so a display name carrying a
 * quote is text rather than markup (link-previews D7).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pure, so the block is testable without a dist directory or a request. */
export function previewTags(p: Preview): string {
  const tags: string[] = [];
  const meta = (attr: "property" | "name", key: string, value: string) => {
    tags.push(`<meta ${attr}="${key}" content="${escapeHtml(value)}">`);
  };
  meta("property", "og:title", p.title);
  if (p.description !== undefined)
    meta("property", "og:description", p.description);
  if (p.image !== undefined) {
    meta("property", "og:image", p.image);
    if (p.imageType !== undefined)
      meta("property", "og:image:type", p.imageType);
    if (p.imageWidth !== undefined)
      meta("property", "og:image:width", String(p.imageWidth));
    if (p.imageHeight !== undefined)
      meta("property", "og:image:height", String(p.imageHeight));
  }
  if (p.url !== undefined) meta("property", "og:url", p.url);
  if (p.card !== undefined) meta("name", "twitter:card", p.card);
  return tags.join("");
}

/** One pair for the process: an annotation is not worth two allocations. */
const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

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
 *
 * `describe` annotates **entry documents only** with what their address names
 * (link-previews D1/D7); unset, every document is served as it was built.
 */
export function createStaticHandler(
  distDir: string,
  {
    intro,
    describe,
  }: {
    intro: boolean;
    describe?: (url: URL, headers: Headers) => Promise<Preview | null>;
  } = { intro: true },
): (req: Request) => Promise<Response | null> {
  const root = resolvePath(distDir);
  const indexPath = resolvePath(root, "index.html");
  /**
   * The resolved path, because the gate must refuse **every spelling that
   * reaches the file** — `/about.html/`, `/about.html/.` and `/about.html%2F`
   * all name it and none equals `"/about.html"`. Case-sensitive, like the disk.
   */
  const aboutPath = resolvePath(root, "about.html");

  /**
   * The **last** resort, not the resolver's: reaching this catch ships a document
   * with no varying tags at all, so a resolver falls back within itself rather
   * than throwing. A document with no `</head>` is served unchanged rather than
   * half-annotated (link-previews D7).
   */
  async function annotate(
    html: string,
    req: { url: URL; headers: Headers },
    resolve: (url: URL, headers: Headers) => Promise<Preview | null>,
  ): Promise<string | null> {
    try {
      const at = html.indexOf("</head>");
      if (at === -1) return null;
      const preview = await resolve(req.url, req.headers);
      if (preview === null) return null;
      return html.slice(0, at) + previewTags(preview) + html.slice(at);
    } catch {
      return null;
    }
  }

  /**
   * `entry` is the request context when the file is an **entry document** and
   * null otherwise: an asset is served immutably and a rewritten one would be
   * cached forever carrying one address's description (link-previews D7).
   */
  async function send(
    file: string,
    cacheControl: string,
    entry: { url: URL; headers: Headers } | null = null,
  ): Promise<Response | null> {
    try {
      if (!(await stat(file)).isFile()) return null;
    } catch {
      return null;
    }
    // A view, never a copy: `new Uint8Array(buf)` re-copies the bundle per request.
    const bytes = await readFile(file);
    let body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (entry !== null && describe !== undefined) {
      const annotated = await annotate(DECODER.decode(body), entry, describe);
      if (annotated !== null) body = ENCODER.encode(annotated);
    }
    return new Response(body, {
      headers: {
        "content-type": TYPES[extensionOf(file)] ?? "application/octet-stream",
        "cache-control": cacheControl,
      },
    });
  }

  return async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const { pathname } = url;
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
    // The URL the handler already built (link-previews D3): the origin fallback
    // needs the host it has parsed, so a malformed one has no new place to throw.
    const context = { url, headers: req.headers };
    if (candidate !== root) {
      const file = await send(
        candidate,
        normalized.startsWith("/assets/") ? IMMUTABLE : REVALIDATE,
        candidate === indexPath || candidate === aboutPath ? context : null,
      );
      if (file !== null) return file;
    }
    // The SPA fallback: where every shareable deep link lands (link-previews D2).
    return send(indexPath, REVALIDATE, context);
  };
}
