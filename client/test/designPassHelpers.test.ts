import { describe, expect, it } from "vitest";
import { crumbsOf, foldCrumbs } from "../src/components/PathBar";
import { strengthOf } from "../src/lib/scoreScale";
import { looksLikeFileName } from "../src/lib/searchOptions";

describe("looksLikeFileName", () => {
  it("takes one token with a file name's marks", () => {
    expect(looksLikeFileName("bio-mini-gun")).toBe(true);
    expect(looksLikeFileName("32mm_Orguss")).toBe(true);
    expect(looksLikeFileName("case.stl")).toBe(true);
    expect(looksLikeFileName("tdr5")).toBe(true);
  });

  it("leaves phrases and plain words to meaning", () => {
    expect(looksLikeFileName("a stone golem")).toBe(false);
    expect(looksLikeFileName("dragon")).toBe(false);
    expect(looksLikeFileName("a-b c")).toBe(false);
    expect(looksLikeFileName("x1")).toBe(false);
  });
});

describe("strengthOf", () => {
  it("names a result's standing from its z", () => {
    expect([4.2, 3.1, 2.2, 1.5].map((z) => strengthOf(z))).toEqual([
      "Strong",
      "Good",
      "Fair",
      "Weak",
    ]);
  });

  it("stops at Fair in a set whose best is middling", () => {
    expect([4.2, 3.1, 2.2, 1.5].map((z) => strengthOf(z, true))).toEqual([
      "Fair",
      "Fair",
      "Fair",
      "Weak",
    ]);
  });
});

describe("foldCrumbs", () => {
  const deep = crumbsOf("/a/b/c/d");
  const path = (c: { path: string } | null): string | null =>
    c === null ? null : c.path;

  it("keeps every crumb until folding is asked for", () => {
    expect(foldCrumbs(deep, 0).map(path)).toEqual([
      "/",
      "/a",
      "/a/b",
      "/a/b/c",
      "/a/b/c/d",
    ]);
  });

  it("folds the middle, then the parent, then the top", () => {
    expect(foldCrumbs(deep, 1).map(path)).toEqual([
      "/",
      null,
      "/a/b/c",
      "/a/b/c/d",
    ]);
    expect(foldCrumbs(deep, 2).map(path)).toEqual(["/", null, "/a/b/c/d"]);
    expect(foldCrumbs(deep, 3).map(path)).toEqual([null, "/a/b/c/d"]);
  });

  it("leaves a path too short to fold whole", () => {
    const short = crumbsOf("/a/b");
    expect(foldCrumbs(short, 1)).toEqual(short);
    expect(foldCrumbs(crumbsOf("/"), 3)).toEqual(crumbsOf("/"));
  });

  it("enters an archive where its crumb says", () => {
    expect(crumbsOf("/Kit/a.zip!/dir")).toEqual([
      { label: "Library", path: "/" },
      { label: "Kit", path: "/Kit" },
      { label: "a.zip", path: "/Kit/a.zip" },
      { label: "dir", path: "/Kit/a.zip!/dir" },
    ]);
  });
});
