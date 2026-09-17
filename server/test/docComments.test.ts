import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A doc comment must sit on the thing it documents.
 *
 * Neither fault is inert. A stranded block attaches to whatever declaration
 * follows it, blank lines and all (measured against the compiler, not assumed),
 * so it documents the wrong symbol rather than nothing; of a stack, only the
 * last reaches a hover and the rest are lost.
 *
 * Known hole: a file's own header in a module with no imports attaches to its
 * first declaration, and the exemption below lets it. Thirteen files are in
 * that shape, most of them harmlessly, so this tolerates it rather than
 * churning them.
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
          // A file's own header, which has no symbol to sit on.
          const header = lines.slice(0, i).every((l) => l.trim() === "");
          while (i < lines.length && !lines[i]!.includes("*/")) i++;
          if (header) continue;
          const next = (lines[i + 1] ?? "").trim();
          if (next === "" || next.startsWith("/**")) {
            stranded.push(
              `${file.slice(repo.length)}:${i + 1} — ` +
                (next === ""
                  ? "a blank line below it, so it documents whatever declaration follows"
                  : "another doc comment below it, which is the one a hover shows"),
            );
          }
        }
      }
    }
    expect(stranded).toEqual([]);
  });
});
