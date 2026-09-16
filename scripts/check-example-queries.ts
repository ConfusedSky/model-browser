/**
 * Prove that every example query the introduction offers still answers on the
 * deployment it ships to (`landing-page` D9).
 *
 *   bun run scripts/check-example-queries.ts <origin>
 *
 * A dead chip is the worst first impression this app can make: a visitor's
 * first click on a public demo returning an empty grid. The corpus moves under
 * the queries — a re-bake, a re-embed, a different collection root — so the
 * proof belongs at deploy time against the live origin, not in a suite that
 * runs against no index at all.
 *
 * It asks under **the visitor's options**, not the index's: `TUNING_DEFAULTS`
 * is imported rather than restated, so a query that clears the index's own
 * floor but not `minScore: 0.1` fails here instead of showing a visitor an
 * empty grid. No `path` is sent — the chips run at the library's top.
 *
 * Node APIs only in the core below (`fetch`), though the entry may use Bun: the
 * core is exported and exercised by `server/test/checkExampleQueries.test.ts`,
 * exactly as `bake-demo.ts`'s is by `bakeDemo.test.ts`. It runs the box's
 * origin from the **developer machine** — the box has no Bun outside the
 * container, and the guard admits an `Origin`-less POST with the right `Host`.
 */

import { pathToFileURL } from "node:url";
import { EXAMPLE_QUERIES } from "../shared/exampleQueries";
import { TUNING_DEFAULTS } from "../client/src/lib/searchOptions";

export const USAGE = "usage: bun run scripts/check-example-queries.ts <origin>";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** What a run found: the queries that answered nothing, the ones that could not be asked, and how much every asked one found. */
export interface CheckResult {
  /** Asked successfully, and the grid would be empty — `entries` came back with nothing in it. */
  dead: string[];
  /** Never answered: a non-2xx status, or a request that threw. */
  failed: string[];
  /**
   * One line per query that was asked and answered, in the order asked, with
   * the number of entries the visitor's grid would have held.
   *
   * It exists so the sweep behind `EXAMPLE_QUERIES`' chosen list can be
   * **re-run** rather than re-typed (the repo's rule about measurements). That
   * comment records counts from 2026-09-15 and told a reader to re-run them
   * with this script, which until now printed only what had died — so the
   * figures it points at could not come back. A count is also the headroom a
   * dead chip would have to cross: 60 is `TUNING_DEFAULTS`' ceiling, 10 is one
   * re-bake away from trouble, and neither is visible in a pass/fail line.
   */
  counts: { text: string; entries: number }[];
}

/**
 * Every query in `queries` against `<origin>/api/semantic`, as the body a
 * chip's click sends: `{ text, ...TUNING_DEFAULTS }`.
 *
 * **Sequentially**, deliberately. The box is a 2-vCPU host running SigLIP
 * beside the app, and every query fired at once is a load spike that would make
 * this check the reason the demo was slow while it ran. The six round trips
 * `EXAMPLE_QUERIES` asks for, in series, are a few seconds.
 *
 * A failure is never a dead query: the two lists are separate because they have
 * different remedies — a dead query is replaced in `shared/exampleQueries.ts`,
 * a failed one means the origin or the index is not answering at all.
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
    // A 200 that carries no `entries` array is not a listing this client could
    // draw either, so it counts as dead rather than passing for lack of a
    // length to read.
    // A 200 whose body carries no array counted as 0: the grid it describes is
    // empty either way, and a count the answer did not contain is not a
    // measurement to report.
    const found = Array.isArray(entries) ? entries.length : 0;
    counts.push({ text, entries: found });
    if (found === 0) dead.push(text);
  }
  return { dead, failed, counts };
}

/** One positional origin, required — no flags, so a second argument is a mistake rather than an origin. */
export function parseArgs(argv: string[]): { origin: string } {
  if (argv.length !== 1) throw new Error(USAGE);
  const origin = argv[0];
  if (origin === undefined || origin === "" || origin.startsWith("-"))
    throw new Error(USAGE);
  return { origin };
}

// Run only when invoked directly, so the core above can be imported by the
// suite (`bake-demo.ts`'s guard, `gen-overrides.ts`'s before it).
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
      // Always, pass or fail: the counts are the sweep `shared/exampleQueries.ts`
      // cites, and a run that printed them only on success would be unable to
      // say how close the survivors were on the day one chip died.
      for (const { text, entries } of counts)
        console.log(`${String(entries).padStart(3)}  ${text}`);
      if (dead.length === 0 && failed.length === 0) {
        console.log(
          `${EXAMPLE_QUERIES.length} example queries answer on ${named}`,
        );
        return;
      }
      // One query per line, prefixed by which kind of trouble it is: the output
      // is read by whoever just deployed, and each line is a thing to do.
      for (const q of dead) console.error(`dead: ${q}`);
      for (const q of failed) console.error(`failed: ${q}`);
      process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
