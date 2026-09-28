import { THUMB_MIME } from "../../shared/types";

// Pure on purpose: `worker.ts` is the only file that touches Workers APIs, so
// everything that can be wrong is here and runs under vitest (design D10).

export type Kind = "thumb" | "mesh";

export type Classified =
  | { action: "pass"; reason: string }
  | { action: "store"; kind: Kind; key: string };

interface HeaderReader {
  get(name: string): string | null;
}

export interface ClassifyInput {
  method: string;
  url: string;
  headers: HeaderReader;
  continent: string | null | undefined;
  thumbEpoch: string;
  meshEpoch: string;
}

// A constant, not a variable: widening it is a decision that needs measurement (D5).
const STORE_CONTINENT = "NA";

const CONDITIONAL = [
  "range",
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
  "if-range",
];

const ROUTES: Record<string, { kind: Kind; params: string[] }> = {
  "/api/thumb/image": { kind: "thumb", params: ["path", "mtime", "gen", "ao"] },
  "/api/model.glb": { kind: "mesh", params: ["path", "mtime"] },
};

// R2's key limit.
const MAX_KEY_BYTES = 1024;

// The origin refuses deeper paths (`MAX_COMPONENTS` in the server's `tooLong`);
// copied rather than imported, since that module brings Node's filesystem with it.
const MAX_COMPONENTS = 256;

const pass = (reason: string): Classified => ({ action: "pass", reason });

/**
 * Only the spelling `canonicalLibPath` would itself produce is keyed; anything
 * else passes through rather than being normalised here (D3).
 */
function canonicalPath(path: string): boolean {
  if (!path.startsWith("/") || path.endsWith("/")) return false;
  if (path.includes("!") || path.includes("\0") || path.includes("//"))
    return false;
  const segments = path.split("/");
  if (segments.length - 1 > MAX_COMPONENTS) return false;
  return !segments.some((s) => s === "." || s === "..");
}

export function classify(input: ClassifyInput): Classified {
  if (input.method !== "GET") return pass("method");
  if (input.continent !== STORE_CONTINENT) return pass("continent");
  if (CONDITIONAL.some((h) => input.headers.get(h) !== null))
    return pass("conditional");

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return pass("url");
  }
  const route = ROUTES[url.pathname];
  if (route === undefined) return pass("route");

  // URLSearchParams turns an undecodable `%XX` run into U+FFFD where the origin
  // keeps it raw, so two origin files could otherwise share one key.
  try {
    decodeURIComponent(url.search.slice(1).replace(/\+/g, " "));
  } catch {
    return pass("encoding");
  }

  const q = new Map<string, string>();
  for (const [k, v] of url.searchParams) {
    if (!route.params.includes(k) || q.has(k)) return pass("param");
    q.set(k, v);
  }

  const rawMtime = q.get("mtime");
  if (rawMtime === undefined) return pass("version");
  const mtimeNum = Number(rawMtime);
  // `Number("")` is 0, so the empty spelling would name version zero.
  if (rawMtime.trim() === "" || !Number.isFinite(mtimeNum))
    return pass("version");
  const mtime = String(mtimeNum);

  const path = q.get("path");
  if (path === undefined || !canonicalPath(path)) return pass("path");

  let key: string;
  if (route.kind === "thumb") {
    // Verbatim: the origin compares `gen` as text, so `1.0` is another request.
    const gen = q.get("gen");
    if (gen === undefined || !/^[0-9]+$/.test(gen)) return pass("version");
    const ao = q.get("ao");
    if (ao !== undefined && ao !== "on" && ao !== "off") return pass("ao");
    const suffix = ao === "off" ? ".noao.webp" : ".webp";
    key = `${input.thumbEpoch}/t${path}/${mtime}/${gen}${suffix}`;
  } else {
    key = `${input.meshEpoch}/m${path}/${mtime}.glb`;
  }

  if (new TextEncoder().encode(key).length > MAX_KEY_BYTES)
    return pass("keylen");
  return { action: "store", kind: route.kind, key };
}

export interface Stored {
  contentType: string;
  cacheControl: string;
  custom: Record<string, string>;
}

export const STORE_MAX_BYTES = 32 * 1024 * 1024;

const CONTENT_TYPE: Record<Kind, string> = {
  thumb: THUMB_MIME,
  mesh: "application/octet-stream",
};

const CUSTOM = [
  "etag",
  "x-content-type-options",
  "cross-origin-resource-policy",
];

/** Only what the origin pinned as this version's bytes is ever stored (D2, D4). */
export function storable(
  kind: Kind,
  status: number,
  headers: HeaderReader,
): Stored | null {
  if (status !== 200) return null;
  const cacheControl = headers.get("cache-control");
  if (
    cacheControl === null ||
    !cacheControl.split(",").some((d) => d.trim().toLowerCase() === "immutable")
  )
    return null;
  const contentType = headers.get("content-type");
  if (
    contentType === null ||
    contentType.split(";")[0]!.trim().toLowerCase() !== CONTENT_TYPE[kind]
  )
    return null;
  const length = headers.get("content-length");
  if (length === null || !/^[0-9]+$/.test(length)) return null;
  if (Number(length) > STORE_MAX_BYTES) return null;

  const custom: Record<string, string> = {};
  for (const name of CUSTOM) {
    const v = headers.get(name);
    if (v !== null) custom[name] = v;
  }
  return { contentType, cacheControl, custom };
}

/** An R2 stream carries no length of its own, so it comes from the object's size. */
export function replay(stored: Stored, size: number): Record<string, string> {
  return {
    "content-type": stored.contentType,
    "cache-control": stored.cacheControl,
    ...stored.custom,
    "content-length": String(size),
  };
}
