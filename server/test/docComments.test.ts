import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A doc comment must sit on the thing it documents.
 *
 * Only the last of several stacked blocks reaches a hover, and a block cut off
 * from its declaration by a blank line documents nothing — both drift in
 * silently, and both were found in this repository by reading rather than by
 * any check.
 */
const ROOTS = ["client/src", "server/src", "shared", "scripts"];
const repo = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("every doc comment sits on a declaration", () => {
  it("is followed by code, not by a blank line or another doc comment", () => {
    const stranded: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(join(repo, root))) {
        const lines = readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]!.trim().startsWith("/**")) continue;
          // A module header is the one block with nothing but blank lines above
          // it; its subject is the file, so the blank line under it is right.
          const header = lines.slice(0, i).every((l) => l.trim() === "");
          while (i < lines.length && !lines[i]!.includes("*/")) i++;
          if (header) continue;
          const next = (lines[i + 1] ?? "").trim();
          if (next === "" || next.startsWith("/**")) {
            stranded.push(
              `${file.slice(repo.length)}:${i + 1} — followed by ` +
                (next === "" ? "a blank line" : "another doc comment"),
            );
          }
        }
      }
    }
    expect(stranded).toEqual([]);
  });
});
