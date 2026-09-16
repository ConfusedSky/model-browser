// The About page is a second document of the *build*, not a route
// (`landing-page` D2), so its existence rests on one object in
// `client/vite.config.ts`. Dropping that entry breaks nothing locally — Vite's
// dev server happily serves any `.html` under `client/` — and fails only on a
// deployment, where `/about.html` misses and `createStaticHandler`'s fallback
// answers the app's own document with a 200. That is an invisible failure, so
// it is asserted here instead.
//
// The config is **imported and its resolved object read**, where this cell used
// to read the file as text and match a regex over the body of `input`. The
// regex accepted `about.html` anywhere in that block, a commented-out entry
// included — so the single edit most likely to drop the page quietly was the
// one edit the cell could not see. The object cannot be fooled that way: a
// commented-out entry is simply not in it.
//
// Importing evaluates the config, `fileURLToPath` and both plugins with it.
// That is safe here and nowhere near as safe elsewhere: this file carries no
// `@vitest-environment` pragma, so it runs in vitest's default node
// environment, where the global `URL` is Node's own. Under happy-dom it is not,
// and `fileURLToPath` refuses the object it builds — the hazard
// client/test/CLAUDE.md records, which is why the component cells still read
// their sources through `?raw`. The specifier is extensionless because
// `allowImportingTsExtensions` is off in this workspace's tsconfig.
import { describe, expect, it } from "vitest";
import config from "../vite.config";

/**
 * `rollupOptions.input` in the named-entry form this config uses. Rollup also
 * accepts a bare string and an array, which name entries without keying them;
 * either would mean the config was rewritten into a shape these assertions
 * cannot speak about, so it throws rather than reporting a missing entry.
 */
function entries(): Record<string, string> {
  const input = config.build?.rollupOptions?.input;
  if (input === undefined || typeof input === "string" || Array.isArray(input))
    throw new Error("rollupOptions.input is not the named-entry object form");
  return input;
}

/** The document an entry path names — what Vite keeps as the emitted asset's
 *  own file name, and therefore what the server answers a request for. */
function documentOf(entry: string | undefined): string | undefined {
  return entry?.split("/").pop();
}

describe("the client build has two entries", () => {
  it("resolves an entry object at all", () => {
    // Guards the mechanism before the assertion that rests on it: were the
    // import to answer something other than an evaluated config, the cell
    // below would fail for a reason that has nothing to do with the entries.
    expect(Object.keys(entries()).sort()).toEqual(["about", "main"]);
  });

  it("names index.html and about.html as those entries", () => {
    expect(documentOf(entries().about)).toBe("about.html");
    expect(documentOf(entries().main)).toBe("index.html");
  });
});
