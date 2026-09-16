/**
 * Prove that every example query the introduction offers still answers on the
 * deployment it ships to (`landing-page` D9). The corpus moves under the
 * queries, so this belongs at deploy time against the live origin.
 *
 *   bun run scripts/check-example-queries.ts <origin>
 *
 * It asks under **the visitor's options** — `TUNING_DEFAULTS`, imported, so a
 * query clearing the index's floor but not the client's fails here rather than
 * on a visitor's screen — and sends no `path`. Run it from the developer
 * machine: the box has no Bun outside the container.
 */

import { pathToFileURL } from "node:url";
import { EXAMPLE_QUERIES } from "../shared/exampleQueries";
import { TUNING_DEFAULTS } from "../client/src/lib/searchOptions";

export const USAGE = "usage: bun run scripts/check-example-queries.ts <origin>";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CheckResult {
  /** Asked successfully, and the grid would be empty. */
  dead: string[];
  /** Never answered: a non-2xx status, or a request that threw. */
  failed: string[];
  /** How many entries each asked query found — a chip's headroom before it dies, and how the `EXAMPLE_QUERIES` sweep is re-run. */
  counts: { text: string; entries: number }[];
}

/**
 * Each query as the body a chip's click sends, **sequentially**: the box runs
 * SigLIP beside the app, so firing them at once would make this check the
 * reason the demo was slow. Dead and failed are separate lists because their
 * remedies differ — replace the query, or go look at the origin.
 */
export async function checkExampleQueries(
  origin: string,
  queries: readonly string[],
  fetchFn: FetchLike = fetch,
): Promise<CheckResult> {
  const dead: string[] = [];
  const failed: string[] = [];
  const counts: { text: string; entries: number }[] = [];
  for (const text of queries) {
    let entries: unknown;
    try {
      const res = await fetchFn(`${origin}/api/semantic`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...TUNING_DEFAULTS }),
      });
      if (!res.ok) {
        failed.push(text);
        continue;
      }
      const body: unknown = await res.json();
      entries = (body as { entries?: unknown } | null)?.entries;
    } catch {
      failed.push(text);
      continue;
    }
    // A 200 with no `entries` array describes an empty grid too, so it counts
    // as 0 rather than passing for lack of a length to read.
    const found = Array.isArray(entries) ? entries.length : 0;
    counts.push({ text, entries: found });
    if (found === 0) dead.push(text);
  }
  return { dead, failed, counts };
}

/** One positional origin; no flags, so a second argument is a mistake. */
export function parseArgs(argv: string[]): { origin: string } {
  if (argv.length !== 1) throw new Error(USAGE);
  const origin = argv[0];
  if (origin === undefined || origin === "" || origin.startsWith("-"))
    throw new Error(USAGE);
  return { origin };
}

// Run only when invoked directly, so the core above can be imported by the
// suite — the same guard `bake-demo.ts` and `gen-overrides.ts` use.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let origin: string | null = null;
  try {
    origin = parseArgs(process.argv.slice(2)).origin;
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const named = origin;
  checkExampleQueries(named, EXAMPLE_QUERIES)
    .then(({ dead, failed, counts }) => {
      // Always, pass or fail: when one chip dies, the survivors' headroom is
      // the thing to look at.
      for (const { text, entries } of counts)
        console.log(`${String(entries).padStart(3)}  ${text}`);
      if (dead.length === 0 && failed.length === 0) {
        console.log(
          `${EXAMPLE_QUERIES.length} example queries answer on ${named}`,
        );
        return;
      }
      // Prefixed by kind of trouble: whoever just deployed reads these, and
      // each line is a thing to do.
      for (const q of dead) console.error(`dead: ${q}`);
      for (const q of failed) console.error(`failed: ${q}`);
      process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
