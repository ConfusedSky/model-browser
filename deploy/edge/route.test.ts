import { describe, expect, it } from "vitest";
import { THUMB_MIME } from "../../shared/types";
import {
  classify,
  replay,
  storable,
  STORE_MAX_BYTES,
  type ClassifyInput,
} from "./route";

const ORIGIN = "https://models.example";
const PATH = "/Kit/model.stl";
const MTIME = "1789446597239.1736";
const GEN = "1789519399619";

/** Built the way `thumbImageUrl` builds it. */
function thumbUrl(path: string, mtime: string, rest = `&gen=${GEN}`): string {
  return `${ORIGIN}/api/thumb/image?path=${encodeURIComponent(path)}&mtime=${mtime}${rest}`;
}
function glbUrl(path: string, mtime: string, rest = ""): string {
  return `${ORIGIN}/api/model.glb?path=${encodeURIComponent(path)}&mtime=${mtime}${rest}`;
}

function run(url: string, over: Partial<ClassifyInput> = {}) {
  return classify({
    method: "GET",
    url,
    headers: new Headers(),
    continent: "NA",
    thumbEpoch: "T1",
    meshEpoch: "M1",
    ...over,
  });
}
const keyOf = (url: string, over: Partial<ClassifyInput> = {}) => {
  const r = run(url, over);
  if (r.action !== "store") throw new Error(`passed: ${r.reason}`);
  return r.key;
};
const reasonOf = (url: string, over: Partial<ClassifyInput> = {}) => {
  const r = run(url, over);
  if (r.action !== "pass") throw new Error(`keyed: ${r.key}`);
  return r.reason;
};

describe("classify: keyed requests", () => {
  it("keys a current thumbnail with ao absent and on to one key, off to .noao", () => {
    const absent = keyOf(thumbUrl(PATH, MTIME));
    expect(absent).toBe(`T1/t${PATH}/${MTIME}/${GEN}.webp`);
    expect(keyOf(thumbUrl(PATH, MTIME, `&ao=on&gen=${GEN}`))).toBe(absent);
    expect(keyOf(thumbUrl(PATH, MTIME, `&ao=off&gen=${GEN}`))).toBe(
      `T1/t${PATH}/${MTIME}/${GEN}.noao.webp`,
    );
    expect(run(thumbUrl(PATH, MTIME))).toMatchObject({ kind: "thumb" });
  });

  it("keys a GLB under the mesh epoch", () => {
    expect(run(glbUrl(PATH, MTIME))).toEqual({
      action: "store",
      kind: "mesh",
      key: `M1/m${PATH}/${MTIME}.glb`,
    });
  });

  it("keys gen verbatim", () => {
    // Its own version at the origin, which compares text: keyed, never pinned.
    expect(keyOf(thumbUrl(PATH, MTIME, "&gen=007"))).toMatch(/\/007\.webp$/);
  });

  it.each(["1789519399619.0", "1e12", " 123", "0x1F", ""])(
    "passes gen %j through",
    (gen) => {
      const url = thumbUrl(PATH, MTIME, `&gen=${encodeURIComponent(gen)}`);
      expect(reasonOf(url)).toBe("version");
    },
  );

  it("gives two spellings of one mtime one key, on both routes", () => {
    expect(keyOf(thumbUrl(PATH, "1789446597239.17360"))).toBe(
      keyOf(thumbUrl(PATH, "1789446597239.1736")),
    );
    expect(keyOf(glbUrl(PATH, "1789446597239.17360"))).toBe(
      keyOf(glbUrl(PATH, "1789446597239.1736")),
    );
  });

  it("changes the thumbnail key when only mtime changes", () => {
    expect(keyOf(thumbUrl(PATH, "1789446597239.1736"))).not.toBe(
      keyOf(thumbUrl(PATH, "1789446597240")),
    );
  });

  it.each(["NaN", "", "Infinity"])("passes mtime %j through", (mtime) => {
    expect(reasonOf(thumbUrl(PATH, mtime))).toBe("version");
    expect(reasonOf(glbUrl(PATH, mtime))).toBe("version");
  });
});

describe("classify: versions and parameters", () => {
  it("passes a request naming no version", () => {
    expect(reasonOf(thumbUrl(PATH, MTIME, ""))).toBe("version");
    expect(
      reasonOf(`${ORIGIN}/api/model.glb?path=${encodeURIComponent(PATH)}`),
    ).toBe("version");
    expect(
      reasonOf(`${ORIGIN}/api/thumb/image?path=${encodeURIComponent(PATH)}`),
    ).toBe("version");
  });

  it("passes ao=bogus", () => {
    expect(reasonOf(thumbUrl(PATH, MTIME, `&ao=bogus&gen=${GEN}`))).toBe("ao");
  });

  it("passes a repeated parameter", () => {
    expect(reasonOf(thumbUrl(PATH, MTIME, `&gen=${GEN}&gen=${GEN}`))).toBe(
      "param",
    );
    expect(reasonOf(glbUrl(PATH, MTIME, `&mtime=${MTIME}`))).toBe("param");
  });

  it("passes an unknown extra parameter", () => {
    expect(reasonOf(thumbUrl(PATH, MTIME, `&gen=${GEN}&x=1`))).toBe("param");
    // `gen` belongs to the thumbnail route only.
    expect(reasonOf(glbUrl(PATH, MTIME, `&gen=${GEN}`))).toBe("param");
  });

  it("passes other paths on the host", () => {
    expect(reasonOf(`${ORIGIN}/api/file?path=%2Fa.stl&mtime=1`)).toBe("route");
    expect(reasonOf(`${ORIGIN}/api/model.glb/?path=%2Fa.stl&mtime=1`)).toBe(
      "route",
    );
  });

  it("passes a URL that does not parse", () => {
    expect(reasonOf("/api/model.glb?path=%2Fa.stl&mtime=1")).toBe("url");
  });
});

describe("classify: paths", () => {
  it.each([
    ["with !", "/Kit.zip!/a.stl"],
    ["with NUL", "/Kit/a\0.stl"],
    ["without a leading /", "Kit/a.stl"],
    ["with //", "/Kit//a.stl"],
    ["with a . segment", "/Kit/./a.stl"],
    ["with a .. segment", "/Kit/../a.stl"],
    ["with a trailing /", "/Kit/a.stl/"],
  ])("passes a path %s", (_, path) => {
    expect(reasonOf(thumbUrl(path, MTIME))).toBe("path");
    expect(reasonOf(glbUrl(path, MTIME))).toBe("path");
  });

  it("keys 256 path components and passes 257, as the origin refuses", () => {
    const deep = (n: number) => "/a".repeat(n);
    expect(keyOf(glbUrl(deep(256), "1"))).toBe(`M1/m${deep(256)}/1.glb`);
    expect(reasonOf(glbUrl(deep(257), "1"))).toBe("path");
  });

  it("passes a path that makes the key longer than 1,024 bytes", () => {
    const fits = keyOf(glbUrl(`/${"a".repeat(1000)}`, "1"));
    expect(new TextEncoder().encode(fits).length).toBeLessThanOrEqual(1024);
    // Multi-byte: 400 "Ø" is 800 bytes but only 400 UTF-16 units.
    expect(
      reasonOf(glbUrl(`/${"Ø".repeat(400)}x${"a".repeat(300)}`, "1")),
    ).toBe("keylen");
    expect(reasonOf(thumbUrl(`/${"a".repeat(1024)}`, MTIME))).toBe("keylen");
  });

  it.each([
    "/Mini_Warehouse_6185614/Oildrum_Lid_Ø50.stl",
    "/Pompompurin_ポムポムプリン_4649260/x.stl",
    "/Café/x.stl",
    "/odd #?%+ name/x & y=z.stl",
  ])("carries %j into the key as its raw bytes", (path) => {
    expect(keyOf(thumbUrl(path, MTIME))).toBe(
      `T1/t${path}/${MTIME}/${GEN}.webp`,
    );
    expect(keyOf(glbUrl(path, MTIME))).toBe(`M1/m${path}/${MTIME}.glb`);
  });

  it("does not normalise an NFD name to NFC", () => {
    const nfd = "/Café/x.stl";
    expect(keyOf(glbUrl(nfd, "1"))).not.toBe(
      keyOf(glbUrl(nfd.normalize("NFC"), "1")),
    );
  });

  it("passes an undecodable percent run, which the origin keeps raw", () => {
    const url = (p: string) => `${ORIGIN}/api/model.glb?path=${p}&mtime=1`;
    expect(reasonOf(url("/%FF.stl"))).toBe("encoding");
    expect(reasonOf(url("/%zz.stl"))).toBe("encoding");
    expect(keyOf(url("/%EF%BF%BD.stl"))).toBe("M1/m/�.stl/1.glb");
  });
});

describe("classify: method, headers and continent", () => {
  it.each(["HEAD", "POST"])("passes %s", (method) => {
    expect(reasonOf(thumbUrl(PATH, MTIME), { method })).toBe("method");
  });

  it("passes a ranged GET", () => {
    const headers = new Headers({ range: "bytes=0-99" });
    expect(reasonOf(glbUrl(PATH, MTIME), { headers })).toBe("conditional");
  });

  it.each([
    "if-none-match",
    "if-modified-since",
    "if-match",
    "if-unmodified-since",
    "if-range",
  ])("passes a conditional GET (%s)", (name) => {
    const headers = new Headers({ [name]: '"x"' });
    expect(reasonOf(thumbUrl(PATH, MTIME), { headers })).toBe("conditional");
  });

  it("keys NA and passes every other continent, or none", () => {
    expect(run(thumbUrl(PATH, MTIME), { continent: "NA" }).action).toBe(
      "store",
    );
    for (const continent of ["EU", "AS", "SA", null, undefined])
      expect(reasonOf(thumbUrl(PATH, MTIME), { continent })).toBe("continent");
  });
});

const pinned = (over: Record<string, string> = {}) =>
  new Headers({
    "content-type": THUMB_MIME,
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": "5600",
    etag: '"42"',
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    ...over,
  });

describe("storable", () => {
  it("stores a pinned 200 of the route's content-type", () => {
    expect(storable("thumb", 200, pinned())).toEqual({
      contentType: THUMB_MIME,
      cacheControl: "public, max-age=31536000, immutable",
      custom: {
        etag: '"42"',
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
    const glb = pinned({ "content-type": "application/octet-stream" });
    glb.delete("cross-origin-resource-policy");
    expect(storable("mesh", 200, glb)?.custom).toEqual({
      etag: '"42"',
      "x-content-type-options": "nosniff",
    });
  });

  it("stores exactly STORE_MAX_BYTES", () => {
    const h = pinned({ "content-length": String(STORE_MAX_BYTES) });
    expect(storable("thumb", 200, h)).not.toBeNull();
  });

  it.each([
    ["a 404", 404, pinned()],
    ["a no-cache 200", 200, pinned({ "cache-control": "no-cache" })],
    ["a no-store 200", 200, pinned({ "cache-control": "no-store" })],
    [
      "a wrong content-type",
      200,
      pinned({ "content-type": "application/json" }),
    ],
    [
      "an oversized length",
      200,
      pinned({ "content-length": String(STORE_MAX_BYTES + 1) }),
    ],
  ])("refuses %s", (_, status, headers) => {
    expect(storable("thumb", status, headers)).toBeNull();
  });

  it("refuses a missing length", () => {
    const h = pinned();
    h.delete("content-length");
    expect(storable("thumb", 200, h)).toBeNull();
  });

  it("refuses the other route's content-type", () => {
    expect(storable("mesh", 200, pinned())).toBeNull();
  });
});

describe("replay", () => {
  it("replays exactly the design's list plus content-length", () => {
    const h = pinned({
      "set-cookie": "a=b",
      "cf-cache-status": "MISS",
      vary: "accept",
      date: "Mon, 28 Sep 2026 00:00:00 GMT",
    });
    const stored = storable("thumb", 200, h);
    expect(stored).not.toBeNull();
    expect(replay(stored!, 5600)).toEqual({
      "content-type": THUMB_MIME,
      "cache-control": "public, max-age=31536000, immutable",
      etag: '"42"',
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "content-length": "5600",
    });
  });

  it("takes content-length from the object's size", () => {
    const stored = storable("thumb", 200, pinned())!;
    expect(replay(stored, 7)["content-length"]).toBe("7");
  });
});
