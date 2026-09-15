import { describe, expect, it } from "vitest";
import {
  type FetchLike,
  USAGE,
  checkExampleQueries,
  parseArgs,
} from "../../scripts/check-example-queries";
import { TUNING_DEFAULTS } from "../../client/src/lib/searchOptions";

/**
 * The example-query check's core (`landing-page` 2.2), exercised as a function
 * against a fake `fetch` the way `bakeDemo.test.ts` exercises the bake driver's.
 *
 * What a cell here can pin is the **judgement**: which answer means dead, which
 * means failed, and what the request carries. Whether a particular phrase finds
 * a dragon is the live index's business and the script's own run against the
 * public origin — a suite that asserted it would be asserting the corpus.
 */

const ORIGIN = "https://demo.example";

/**
 * A fake `/api/semantic` recording every request, answering a listing of one
 * entry by default — the alive case — with per-query exceptions: `empty`
 * answers `{ entries: [] }` and `status` answers a failure code.
 */
function fakeIndex(
  opts: { empty?: string[]; status?: Record<string, number> } = {},
) {
  const sent: {
    url: string;
    body: { text?: string; top?: number; minScore?: number; path?: string };
  }[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { text?: string };
    sent.push({ url: input, body: body as (typeof sent)[number]["body"] });
    expect(init?.method).toBe("POST");
    const text = body.text ?? "";
    const status = opts.status?.[text];
    if (status !== undefined)
      return new Response("the index fell over", { status });
    const entries =
      opts.empty?.includes(text) === true
        ? []
        : [{ path: `/kit/${text}.stl`, name: "a model" }];
    return new Response(JSON.stringify({ path: "/", entries }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { sent, fetchFn };
}

const THREE = ["a dragon", "a treasure chest", "a stone golem"];

describe("checkExampleQueries", () => {
  it("names the query whose answer holds no entries, and only that one", async () => {
    const { fetchFn } = fakeIndex({ empty: ["a treasure chest"] });
    // The visitor's floor is what it is asked under, so "answered nothing"
    // here means the grid the visitor would have seen was empty — which is the
    // whole failure this check exists to catch.
    await expect(checkExampleQueries(ORIGIN, THREE, fetchFn)).resolves.toEqual({
      dead: ["a treasure chest"],
      failed: [],
    });
  });

  it("names a query the origin refused as failed, never as dead", async () => {
    // Two remedies, so two lists: a dead query is replaced in the module, a
    // failed one means the origin or its index is not answering at all.
    const { fetchFn } = fakeIndex({ status: { "a stone golem": 500 } });
    await expect(checkExampleQueries(ORIGIN, THREE, fetchFn)).resolves.toEqual({
      dead: [],
      failed: ["a stone golem"],
    });
  });

  it("counts a thrown request as failed too, and asks the rest anyway", async () => {
    // A connection refused mid-run: the remaining queries are still asked, so
    // one unreachable moment does not hide every other query's state.
    const { sent, fetchFn } = fakeIndex();
    const flaky: FetchLike = async (input, init) => {
      const { text } = JSON.parse(String(init?.body)) as { text?: string };
      if (text === "a dragon") throw new TypeError("fetch failed");
      return fetchFn(input, init);
    };
    await expect(checkExampleQueries(ORIGIN, THREE, flaky)).resolves.toEqual({
      dead: [],
      failed: ["a dragon"],
    });
    expect(sent.map((s) => s.body.text)).toEqual([
      "a treasure chest",
      "a stone golem",
    ]);
  });

  it("sends each query to /api/semantic under the visitor’s own options, and no path", async () => {
    const { sent, fetchFn } = fakeIndex();
    await checkExampleQueries(ORIGIN, THREE, fetchFn);
    expect(sent.map((s) => s.url)).toEqual(
      Array(3).fill(`${ORIGIN}/api/semantic`),
    );
    expect(sent.map((s) => s.body.text)).toEqual(THREE);
    for (const { body } of sent) {
      // The bounds the grid is drawn under, imported and never restated: a
      // query that clears the index's own looser floor but not this one would
      // otherwise pass the check and show a visitor an empty grid.
      expect(body.minScore).toBe(TUNING_DEFAULTS.minScore);
      expect(body.top).toBe(TUNING_DEFAULTS.top);
      expect(body).toEqual({ text: body.text, ...TUNING_DEFAULTS });
      // The chips run at the library's top, so no scope is sent at all.
      expect("path" in body).toBe(false);
    }
  });

  it("answers both lists empty when every query is alive", async () => {
    const { fetchFn } = fakeIndex();
    await expect(checkExampleQueries(ORIGIN, THREE, fetchFn)).resolves.toEqual({
      dead: [],
      failed: [],
    });
  });
});

describe("the script’s argument", () => {
  it("takes exactly one positional origin", () => {
    expect(parseArgs(["https://models.masamaeda.com"])).toEqual({
      origin: "https://models.masamaeda.com",
    });
    for (const argv of [[], ["a", "b"], [""], ["--origin"]]) {
      expect(() => parseArgs(argv)).toThrow(USAGE);
    }
  });
});
