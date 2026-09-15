import { describe, expect, it } from "vitest";
import { EXAMPLE_QUERIES } from "../../shared/exampleQueries";
import { SEARCH_TEXT_MAX } from "../../shared/types";

/**
 * The example queries the introduction offers (`landing-page` 2.1) — the one
 * module the banner, the placeholder and the deploy-time check all read.
 *
 * What a cell can hold is the **shape**. Whether a phrase still finds anything
 * is the live corpus's business and is proved by
 * `scripts/check-example-queries.ts` against a named origin (D9): a suite that
 * asserted a hit would be asserting the index, which no test here can reach.
 */
describe("EXAMPLE_QUERIES", () => {
  it("is a non-empty list", () => {
    // An empty list would draw a banner with no chips on it and a placeholder
    // that cycles through nothing — both of which render without complaint.
    expect(EXAMPLE_QUERIES.length).toBeGreaterThan(0);
  });

  it("holds no duplicates", () => {
    // The surprise action picks uniformly, so a repeated phrase is quietly
    // twice as likely as the rest, and two identical chips read as a bug.
    expect(new Set(EXAMPLE_QUERIES).size).toBe(EXAMPLE_QUERIES.length);
  });

  it("holds only trimmed, non-empty phrases", () => {
    // A chip's text is submitted verbatim, and `/api/semantic` refuses a text
    // that is empty once trimmed — so a stray space is a 400 at the click.
    for (const q of EXAMPLE_QUERIES) {
      expect(q).not.toBe("");
      expect(q.trim()).toBe(q);
    }
  });

  it("holds nothing longer than the search input accepts", () => {
    // The bound the route refuses past, imported rather than restated — a chip
    // must submit what a visitor could have typed.
    for (const q of EXAMPLE_QUERIES) {
      expect(q.length).toBeLessThanOrEqual(SEARCH_TEXT_MAX);
    }
  });
});
