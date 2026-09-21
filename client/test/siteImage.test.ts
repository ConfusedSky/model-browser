// A missing site image fails silently in the worst way: the resolver advertises
// `/og.png`, the SPA fallback answers the crawler with the app's HTML as a 200,
// and nothing in the build notices. Globbed, not named: the extension is the
// resolver's decision alone, and two images here means one is stale.
//
// No `@vitest-environment` pragma: happy-dom replaces global `URL`, and
// `fileURLToPath(new URL(...))` throws under it (client/test/CLAUDE.md).
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

/** Vite copies `public/` to the dist root verbatim, so a name here is a URL there. */
function siteImages(): string[] {
  return readdirSync(PUBLIC_DIR).filter((name) => name.startsWith("og."));
}

describe("the site image ships with the client", () => {
  it("has exactly one og.* in client/public", () => {
    expect(siteImages()).toHaveLength(1);
  });

  it("is not an empty file", () => {
    const [name] = siteImages();
    expect(name).toBeDefined();
    expect(statSync(`${PUBLIC_DIR}/${name}`).size).toBeGreaterThan(0);
  });
});
