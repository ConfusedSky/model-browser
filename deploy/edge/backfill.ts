/**
 * Fills the edge store by GETting every stored thumbnail and every STL's GLB
 * through the public hostname, so the Worker does the storing and this script
 * never touches R2. A second pass over the same URLs is the check: a `filled`
 * answer only says the Worker tried, the put running after the response.
 *
 *   bun deploy/edge/backfill.ts [--host <url>] [--concurrency <n>] [--dry] [--limit <n>]
 *
 * Exits 0 only when every second-pass answer is a store `hit`.
 */
import type { DirEntry, DirListing } from "../../shared/types";
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

export async function walk(host: string): Promise<DirEntry[]> {
  const models: DirEntry[] = [];
  const queue = ["/"];
  for (
    let folder = queue.shift();
    folder !== undefined;
    folder = queue.shift()
  ) {
    const res = await fetch(
      `${host}/api/dir?path=${encodeURIComponent(folder)}`,
    );
    if (!res.ok) throw new Error(`${folder}: /api/dir answered ${res.status}`);
    const next = step((await res.json()) as DirListing);
    queue.push(...next.folders);
    models.push(...next.models);
  }
  return models;
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

function tally(answers: Answer[], key: (a: Answer) => string) {
  const counts: Record<string, number> = {};
  for (const a of answers) counts[key(a)] = (counts[key(a)] ?? 0) + 1;
  return counts;
}

function report(label: string, answers: Answer[]): void {
  console.log(
    `${label}: ${answers.length} GETs; store ${JSON.stringify(tally(answers, (a) => a.store))}; status ${JSON.stringify(tally(answers, (a) => String(a.status)))}`,
  );
}

function args(argv: string[]) {
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    host: (opt("--host") ?? "https://models.masamaeda.com").replace(/\/$/, ""),
    concurrency: Number(opt("--concurrency") ?? 2),
    limit: opt("--limit") === undefined ? Infinity : Number(opt("--limit")),
    dry: argv.includes("--dry"),
  };
}

async function main(): Promise<number> {
  const { host, concurrency, limit, dry } = args(process.argv.slice(2));
  const models = await walk(host);
  const urls = models.flatMap(urlsFor);
  const kinds = tally(
    urls.map((url) => ({ url, status: 0, store: "" })),
    (a) =>
      a.url.startsWith("/api/model.glb")
        ? "glb"
        : a.url.includes("&ao=off")
          ? "noao"
          : "ao",
  );
  console.log(
    `${host}: ${models.length} models, ${urls.length} URLs ${JSON.stringify(kinds)}`,
  );
  if (dry) return 0;
  const chosen = urls.slice(0, limit);
  if (chosen.length < urls.length)
    console.log(`limited to the first ${chosen.length}`);
  report("pass 1", await pool(chosen, concurrency, (u) => get(host, u)));
  const second = await pool(chosen, concurrency, (u) => get(host, u));
  report("pass 2", second);
  const missed = second.filter((a) => a.store !== "hit");
  for (const a of missed)
    console.log(`not hit: ${a.store} ${a.status} ${a.url}`);
  return missed.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
