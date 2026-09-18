import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { THUMB_SIZE } from "../../shared/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ThumbCache } from "../src/cache";
import { createOverrideHolder } from "../src/overrides";
import { createDescribe } from "../src/preview";
import { previewTags } from "../src/static";
import { libraryFor, realTempDir, stlBytes } from "./helpers";

/**
 * What a shared address says about itself (link-previews D2/D4/D8). Every cell
 * here calls the resolver directly: the splice is `static.test.ts`'s subject.
 *
 * The fixture is a library, a cache and an override store, all constructor
 * arguments (`server/test/CLAUDE.md`) — and nothing here lists, so no cell
 * probes the semantic index.
 */
const top = realTempDir("mb-preview-lib-");
mkdirSync(join(top, "Kit"));
mkdirSync(join(top, "Plain"));
writeFileSync(join(top, "Kit", "dragon.stl"), stlBytes(1));
writeFileSync(join(top, "Kit", "unrendered.stl"), stlBytes(2));
writeFileSync(join(top, "Kit", "quote.stl"), stlBytes(3));
writeFileSync(join(top, "Kit", "plain.stl"), stlBytes(6));
writeFileSync(join(top, "Kit", "notes.txt"), "not a model");
const zipPath = join(top, "Kit", "models.zip");
writeFileSync(
  zipPath,
  zipSync({
    "parts/lid.stl": new Uint8Array(stlBytes(4)),
    "inner.zip": [
      new Uint8Array(zipSync({ "deep.stl": new Uint8Array(stlBytes(5)) })),
      { level: 0 },
    ],
  }),
);
// A **fractional** mtime, in seconds: the cache compares its key with `===`, so a
// `Math.floor` or a `toFixed` in the URL builder must fail a cell rather than
// pass by luck (D4).
utimesSync(zipPath, 1_700_000_000.123_456_7, 1_700_000_000.123_456_7);

mkdirSync(join(top, ".model-browser"), { recursive: true });
writeFileSync(
  join(top, ".model-browser", "overrides.json"),
  JSON.stringify({
    version: 1,
    entries: {
      "/Kit": {
        name: "The Kit",
        credits: { author: "Ada Lovelace", license: "CC BY 4.0" },
      },
      "/Kit/dragon.stl": { name: "Dragon Boss" },
      "/Kit/quote.stl": { name: 'A " > <script>alert(1)</script>' },
    },
  }),
);

const dist = realTempDir("mb-preview-dist-");
writeFileSync(join(dist, "og.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
/** A build that shipped without the site image — D5's second guard. */
const bareDist = realTempDir("mb-preview-nodist-");
const cacheDir = realTempDir("mb-preview-cache-");
/** A root that is not there: the library never settles and nothing it owns answers. */
const goneRoot = realTempDir("mb-preview-gone-");

const library = libraryFor(top);
const cache = new ThumbCache(cacheDir, undefined, undefined, library);
const overrides = createOverrideHolder(library, () => undefined);

const dragonPath = "/Kit/dragon.stl";
const dragonMtime = statSync(join(top, "Kit", "dragon.stl")).mtimeMs;
const lidPath = "/Kit/models.zip!/parts/lid.stl";
const zipMtime = statSync(zipPath).mtimeMs;
const plainPath = "/Kit/plain.stl";
const plainMtime = statSync(join(top, "Kit", "plain.stl")).mtimeMs;
let dragonGen = 0;
let lidGen = 0;
let plainGen = 0;

afterAll(() => {
  for (const dir of [top, dist, bareDist, cacheDir, goneRoot])
    rmSync(dir, { recursive: true, force: true });
});

beforeAll(async () => {
  // `resolve` throws until the library has been evaluated once.
  await library.state();
  dragonGen = await cache.put(dragonPath, {
    mtime: dragonMtime,
    png: Buffer.from("webp bytes"),
  });
  lidGen = await cache.put(lidPath, {
    mtime: zipMtime,
    png: Buffer.from("webp bytes"),
  });
  // Only the unoccluded variant, as a browser with AO off leaves behind.
  plainGen = await cache.put(plainPath, {
    mtime: plainMtime,
    png: Buffer.from("webp bytes"),
    ao: false,
  });
});

/**
 * The ordinary posture: a deployment that declares its own origin, asked at that
 * name. The host matters — the entry document is served under no guard, so the
 * resolver applies the guard's host rule itself before it reads anything (D6).
 */
const DECLARED = "http://models.example";
const ask = (
  address: string,
  opts: {
    origins?: readonly string[];
    distDir?: string;
    host?: string;
    headers?: Record<string, string>;
  } = {},
) =>
  createDescribe({
    library,
    cache,
    overrides,
    origins: opts.origins ?? [DECLARED],
    distDir: opts.distDir ?? dist,
  })(
    new URL(`http://${opts.host ?? "models.example"}${address}`),
    new Headers(opts.headers),
  );

const DEPLOYMENT = "Model Browser";
const DEPLOYMENT_DESCRIPTION =
  "Browse a library of 3D-printable models in your browser.";

describe("what a shared address says about itself", () => {
  it("describes the library's top, and every view that is not one model, as the deployment", async () => {
    const top = await ask("/");
    expect(top).toMatchObject({
      title: DEPLOYMENT,
      description: DEPLOYMENT_DESCRIPTION,
      image: "http://models.example/og.png",
      // The shipped image's own shape, declared beside its name so a consumer
      // that will not fetch it still lays the card out.
      imageType: "image/png",
      imageWidth: 1200,
      imageHeight: 630,
      card: "summary_large_image",
      url: "http://models.example/",
    });
    // A search and a similarity view preview as the deployment does, and the
    // address is restated whole.
    const search = await ask("/?flat=1&q=dragon");
    expect(search.title).toBe(DEPLOYMENT);
    expect(search.url).toBe("http://models.example/?flat=1&q=dragon");
    // The About page has its own words.
    const about = await ask("/about.html");
    expect(about.title).toBe("About — Model Browser");
    expect(about.description).toBe(
      "What this deployment is, and the models it shows.",
    );
    expect(about.image).toBe("http://models.example/og.png");
  });

  it("titles a directory the library resolves, by its display name or its own last segment", async () => {
    expect(await ask("/?path=/Kit")).toMatchObject({
      title: "The Kit",
      description: DEPLOYMENT_DESCRIPTION,
      image: "http://models.example/og.png",
      card: "summary_large_image",
      url: "http://models.example/?path=/Kit",
    });
    expect((await ask("/?path=/Plain")).title).toBe("Plain");
    // A zip is a folder in the app and a file on disk, so it fails the kind
    // check and takes the deployment's title — chosen, not overlooked (D8).
    expect((await ask("/?path=/Kit/models.zip")).title).toBe(DEPLOYMENT);
    expect((await ask("/?path=/Kit/models.zip!/parts")).title).toBe(DEPLOYMENT);
  });

  it("will not let a fabricated directory speak for the deployment", async () => {
    // `resolve` confines rather than proves existence, so only the `stat` says
    // this is not there — and the title must not be taken from the path's text.
    const address = `/?path=${encodeURIComponent("/Your account has been locked, click here")}`;
    const answer = await ask(address);
    expect(answer.title).toBe(DEPLOYMENT);
    expect(answer.description).toBe(DEPLOYMENT_DESCRIPTION);
    for (const word of ["account", "locked", "click"]) {
      expect(answer.title, word).not.toContain(word);
      expect(answer.description ?? "", word).not.toContain(word);
    }
    // The title and the description alone: `og:url` restates the address that
    // was requested, fabricated path included, because that is what it is for.
    expect(answer.url).toBe(`http://models.example${address}`);
    expect(answer.url).toContain("locked");
  });

  it("previews a model whose thumbnail is held as that model", async () => {
    const answer = await ask(`/?path=/Kit&model=${dragonPath}`);
    expect(answer).toMatchObject({
      title: "Dragon Boss",
      description: "Ada Lovelace — CC BY 4.0",
      imageType: "image/webp",
      imageWidth: THUMB_SIZE,
      imageHeight: THUMB_SIZE,
      card: "summary",
      url: `http://models.example/?path=/Kit&model=${dragonPath}`,
    });
    const image = new URL(answer.image ?? "");
    expect(image.origin + image.pathname).toBe(
      "http://models.example/api/thumb/image",
    );
    expect(image.searchParams.get("path")).toBe(dragonPath);
    expect(image.searchParams.get("mtime")).toBe(String(dragonMtime));
    expect(image.searchParams.get("gen")).toBe(String(dragonGen));
  });

  it("falls back to the unoccluded variant when it is the only render held", async () => {
    const answer = await ask(`/?model=${plainPath}`);
    expect(answer.card).toBe("summary");
    const image = new URL(answer.image ?? "");
    expect(image.pathname).toBe("/api/thumb/image");
    expect(image.searchParams.get("ao")).toBe("off");
    expect(image.searchParams.get("gen")).toBe(String(plainGen));
    // The occluded variant, when held, is the one named — no `ao` at all.
    const dragon = new URL((await ask(`/?model=${dragonPath}`)).image ?? "");
    expect(dragon.searchParams.get("ao")).toBeNull();
  });

  it("keys a zip entry's thumbnail by the archive's own mtime, verbatim", async () => {
    // The fixture is only a fixture if the mtime has a fraction to lose.
    expect(String(zipMtime)).toContain(".");
    const answer = await ask(`/?model=${encodeURIComponent(lidPath)}`);
    expect(answer.title).toBe("lid.stl");
    const image = new URL(answer.image ?? "");
    // The virtual path on the wire, the archive's mtime as the key (D4).
    expect(image.searchParams.get("path")).toBe(lidPath);
    expect(image.searchParams.get("mtime")).toBe(String(zipMtime));
    expect(image.searchParams.get("gen")).toBe(String(lidGen));
  });

  it("keeps an unrendered model's own name and falls back only the image", async () => {
    const before = readdirSync(cacheDir, { recursive: true }).sort();
    const answer = await ask("/?model=/Kit/unrendered.stl");
    expect(answer).toMatchObject({
      title: "unrendered.stl",
      description: "Ada Lovelace — CC BY 4.0",
      image: "http://models.example/og.png",
      imageType: "image/png",
      card: "summary_large_image",
    });
    // Answering a preview never makes the server draw (D4).
    expect(readdirSync(cacheDir, { recursive: true }).sort()).toEqual(before);
  });

  it("will not let a fabricated model speak for the deployment", async () => {
    // This is the cell that catches a title computed before the `stat`:
    // `resolve` answers for this path perfectly happily.
    const model = "/Your account has been locked, click here.stl";
    const address = `/?model=${encodeURIComponent(model)}`;
    const answer = await ask(address);
    expect(answer.title).toBe(DEPLOYMENT);
    expect(answer.description).toBe(DEPLOYMENT_DESCRIPTION);
    for (const word of ["account", "locked", "click"]) {
      expect(answer.title, word).not.toContain(word);
      expect(answer.description ?? "", word).not.toContain(word);
    }
    expect(answer.url).toBe(`http://models.example${address}`);
    expect(answer.url).toContain("locked");
    expect(answer.image).toBe("http://models.example/og.png");
  });

  it("will not let a fabricated entry inside a real archive speak for the deployment", async () => {
    // The archive is real, so the `stat` succeeds — it proves the *file*, not the
    // entry — and the held render is the only existence proof an entry has
    // short of reading the central directory, which this never does (D4/D8).
    const entry = "/Kit/models.zip!/Your account has been locked, click here";
    const address = `/?model=${encodeURIComponent(entry)}`;
    const answer = await ask(address);
    expect(answer.title).toBe(DEPLOYMENT);
    expect(answer.description).toBe(DEPLOYMENT_DESCRIPTION);
    for (const word of ["account", "locked", "click"]) {
      expect(answer.title, word).not.toContain(word);
      expect(answer.description ?? "", word).not.toContain(word);
    }
    expect(answer.url).toBe(`http://models.example${address}`);
    expect(answer.url).toContain("locked");
    expect(answer.image).toBe("http://models.example/og.png");
    // Even one that names a real entry, if nothing is held for it: the archive's
    // own listing is never read to find out.
    expect(
      (await ask(`/?model=${encodeURIComponent("/Kit/models.zip!/inner.zip")}`))
        .title,
    ).toBe(DEPLOYMENT);
  });

  it("names no model for a parameter naming something that is not a file", async () => {
    // A directory and an archive's interior are browsable, not models; titling
    // one is the fabricated-path hole in another shape.
    expect((await ask("/?model=/Kit")).title).toBe(DEPLOYMENT);
    expect((await ask("/?model=/Plain")).title).toBe(DEPLOYMENT);
    // An archive is a file on disk and a folder in the app — not a model.
    expect((await ask("/?model=/Kit/models.zip")).title).toBe(DEPLOYMENT);
    // A file that is not a model still is a file: the library, not this, decides
    // what is renderable, and nothing is held for it, so only the image falls back.
    expect((await ask("/?model=/Kit/notes.txt")).title).toBe("notes.txt");
  });

  it("answers a nested archive path as the deployment rather than escaping", async () => {
    // `VPathError`, not `LibraryError`: a narrowed catch would let this reach
    // the handler's guard and ship a document with no varying tags at all.
    const answer = await ask(
      `/?model=${encodeURIComponent("/Kit/models.zip!/inner.zip!/deep.stl")}`,
    );
    expect(answer.title).toBe(DEPLOYMENT);
    expect(answer.description).toBe(DEPLOYMENT_DESCRIPTION);
  });

  it("escapes a display name carrying markup, once, through previewTags", async () => {
    const answer = await ask("/?model=/Kit/quote.stl");
    expect(answer.title).toBe('A " > <script>alert(1)</script>');
    const tags = previewTags(answer);
    expect(tags).toContain("&lt;script&gt;");
    expect(tags).toContain("&quot;");
    expect(tags).not.toContain("<script>alert(1)");
    // Once: an already-escaped entity is not escaped again.
    expect(tags).not.toContain("&amp;lt;");
  });

  it("names no image at all when the build shipped none", async () => {
    // A missing file would be advertised as an image and answered by the SPA
    // fallback with a 200 `text/html` document (D5).
    expect((await ask("/", { distDir: bareDist })).image).toBeUndefined();
    expect(
      (await ask("/?model=/Kit/unrendered.stl", { distDir: bareDist })).image,
    ).toBeUndefined();
    // The model that *is* held still has its own thumbnail.
    expect(
      (await ask(`/?model=${dragonPath}`, { distDir: bareDist })).image,
    ).toContain("/api/thumb/image");
  });
});

describe("a library that cannot answer", () => {
  // The delta's rule: the document is still served, carrying what could be
  // resolved. `resolve` throws a plain `Error` until the library settles, its
  // cache cannot even name its directory, and the override store answers empty —
  // so every address is the deployment's, and none of them throws.
  const absent = libraryFor(join(goneRoot, "not-there"));
  const describeAbsent = createDescribe({
    library: absent,
    cache: new ThumbCache(cacheDir, undefined, undefined, absent),
    overrides: createOverrideHolder(absent, () => undefined),
    origins: [DECLARED],
    distDir: dist,
  });

  it("describes every address as the deployment rather than throwing", async () => {
    for (const address of [
      "/",
      "/?path=/Kit",
      `/?model=${dragonPath}`,
      "/about.html",
    ]) {
      const answer = await describeAbsent(
        new URL(`http://models.example${address}`),
        new Headers(),
      );
      expect(answer.title, address).toBe(
        address === "/about.html" ? "About — Model Browser" : DEPLOYMENT,
      );
      expect(answer.image, address).toBe("http://models.example/og.png");
      expect(answer.url, address).toBe(`http://models.example${address}`);
    }
  });
});

describe("which origin the metadata advertises", () => {
  it("takes the origin the deployment declares over the host the request states", async () => {
    const answer = await ask(`/?model=${dragonPath}`, {
      origins: ["https://models.masamaeda.com"],
      host: "evil.example",
    });
    expect(answer.url).toBe(
      `https://models.masamaeda.com/?model=${dragonPath}`,
    );
    expect(answer.image).toBe("https://models.masamaeda.com/og.png");
    expect(JSON.stringify(answer)).not.toContain("evil.example");
    // And the name it stated buys it nothing about the library: the entry
    // document is served under no guard, so a rebound page must not learn from
    // the head what `/api/dir` would refuse it (D6).
    expect(answer.title).toBe(DEPLOYMENT);
    expect(answer.description).toBe(DEPLOYMENT_DESCRIPTION);
  });

  it("describes the library to the hosts the deployment does serve", async () => {
    // The declared name, and loopback — which the guard allows besides, so a
    // developer's own browser is not the odd one out.
    const declared = await ask(`/?model=${dragonPath}`, {
      origins: ["https://models.masamaeda.com"],
      host: "models.masamaeda.com",
    });
    expect(declared.title).toBe("Dragon Boss");
    const loopback = await ask(`/?model=${dragonPath}`, {
      origins: [],
      host: "127.0.0.1:3177",
    });
    expect(loopback.title).toBe("Dragon Boss");
    expect(loopback.image).toContain("http://127.0.0.1:3177/api/thumb/image");
    // A name that is neither is told the deployment, whatever it asks about.
    for (const address of ["/", "/?path=/Kit", `/?model=${dragonPath}`]) {
      const answer = await ask(address, { origins: [], host: "evil.example" });
      expect(answer.title, address).toBe(DEPLOYMENT);
      expect(answer.description, address).toBe(DEPLOYMENT_DESCRIPTION);
    }
  });

  it("states the declared origin in the spelling the guard holds it in", async () => {
    // `config.ts` takes the entry verbatim and the guard compares `URL.origin`,
    // so a mixed-case entry must not reach og:url in a shape nothing else uses.
    const answer = await ask("/", {
      origins: ["HTTPS://Models.Masamaeda.COM"],
      host: "models.masamaeda.com",
    });
    expect(answer.url).toBe("https://models.masamaeda.com/");
    expect(answer.image).toBe("https://models.masamaeda.com/og.png");
  });

  it("describes itself by the request's host when it declares no origin", async () => {
    const forwarded = await ask("/", {
      origins: [],
      host: "127.0.0.1:3177",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(forwarded.url).toBe("https://127.0.0.1:3177/");
    expect(forwarded.image).toBe("https://127.0.0.1:3177/og.png");
    const plain = await ask("/", { origins: [], host: "127.0.0.1:3177" });
    expect(plain.url).toBe("http://127.0.0.1:3177/");
  });

  it("skips a loopback entry to find the origin a visitor can reach", async () => {
    const answer = await ask("/", {
      origins: ["http://127.0.0.1:3177", "https://models.masamaeda.com"],
      host: "models.masamaeda.com",
    });
    expect(answer.url).toBe("https://models.masamaeda.com/");
    expect(answer.image).toBe("https://models.masamaeda.com/og.png");
  });
});
