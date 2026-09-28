import { describe, expect, it } from "vitest";
import type { DirEntry, ThumbStatus } from "../../shared/types";
import { step, urlsFor } from "./backfill";

const PATH = "/Kit/model.stl";
const MTIME = 1789446597239.1736;
const GEN = 1789519399619;
const Q = `path=%2FKit%2Fmodel.stl&mtime=${MTIME}`;
const AO = `/api/thumb/image?${Q}&gen=${GEN}`;
const NOAO = `/api/thumb/image?${Q}&ao=off&gen=${GEN}`;
const GLB = `/api/model.glb?${Q}`;

function model(
  ao: ThumbStatus | undefined,
  noao: ThumbStatus | undefined,
  over: Partial<DirEntry> = {},
): DirEntry {
  return {
    name: "model.stl",
    path: PATH,
    kind: "model",
    format: "stl",
    size: 1,
    mtime: MTIME,
    thumb: {
      gen: GEN,
      framed: false,
      ...(ao && { ao: { state: ao } }),
      ...(noao && { noao: { state: noao } }),
    },
    ...over,
  };
}

describe("urlsFor", () => {
  it("names both hit variants and the GLB", () => {
    expect(urlsFor(model("hit", "hit"))).toEqual([AO, NOAO, GLB]);
  });

  it("names only the variants whose state is hit", () => {
    expect(urlsFor(model("hit", "stale"))).toEqual([AO, GLB]);
    expect(urlsFor(model("stale", "miss"))).toEqual([GLB]);
    expect(urlsFor(model(undefined, undefined))).toEqual([GLB]);
  });

  it("names no thumbnail without a gen to validate it", () => {
    expect(urlsFor(model("hit", "hit", { thumb: undefined }))).toEqual([GLB]);
  });

  it("names no GLB for a format that is not STL", () => {
    const m = model("hit", "hit", { path: "/Kit/model.3mf", format: "3mf" });
    expect(urlsFor(m)).toEqual([
      `/api/thumb/image?path=%2FKit%2Fmodel.3mf&mtime=${MTIME}&gen=${GEN}`,
      `/api/thumb/image?path=%2FKit%2Fmodel.3mf&mtime=${MTIME}&ao=off&gen=${GEN}`,
    ]);
  });

  it("names nothing inside an archive", () => {
    expect(urlsFor(model("hit", "hit", { path: "/Kit/a.zip!/m.stl" }))).toEqual(
      [],
    );
  });

  it("encodes a path the way the client does", () => {
    const m = model("hit", undefined, { path: "/Ørk #2/big one.stl" });
    const q = `path=%2F%C3%98rk%20%232%2Fbig%20one.stl&mtime=${MTIME}`;
    expect(urlsFor(m)).toEqual([
      `/api/thumb/image?${q}&gen=${GEN}`,
      `/api/model.glb?${q}`,
    ]);
  });
});

describe("step", () => {
  it("follows folders, not archives, and keeps the models", () => {
    const at = (name: string, kind: DirEntry["kind"]): DirEntry => ({
      name,
      path: `/${name}`,
      kind,
      size: 0,
      mtime: 0,
    });
    const m = model("hit", "hit");
    const next = step({
      path: "/",
      entries: [at("Kit", "dir"), at("pack.zip", "zip"), m, at("More", "dir")],
    });
    expect(next.folders).toEqual(["/Kit", "/More"]);
    expect(next.models).toEqual([m]);
  });
});
