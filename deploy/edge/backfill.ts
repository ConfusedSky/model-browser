/**
 * Fills the edge store by GETting every stored thumbnail and every STL's GLB
 * through the public hostname, so the Worker does the storing and this script
 * never touches R2. A second pass over the same URLs is the check: a `filled`
 * answer only says the Worker tried, the put running after the response.
 *
 *   bun deploy/edge/backfill.ts [--host <url>] [--concurrency <n>] [--limit <n>] [--dry]
 *
 * Exits 0 only when every second-pass answer is a store `hit`; 2 on a usage
 * error.
 */
import type {
  DirEntry,
  DirListing,
  ThumbGetResponse,
} from "../../shared/types";
import { thumbImageUrl } from "../../client/src/api/thumbUrl";

/** Relative URLs for every byte the store could hold for one listing entry. */
export function urlsFor(entry: DirEntry): string[] {
  // Archive members never reach the store.
  if (entry.kind !== "model" || entry.path.includes("!")) return [];
  const urls: string[] = [];
  const thumb = entry.thumb;
  if (thumb !== undefined) {
    if (thumb.ao?.state === "hit")
      urls.push(thumbImageUrl(entry.path, entry.mtime, true, thumb.gen));
    if (thumb.noao?.state === "hit")
      urls.push(thumbImageUrl(entry.path, entry.mtime, false, thumb.gen));
  }
  if (entry.format === "stl")
    // The shape `ApiClient.fetchModelGlb` builds.
    urls.push(
      `/api/model.glb?path=${encodeURIComponent(entry.path)}&mtime=${entry.mtime}`,
    );
  return urls;
}

/** One listing's contribution to the walk: folders to list next, models to keep. */
export function step(listing: DirListing): {
  folders: string[];
  models: DirEntry[];
} {
  return {
    folders: listing.entries.filter((e) => e.kind === "dir").map((e) => e.path),
    models: listing.entries.filter((e) => e.kind === "model"),
  };
}

/** A run that cannot vouch for what it found; the message names the folder or model. */
export class BackfillError extends Error {}

export interface WalkOptions {
  fetchFn?: typeof fetch;
  /** How many times a `stale` listing is re-asked before the walk gives up. */
  retries?: number;
  backoffMs?: number;
}

export async function walk(
  host: string,
  { fetchFn = fetch, retries = 5, backoffMs = 1000 }: WalkOptions = {},
): Promise<DirEntry[]> {
  const list = async (folder: string): Promise<DirListing> => {
    let res: Response;
    try {
      res = await fetchFn(`${host}/api/dir?path=${encodeURIComponent(folder)}`);
    } catch (e) {
      throw new BackfillError(`${folder}: /api/dir failed: ${String(e)}`);
    }
    if (!res.ok)
      throw new BackfillError(`${folder}: /api/dir answered ${res.status}`);
    try {
      return (await res.json()) as DirListing;
    } catch {
      throw new BackfillError(
        `${folder}: /api/dir answered something not JSON`,
      );
    }
  };
  const models: DirEntry[] = [];
  const queue = ["/"];
  for (
    let folder = queue.shift();
    folder !== undefined;
    folder = queue.shift()
  ) {
    let listing = await list(folder);
    // A stale listing's annotations predate the revalidation it announces.
    for (let tries = 0; listing.stale === true; tries++) {
      if (tries === retries)
        throw new BackfillError(
          `${folder}: still stale after ${retries} re-asks; the server has not settled`,
        );
      await new Promise((r) => setTimeout(r, backoffMs * (tries + 1)));
      listing = await list(folder);
    }
    if (listing.truncated === true)
      throw new BackfillError(`${folder}: the listing was truncated`);
    const next = step(listing);
    queue.push(...next.folders);
    models.push(...next.models);
  }
  return models;
}

export interface Collected {
  urls: string[];
  /** Models the listing left unannotated, whose variants were asked for one by one. */
  lookedUp: number;
  /** Variants with no stored render to fill from: not asked for, and not a failure. */
  absent: { ao: number; noao: number };
}

/**
 * Every URL the models' stored bytes answer to. A listing annotates only what
 * the server has already remembered, so an entry without `thumb` may still have
 * a render on disk; `/api/thumb` is asked for each variant of those.
 */
export async function collect(
  host: string,
  models: DirEntry[],
  { fetchFn = fetch, concurrency = 2 } = {},
): Promise<Collected> {
  const absent = { ao: 0, noao: 0 };
  let lookedUp = 0;
  const lookup = async (m: DirEntry, ao: boolean) => {
    // `ApiClient.getThumb`'s shape with no known gen and `pixels=off`.
    const url = `${host}/api/thumb?path=${encodeURIComponent(m.path)}&mtime=${m.mtime}${ao ? "" : "&ao=off"}&pixels=off`;
    let res: Response;
    try {
      res = await fetchFn(url);
    } catch (e) {
      throw new BackfillError(`${m.path}: /api/thumb failed: ${String(e)}`);
    }
    if (!res.ok)
      throw new BackfillError(`${m.path}: /api/thumb answered ${res.status}`);
    let body: ThumbGetResponse;
    try {
      body = (await res.json()) as ThumbGetResponse;
    } catch {
      throw new BackfillError(
        `${m.path}: /api/thumb answered something not JSON`,
      );
    }
    // The route's own reading of an absent gen.
    return body.status === "hit" ? (body.gen ?? 0) : undefined;
  };
  const per = await pool(models, concurrency, async (m) => {
    if (m.path.includes("!")) return [];
    if (m.thumb !== undefined) {
      if (m.thumb.ao?.state !== "hit") absent.ao++;
      if (m.thumb.noao?.state !== "hit") absent.noao++;
      return urlsFor(m);
    }
    lookedUp++;
    const thumbs: string[] = [];
    for (const variant of ["ao", "noao"] as const) {
      const gen = await lookup(m, variant === "ao");
      if (gen === undefined) absent[variant]++;
      else thumbs.push(thumbImageUrl(m.path, m.mtime, variant === "ao", gen));
    }
    // Without `thumb`, `urlsFor` names the GLB alone.
    return [...thumbs, ...urlsFor(m)];
  });
  return { urls: per.flat(), lookedUp, absent };
}

export interface Answer {
  url: string;
  status: number | "error";
  store: string;
}

async function pool<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function get(host: string, url: string): Promise<Answer> {
  try {
    const res = await fetch(host + url);
    // Read to the end: the Worker's store is filled from the whole body.
    await res.arrayBuffer();
    return {
      url,
      status: res.status,
      store: res.headers.get("x-edge-store") ?? "none",
    };
  } catch {
    return { url, status: "error", store: "none" };
  }
}

function tally(keys: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const k of keys) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}

function report(label: string, answers: Answer[]): void {
  const stores = tally(answers.map((a) => a.store));
  const statuses = tally(answers.map((a) => String(a.status)));
  console.log(
    `${label}: ${answers.length} GETs; store ${JSON.stringify(stores)}; status ${JSON.stringify(statuses)}`,
  );
}

const USAGE =
  "usage: bun deploy/edge/backfill.ts [--host <url>] [--concurrency <n>] [--limit <n>] [--dry]";

export interface Options {
  host: string;
  concurrency: number;
  limit: number;
  dry: boolean;
}

export function parseArgs(
  argv: string[],
): { ok: true; options: Options } | { ok: false; error: string } {
  const options: Options = {
    host: "https://models.masamaeda.com",
    concurrency: 2,
    limit: Infinity,
    dry: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === "--dry") {
      options.dry = true;
      continue;
    }
    if (name !== "--host" && name !== "--concurrency" && name !== "--limit")
      return { ok: false, error: `unknown option "${name}"` };
    const v = argv[++i];
    if (v === undefined || v.startsWith("--"))
      return { ok: false, error: `${name} needs a value` };
    if (name === "--host") {
      options.host = v.replace(/\/$/, "");
      continue;
    }
    if (!/^[1-9][0-9]*$/.test(v))
      return {
        ok: false,
        error: `${name} needs an integer above 0, not "${v}"`,
      };
    options[name === "--limit" ? "limit" : "concurrency"] = Number(v);
  }
  return { ok: true, options };
}

const kindOf = (url: string) =>
  url.startsWith("/api/model.glb")
    ? "glb"
    : url.includes("&ao=off")
      ? "noao"
      : "ao";

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { host, concurrency, limit, dry } = parsed.options;
  let models: DirEntry[];
  let collected: Collected;
  try {
    models = await walk(host);
    collected = await collect(host, models, { concurrency });
  } catch (e) {
    if (!(e instanceof BackfillError)) throw e;
    console.error(`backfill failed: ${e.message}`);
    return 1;
  }
  const { lookedUp, absent } = collected;
  const all = collected.urls;
  const urls = all.slice(0, limit);
  console.log(
    `${host}: ${models.length} models, ${lookedUp} looked up, absent ${JSON.stringify(absent)}, ${all.length} URLs ${JSON.stringify(tally(all.map(kindOf)))}`,
  );
  if (urls.length < all.length)
    console.log(`limited to the first ${urls.length}`);
  if (urls.length === 0) {
    console.log("no URLs to fetch");
    return 1;
  }
  if (dry) return 0;
  report("pass 1", await pool(urls, concurrency, (u) => get(host, u)));
  const second = await pool(urls, concurrency, (u) => get(host, u));
  report("pass 2", second);
  const missed = second.filter((a) => a.store !== "hit");
  for (const a of missed)
    console.log(`not hit: ${a.store} ${a.status} ${a.url}`);
  return missed.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
