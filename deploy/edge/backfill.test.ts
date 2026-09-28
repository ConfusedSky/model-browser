import { describe, expect, it } from "vitest";
import type { DirEntry, ThumbStatus } from "../../shared/types";
import {
  BackfillError,
  collect,
  parseArgs,
  step,
  urlsFor,
  walk,
} from "./backfill";

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

  it("names no thumbnail without an annotation", () => {
    expect(urlsFor(model("hit", "hit", { thumb: undefined }))).toEqual([GLB]);
  });

  it("asks for gen 0 as the client does, not as no gen", () => {
    const m = model("hit", undefined, {
      thumb: { gen: 0, framed: false, ao: { state: "hit" } },
    });
    expect(urlsFor(m)).toEqual([`/api/thumb/image?${Q}&gen=0`, GLB]);
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

describe("walk", () => {
  const HOST = "http://origin.test";
  const dir = (path: string): DirEntry => ({
    name: path.slice(1),
    path,
    kind: "dir",
    size: 0,
    mtime: 0,
  });

  /** A server answering each folder from a queue whose last answer repeats. */
  function serve(answers: Record<string, unknown[]>) {
    const asked: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const folder = new URL(String(input)).searchParams.get("path") ?? "";
      asked.push(folder);
      const queue = answers[folder];
      if (queue === undefined) return new Response("no", { status: 404 });
      const body = queue.length > 1 ? queue.shift() : queue[0];
      return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
      );
    }) as typeof fetch;
    return { asked, fetchFn };
  }
  const opts = (fetchFn: typeof fetch) => ({
    fetchFn,
    retries: 3,
    backoffMs: 0,
  });

  it("re-asks a stale listing until it is fresh", async () => {
    const m = model("hit", "hit");
    const s = serve({
      "/": [
        { path: "/", entries: [], stale: true },
        { path: "/", entries: [m] },
      ],
    });
    const walked = await walk(HOST, opts(s.fetchFn));
    expect(s.asked).toEqual(["/", "/"]);
    expect(walked).toEqual([m]);
  });

  it("gives up on a listing that stays stale, naming the folder", async () => {
    const s = serve({
      "/": [{ path: "/", entries: [dir("/Kit")] }],
      "/Kit": [{ path: "/Kit", entries: [], stale: true }],
    });
    const run = walk(HOST, opts(s.fetchFn));
    await expect(run).rejects.toThrow(BackfillError);
    await expect(run).rejects.toThrow(/^\/Kit: still stale after 3 re-asks/);
    expect(s.asked.filter((f) => f === "/Kit")).toHaveLength(4);
  });

  it("refuses a truncated listing, naming the folder", async () => {
    const s = serve({
      "/": [{ path: "/", entries: [dir("/Kit")] }],
      "/Kit": [{ path: "/Kit", entries: [], truncated: true }],
    });
    await expect(walk(HOST, opts(s.fetchFn))).rejects.toThrow(
      "/Kit: the listing was truncated",
    );
  });

  it("names the folder on an answer that is not JSON", async () => {
    const s = serve({
      "/": [{ path: "/", entries: [dir("/Kit")] }],
      "/Kit": ["<html>"],
    });
    await expect(walk(HOST, opts(s.fetchFn))).rejects.toThrow(
      "/Kit: /api/dir answered something not JSON",
    );
  });

  it("names the folder on a network error", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(walk(HOST, opts(fetchFn))).rejects.toThrow(
      "/: /api/dir failed: TypeError: fetch failed",
    );
  });
});

describe("collect", () => {
  const HOST = "http://origin.test";
  const BARE = "/Kit/bare.stl";
  const bare = model("hit", "hit", { path: BARE, thumb: undefined });
  const bareQ = `path=%2FKit%2Fbare.stl&mtime=${MTIME}`;

  /** `/api/thumb` answering per variant; every lookup's URL is recorded. */
  function thumbs(answers: { ao: unknown; noao: unknown }, status = 200) {
    const asked: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url.slice(HOST.length));
      const body = url.includes("&ao=off") ? answers.noao : answers.ao;
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { asked, fetchFn };
  }

  it("asks nothing for an annotated model, counting its missing variants absent", async () => {
    const s = thumbs({ ao: {}, noao: {} });
    const got = await collect(HOST, [model("hit", "stale")], s);
    expect(s.asked).toEqual([]);
    expect(got).toEqual({
      urls: [AO, GLB],
      lookedUp: 0,
      absent: { ao: 0, noao: 1 },
    });
  });

  it("names an unannotated model's hit variants with the gen the lookup gave", async () => {
    const s = thumbs({
      ao: { status: "hit", gen: 7 },
      noao: { status: "hit", gen: 7 },
    });
    const got = await collect(HOST, [bare], s);
    expect(s.asked).toEqual([
      `/api/thumb?${bareQ}&pixels=off`,
      `/api/thumb?${bareQ}&ao=off&pixels=off`,
    ]);
    expect(got).toEqual({
      urls: [
        `/api/thumb/image?${bareQ}&gen=7`,
        `/api/thumb/image?${bareQ}&ao=off&gen=7`,
        `/api/model.glb?${bareQ}`,
      ],
      lookedUp: 1,
      absent: { ao: 0, noao: 0 },
    });
  });

  it("counts an unannotated model's unrendered variants absent, without failing", async () => {
    const s = thumbs({ ao: { status: "miss" }, noao: { status: "stale" } });
    await expect(collect(HOST, [bare], s)).resolves.toEqual({
      urls: [`/api/model.glb?${bareQ}`],
      lookedUp: 1,
      absent: { ao: 1, noao: 1 },
    });
  });

  it("fails on a lookup the server refuses, naming the model", async () => {
    const s = thumbs({ ao: {}, noao: {} }, 500);
    const run = collect(HOST, [bare], s);
    await expect(run).rejects.toThrow(BackfillError);
    await expect(run).rejects.toThrow(`${BARE}: /api/thumb answered 500`);
  });

  it("fails on a lookup that cannot connect, naming the model", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(collect(HOST, [bare], { fetchFn })).rejects.toThrow(
      `${BARE}: /api/thumb failed: TypeError: fetch failed`,
    );
  });

  it("reads a hit without a gen as gen 0", async () => {
    const s = thumbs({ ao: { status: "hit" }, noao: { status: "miss" } });
    const got = await collect(HOST, [bare], s);
    expect(got.urls).toEqual([
      `/api/thumb/image?${bareQ}&gen=0`,
      `/api/model.glb?${bareQ}`,
    ]);
  });

  it("asks nothing and names nothing inside an archive", async () => {
    const s = thumbs({ ao: { status: "hit" }, noao: { status: "hit" } });
    const inZip = model("hit", "hit", {
      path: "/Kit/a.zip!/m.stl",
      thumb: undefined,
    });
    await expect(collect(HOST, [inZip], s)).resolves.toEqual({
      urls: [],
      lookedUp: 0,
      absent: { ao: 0, noao: 0 },
    });
    expect(s.asked).toEqual([]);
  });

  it("fails on a lookup answer that is not JSON, naming the model", async () => {
    const fetchFn = (async () => new Response("<html>")) as typeof fetch;
    const run = collect(HOST, [bare], { fetchFn });
    await expect(run).rejects.toThrow(BackfillError);
    await expect(run).rejects.toThrow(
      `${BARE}: /api/thumb answered something not JSON`,
    );
  });

  it("counts an annotated model's non-hit ao variant absent", async () => {
    const got = await collect(
      HOST,
      [model("stale", "hit")],
      thumbs({ ao: {}, noao: {} }),
    );
    expect(got.absent).toEqual({ ao: 1, noao: 0 });
    expect(got.urls).toEqual([NOAO, GLB]);
  });

  it.each([[{ status: "gone" }], [{}]])(
    "fails on a lookup status it does not know (%j), naming the model",
    async (answer) => {
      const s = thumbs({ ao: answer, noao: { status: "miss" } });
      const run = collect(HOST, [bare], s);
      await expect(run).rejects.toThrow(BackfillError);
      await expect(run).rejects.toThrow(
        `${BARE}: /api/thumb answered status ${JSON.stringify((answer as { status?: string }).status)}`,
      );
    },
  );
});

describe("parseArgs", () => {
  it("takes the defaults with no options", () => {
    expect(parseArgs([])).toEqual({
      ok: true,
      options: {
        host: "https://models.masamaeda.com",
        concurrency: 2,
        limit: Infinity,
        dry: false,
      },
    });
  });

  it("reads every option", () => {
    const argv = ["--host", "http://127.0.0.1:3188/", "--concurrency", "4"];
    expect(parseArgs([...argv, "--limit", "30", "--dry"])).toEqual({
      ok: true,
      options: {
        host: "http://127.0.0.1:3188",
        concurrency: 4,
        limit: 30,
        dry: true,
      },
    });
  });

  it.each([
    [["--concurrency", "0"], /--concurrency needs an integer above 0/],
    [["--concurrency", "1.5"], /--concurrency needs an integer above 0/],
    [["--limit", "-3"], /--limit needs an integer above 0/],
    [["--limit", "ten"], /--limit needs an integer above 0/],
    [["--host"], /--host needs a value/],
    [["--limit", "--dry"], /--limit needs a value/],
    [["--hots", "x"], /unknown option "--hots"/],
    [["extra"], /unknown option "extra"/],
  ])("refuses %j", (argv, error) => {
    const parsed = parseArgs(argv);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(error);
  });
});
