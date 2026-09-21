import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type Preview,
  clientDist,
  createStaticHandler,
  isApiRequest,
  route,
} from "../src/static";
import { realTempDir } from "./helpers";

/**
 * Serving the built client from the runtime entry point (`public-deployment`
 * D8, tasks 5.1–5.3).
 *
 * A dist directory built here rather than a real `client/dist`, so the cells
 * assert the rules and not a particular build: an entry document, a hashed
 * asset, an image, and a file whose name collides with nothing.
 */
const dist = realTempDir("mb-static-dist-");
mkdirSync(join(dist, "assets"));
// A real `<head>…</head>`, as the build emits: the splice point is what the
// annotation cells below are about, and a fixture without one would let every
// one of them pass by serving the document unchanged (2.5).
const INDEX =
  '<!doctype html><html><head><meta charset="utf-8"><title>model browser</title></head><body><div id="root"></div></body></html>';
// Carrying the splice point too, so "annotate every file" is an edit the asset
// cell can catch rather than one nothing notices.
const BUNDLE = `console.log(${JSON.stringify(`</head>${"x".repeat(4096)}`)})\n`;
writeFileSync(join(dist, "index.html"), INDEX);
writeFileSync(join(dist, "assets", "main-abc123.js"), BUNDLE);
writeFileSync(join(dist, "assets", "main-abc123.css"), "body{margin:0}");
writeFileSync(
  join(dist, "assets", "logo-abc123.png"),
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
);
writeFileSync(join(dist, "favicon.ico"), Buffer.from([0, 0, 1, 0]));
const ABOUT =
  "<!doctype html><html><head><title>about</title></head><body>about</body></html>";
writeFileSync(join(dist, "about.html"), ABOUT);
// A name the withholding gate must *not* catch, and the one a `startsWith`
// spelling of it would: same prefix, a different file.
const NEARLY = "<!doctype html><title>not the about page</title>";
writeFileSync(join(dist, "about.html.bak"), NEARLY);
const secret = realTempDir("mb-static-outside-");
writeFileSync(join(secret, "secret.txt"), "not yours");

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
  rmSync(secret, { recursive: true, force: true });
});

const serve = createStaticHandler(dist);
const ask = (path: string, headers: Record<string, string> = {}) =>
  serve(new Request(`http://models.example${path}`, { headers }));

describe("the static handler", () => {
  it("serves a file that exists, with its own content type", async () => {
    const js = await ask("/assets/main-abc123.js");
    expect(js?.status).toBe(200);
    expect(js?.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(await js?.text()).toBe(BUNDLE);

    const png = await ask("/assets/logo-abc123.png");
    expect(png?.headers.get("content-type")).toBe("image/png");
    const ico = await ask("/favicon.ico");
    expect(ico?.headers.get("content-type")).toBe("image/x-icon");
  });

  it("caches the hashed assets immutably and revalidates the entry document", async () => {
    // The build is content-hashed, so a changed asset is a changed name and a
    // visitor far from the origin fetches each one once; the entry document is
    // the one name that does not change and the only thing that names the new
    // build's assets, so it is revalidated every visit (5.3).
    expect(
      (await ask("/assets/main-abc123.js"))?.headers.get("cache-control"),
    ).toBe("public, max-age=31536000, immutable");
    expect(
      (await ask("/assets/main-abc123.css"))?.headers.get("cache-control"),
    ).toBe("public, max-age=31536000, immutable");
    expect((await ask("/"))?.headers.get("cache-control")).toBe("no-cache");
    expect((await ask("/index.html"))?.headers.get("cache-control")).toBe(
      "no-cache",
    );
    expect((await ask("/favicon.ico"))?.headers.get("cache-control")).toBe(
      "no-cache",
    );
  });

  it("answers a path matching no file with the entry document", async () => {
    // A deep link opened cold: the server has no such file, and the client
    // resolves the location itself (5.1).
    for (const path of ["/", "/kits/dragons", "/assets/gone-deadbeef.js"]) {
      const res = await ask(path);
      expect(res?.status, path).toBe(200);
      expect(res?.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res?.text()).toBe(INDEX);
    }
  });

  it("refuses a path that names its way out of the dist directory", async () => {
    // `new URL` normalises a literal `..` away, so the case that reaches a
    // handler is the percent-encoded one. It is refused rather than normalised:
    // `posix.normalize` would rewrite `/../../etc/passwd` to `/etc/passwd` and
    // serve whatever that names *inside* the build, which is a 200 for a
    // request that asked for a traversal.
    // What actually reaches a handler, measured rather than assumed: WHATWG URL
    // resolves a literal `..` **and** a `%2e%2e` segment away before `pathname`
    // is read (`/%2e%2e/%2e%2e/etc/passwd` arrives as `/etc/passwd`), so the
    // traversal that survives is the one whose *slash* is encoded — the handler
    // decodes, and only then are there `..` segments to find.
    const escaped = `/assets%2f..%2f..%2f${secret.slice(1).split("/").join("%2f")}%2fsecret.txt`;
    for (const path of [
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/assets%2f..%2f..%2fsecret.txt",
      escaped,
    ]) {
      const res = await ask(path);
      expect(res?.status, path).toBe(403);
      expect(await res?.text()).not.toContain("not yours");
    }
    // And a path that cannot be decoded at all is a bad request, not a throw.
    expect((await ask("/%"))?.status).toBe(400);
  });

  it("encodes nothing, whatever the requester accepts", async () => {
    // Deliberate (D8): the transfer cost is owned by the proxy that fronts the
    // deployment this is for (`demo-infrastructure`'s `encode zstd gzip`), and
    // a rule here would bind every loopback install, where it is free, to a
    // deployment shape nobody is building. So the bytes are the file's, and
    // nothing varies by the request.
    for (const path of [
      "/assets/main-abc123.js",
      "/index.html",
      "/kits/dragons",
    ]) {
      const res = await ask(path, {
        "accept-encoding": "gzip, deflate, br, zstd",
      });
      expect(res?.headers.get("content-encoding"), path).toBeNull();
      expect(res?.headers.get("vary"), path).toBeNull();
    }
    const js = await ask("/assets/main-abc123.js", {
      "accept-encoding": "gzip",
    });
    expect(await js?.text()).toBe(BUNDLE);
  });

  it("withholds the About page when the introduction is off, however it is spelled", async () => {
    // The page is the visitor introduction's own document (`landing-page`
    // D2): a deployment declares the introduction in its configuration, and
    // the build carrying the file is not a declaration. Off, the page is a
    // 404 — not the entry document, which would draw the app at that address
    // and read as the page having moved.
    //
    // Every spelling, because the gate that asked its question of the
    // request's own string answered it for one of them: `resolvePath` drops a
    // trailing slash and a `.` segment, so each address below reaches the same
    // file, and the four beyond the first served the withheld page on the live
    // box (200, 484 bytes) while `/about.html` 404'd. The gate is keyed on the
    // resolved candidate now, which is the value the read uses.
    const spellings = [
      "/about.html",
      "/about.html/",
      "/about.html/.",
      "/about.html/./",
      "/about.html%2F",
      "//about.html",
    ];
    // With the introduction on, every one of them is the page — this is the
    // resolution the gate has to agree with, and the reason enumerating
    // spellings at the gate is the wrong shape.
    for (const path of spellings) {
      const on = await ask(path);
      expect(on?.status, path).toBe(200);
      expect(await on?.text(), path).toBe(ABOUT);
    }
    const withheld = createStaticHandler(dist, { intro: false });
    const off = (path: string) =>
      withheld(new Request(`http://models.example${path}`));
    for (const path of spellings) {
      const res = await off(path);
      expect(res?.status, path).toBe(404);
      expect(await res?.text(), path).not.toContain("about");
    }
    // Only that document: the app, its assets and every other file in the
    // build are unaffected — including the name that shares the withheld
    // one's prefix, which is what a `startsWith` gate would swallow.
    expect((await off("/"))?.status).toBe(200);
    expect((await off("/assets/main-abc123.js"))?.status).toBe(200);
    expect((await off("/index.html"))?.status).toBe(200);
    expect(await (await off("/about.html.bak"))?.text()).toBe(NEARLY);
    // And a path naming no file is still the entry document, not a 404: the
    // gate withholds one document, it does not turn the fallback off.
    const deep = await off("/kits/dragons");
    expect(deep?.status).toBe(200);
    expect(await deep?.text()).toBe(INDEX);
  });

  it("has nothing to serve when there is no entry document", async () => {
    // The null the composition falls back to the API on.
    const empty = realTempDir("mb-static-empty-");
    const bare = createStaticHandler(empty);
    expect(
      await bare(new Request("http://models.example/anything")),
    ).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});

/**
 * Link-preview annotation (link-previews D1/D7). The handler is handed a
 * resolver and splices what it answers into the entry document's head; what the
 * resolver *decides* is `preview.test.ts`'s subject, not this file's.
 */
describe("annotating the entry document", () => {
  const PREVIEW: Preview = {
    title: "Dragon",
    description: "Some Author — CC BY 4.0",
    image:
      "https://models.example/api/thumb/image?path=%2FKit%2Fx.stl&mtime=1.5&gen=2",
    imageType: "image/webp",
    imageWidth: 256,
    imageHeight: 256,
    url: "https://models.example/?path=/Kit&model=/Kit/x.stl",
    card: "summary",
  };
  const annotated = (
    resolver: (url: URL, headers: Headers) => Promise<Preview | null>,
    intro = true,
  ) => {
    const handler = createStaticHandler(dist, { intro, describe: resolver });
    return (path: string, headers: Record<string, string> = {}) =>
      handler(new Request(`http://models.example${path}`, { headers }));
  };

  it("serves the entry document as built when no resolver is configured", async () => {
    // The dev loop and the Electron seam: `describe` is optional, and unset it
    // costs the document nothing.
    for (const path of ["/", "/index.html", "/?path=/Kit&model=/Kit/x.stl"]) {
      expect(await (await ask(path))?.text(), path).toBe(INDEX);
    }
    expect(await (await ask("/about.html"))?.text()).toBe(ABOUT);
  });

  it("annotates the fallback document with what the address names", async () => {
    const seen: URL[] = [];
    const ask2 = annotated(async (url) => {
      seen.push(url);
      return PREVIEW;
    });
    const res = await ask2("/?path=/Kit&model=/Kit/x.stl");
    const html = await res!.text();
    expect(res!.status).toBe(200);
    // The whole URL, query included — a shareable address names its view there
    // and nowhere else (D2).
    expect(seen[0]?.search).toBe("?path=/Kit&model=/Kit/x.stl");
    expect(html).toContain('<meta property="og:title" content="Dragon">');
    expect(html).toContain('<meta property="og:image" content=');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    // The build's own head survives, and the block lands inside it.
    expect(html).toContain("<title>model browser</title>");
    expect(html.indexOf("og:title")).toBeLessThan(html.indexOf("</head>"));
    expect(res!.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res!.headers.get("cache-control")).toBe("no-cache");
    // Nothing sets a length by hand, so the longer body cannot be truncated.
    expect(res!.headers.get("content-length")).toBeNull();
    // The document's own name, not only the fallback.
    expect(await (await ask2("/index.html"))?.text()).toContain("og:title");
  });

  it("never annotates an asset, even one whose bytes carry </head>", async () => {
    // Assets are immutable for a year: one annotated would be cached forever
    // carrying one address's description (D7).
    const ask2 = annotated(async () => PREVIEW);
    const js = await ask2("/assets/main-abc123.js");
    expect(await js?.text()).toBe(BUNDLE);
    expect(js?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const ico = await ask2("/favicon.ico");
    expect(new Uint8Array(await ico!.arrayBuffer())).toEqual(
      new Uint8Array([0, 0, 1, 0]),
    );
  });

  it("escapes every value it places in the document", async () => {
    // A display name is library text, and on a library whose overrides someone
    // else wrote it is attacker-controlled.
    const ask2 = annotated(async () => ({
      title: 'A " > <script>alert(1)</script>',
      description: "Ada & Co",
      url: 'https://models.example/?q="x"',
    }));
    const html = await (await ask2("/"))!.text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
    expect(html).toContain("Ada &amp; Co");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("serves the document unchanged when the resolver rejects or declines", async () => {
    const thrown = annotated(async () => {
      throw new Error("the library is not ready");
    });
    const res = await thrown("/kits/dragons");
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe(INDEX);
    const silent = annotated(async () => null);
    expect(await (await silent("/"))?.text()).toBe(INDEX);
  });

  it("annotates the About page, and withholds it when the introduction is off", async () => {
    const on = annotated(async () => PREVIEW);
    const page = await on("/about.html");
    const html = await page!.text();
    expect(html).toContain("<title>about</title>");
    expect(html).toContain('<meta property="og:title" content="Dragon">');
    const off = annotated(async () => PREVIEW, false);
    const refused = await off("/about.html");
    expect(refused?.status).toBe(404);
    expect(await refused?.text()).not.toContain("og:");
  });
});

describe("the composition index.ts wires", () => {
  const api = (req: Request) =>
    new Response(JSON.stringify({ api: new URL(req.url).pathname }), {
      status: new URL(req.url).pathname === "/api/gone" ? 404 : 200,
      headers: { "content-type": "application/json" },
    });

  it("reserves the API prefix — a 404 under it is final", async () => {
    // D8: a client's bad request answered with the entry document and a 200
    // would make the bug invisible.
    const res = await route(
      new Request("http://models.example/api/gone"),
      api,
      serve,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ api: "/api/gone" });
  });

  it("sends every API path to the app, and nothing else", async () => {
    expect(isApiRequest("/api")).toBe(true);
    expect(isApiRequest("/api/dir")).toBe(true);
    expect(isApiRequest("/apiary")).toBe(false);
    expect(isApiRequest("/")).toBe(false);
    expect(isApiRequest("/kits/api/x")).toBe(false);
    // The prefix is reserved case-insensitively (9.11b): the reservation is
    // about which handler answers, and `/API/dir` falling through to the
    // client's entry document with a 200 is the invisible bug the rule exists
    // to prevent. The near miss keeps its answer — the case rule widens the
    // prefix, not the match.
    expect(isApiRequest("/API/dir")).toBe(true);
    expect(isApiRequest("/Api")).toBe(true);
    expect(isApiRequest("/APIary")).toBe(false);
    // Routed to the API, not to the client: the stub answers with the path it
    // saw, where the client would have answered the entry document.
    const upper = await route(
      new Request("http://models.example/API/gone"),
      api,
      serve,
    );
    expect(await upper.json()).toEqual({ api: "/API/gone" });

    const dir = await route(
      new Request("http://models.example/api/dir?path=/"),
      api,
      serve,
    );
    expect(await dir.json()).toEqual({ api: "/api/dir" });
  });

  it("sends everything else to the client", async () => {
    const page = await route(
      new Request("http://models.example/kits/dragons"),
      api,
      serve,
    );
    expect(await page.text()).toBe(INDEX);
    const asset = await route(
      new Request("http://models.example/assets/main-abc123.js"),
      api,
      serve,
    );
    expect(await asset.text()).toBe(BUNDLE);
  });

  it("serves the API exactly as before when there is no built client", async () => {
    // 5.1: the development loop, where Vite serves the client, must not start
    // depending on a build.
    for (const path of ["/api/dir", "/", "/kits/dragons"]) {
      const res = await route(
        new Request(`http://models.example${path}`),
        api,
        null,
      );
      expect(await res.json()).toEqual({ api: path });
    }
  });
});

describe("where the built client is", () => {
  it("is client/dist beside the server package, overridable", () => {
    expect(clientDist({})).toMatch(/[/\\]client[/\\]dist$/);
    expect(clientDist({ MODEL_BROWSER_CLIENT: "/elsewhere/dist" })).toBe(
      "/elsewhere/dist",
    );
    expect(clientDist({ MODEL_BROWSER_CLIENT: "" })).toMatch(
      /[/\\]client[/\\]dist$/,
    );
  });
});
