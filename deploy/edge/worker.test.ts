import { describe, expect, it } from "vitest";
import { handle, putIfAbsent, type Env } from "./worker";

const BASE = "https://models.example";
const MTIME = "1789446597239.1736";
const GEN = "1789519399619";
const THUMB = `${BASE}/api/thumb/image?path=${encodeURIComponent("/Kit/a.stl")}&mtime=${MTIME}&gen=${GEN}`;
const GLB = `${BASE}/api/model.glb?path=${encodeURIComponent("/Kit/a.stl")}&mtime=${MTIME}`;
const THUMB_KEY = `T1/t/Kit/a.stl/${MTIME}/${GEN}.webp`;

const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5]);

const PINNED: Record<string, string> = {
  "content-type": "image/webp",
  "cache-control": "public, max-age=31536000, immutable",
  "content-length": String(BYTES.length),
  etag: '"abc"',
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-site",
};

interface Entry {
  bytes: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

class FakeBucket {
  map = new Map<string, Entry>();
  gets = 0;
  puts = 0;
  getThrows = false;
  putThrows = false;

  async get(key: string) {
    this.gets++;
    if (this.getThrows) throw new Error("r2 down");
    const e = this.map.get(key);
    if (e === undefined) return null;
    return {
      body: new Blob([e.bytes]).stream(),
      size: e.bytes.length,
      httpMetadata: e.httpMetadata,
      customMetadata: e.customMetadata,
    };
  }

  async put(key: string, body: ArrayBuffer, options: R2PutOptions) {
    this.puts++;
    if (this.putThrows) throw new Error("r2 down");
    const onlyIf = options.onlyIf as R2Conditional | undefined;
    if (onlyIf?.etagDoesNotMatch === "*" && this.map.has(key)) return null;
    this.map.set(key, {
      bytes: new Uint8Array(body),
      httpMetadata: options.httpMetadata as R2HTTPMetadata,
      customMetadata: options.customMetadata,
    });
    return {};
  }
}

function setup(answer: () => Response = () => pinned()) {
  const bucket = new FakeBucket();
  const env: Env = {
    STORE: bucket as unknown as R2Bucket,
    THUMB_EPOCH: "T1",
    MESH_EPOCH: "M1",
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const calls: Request[] = [];
  const origin = async (r: Request) => {
    calls.push(r);
    return answer();
  };
  const send = async (url: string, continent: string | null = "NA") => {
    const req = new Request(url);
    if (continent !== null)
      Object.defineProperty(req, "cf", { value: { continent } });
    const before = calls.length;
    const res = await handle(req, env, ctx, origin);
    return { res, originCalls: calls.length - before };
  };
  const settle = () => Promise.all(pending);
  return { bucket, send, settle, pending };
}

function pinned(over: Record<string, string> = {}, status = 200): Response {
  return new Response(BYTES, { status, headers: { ...PINNED, ...over } });
}

const body = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe("handle", () => {
  it("passes another continent through untouched", async () => {
    const t = setup();
    const { res, originCalls } = await t.send(THUMB, "EU");
    expect(res.headers.get("x-edge-store")).toBe("pass");
    expect(await body(res)).toEqual(BYTES);
    expect(originCalls).toBe(1);
    expect(t.bucket.gets + t.bucket.puts).toBe(0);
  });

  it("passes a request without cf as another continent", async () => {
    const t = setup();
    const { res } = await t.send(THUMB, null);
    expect(res.headers.get("x-edge-store")).toBe("pass");
    expect(t.bucket.gets).toBe(0);
  });

  it("passes a request naming no version untouched", async () => {
    const t = setup();
    const { res, originCalls } = await t.send(
      `${BASE}/api/model.glb?path=%2FKit%2Fa.stl`,
    );
    expect(res.headers.get("x-edge-store")).toBe("pass");
    expect(await body(res)).toEqual(BYTES);
    expect(originCalls).toBe(1);
    expect(t.bucket.gets + t.bucket.puts).toBe(0);
  });

  it("fills on a miss, then answers the stored copy with the replayed headers", async () => {
    const t = setup();
    const first = await t.send(THUMB);
    expect(first.res.headers.get("x-edge-store")).toBe("filled");
    expect(first.res.status).toBe(200);
    expect(await body(first.res)).toEqual(BYTES);
    expect(first.originCalls).toBe(1);

    await t.settle();
    const entry = t.bucket.map.get(THUMB_KEY);
    expect(entry?.bytes).toEqual(BYTES);
    expect(entry?.httpMetadata).toEqual({
      contentType: PINNED["content-type"],
      cacheControl: PINNED["cache-control"],
    });
    expect(entry?.customMetadata).toEqual({
      etag: PINNED.etag,
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-site",
    });

    const second = await t.send(THUMB);
    expect(second.originCalls).toBe(0);
    expect(second.res.status).toBe(200);
    expect(await body(second.res)).toEqual(BYTES);
    expect(Object.fromEntries(second.res.headers)).toEqual({
      ...PINNED,
      "x-edge-store": "hit",
    });
  });

  it("keys the mesh route under its own epoch", async () => {
    const t = setup(() =>
      pinned({ "content-type": "application/octet-stream" }),
    );
    const { res } = await t.send(GLB);
    expect(res.headers.get("x-edge-store")).toBe("filled");
    await t.settle();
    expect([...t.bucket.map.keys()]).toEqual([`M1/m/Kit/a.stl/${MTIME}.glb`]);
  });

  it.each([
    ["a no-cache 200", () => pinned({ "cache-control": "no-cache" })],
    ["a 404", () => pinned({}, 404)],
  ])("does not store %s", async (_, answer) => {
    const t = setup(answer);
    const { res, originCalls } = await t.send(THUMB);
    expect(res.headers.get("x-edge-store")).toBe("pass");
    expect(originCalls).toBe(1);
    await t.settle();
    expect(t.bucket.puts).toBe(0);
    expect(t.bucket.map.size).toBe(0);
  });

  it("passes the origin's answer through when the read throws", async () => {
    const t = setup();
    t.bucket.getThrows = true;
    const { res, originCalls } = await t.send(THUMB);
    expect(res.headers.get("x-edge-store")).toBe("pass");
    expect(await body(res)).toEqual(BYTES);
    expect(originCalls).toBe(1);
    expect(t.bucket.puts).toBe(0);
  });

  it("never serves an object missing its content-type", async () => {
    const t = setup();
    t.bucket.map.set(THUMB_KEY, {
      bytes: new Uint8Array([9, 9]),
      httpMetadata: { cacheControl: PINNED["cache-control"] },
    });
    const { res, originCalls } = await t.send(THUMB);
    expect(res.headers.get("x-edge-store")).toBe("pass");
    expect(await body(res)).toEqual(BYTES);
    expect(originCalls).toBe(1);
  });

  it("puts only on an absent key", async () => {
    const t = setup();
    const store = t.bucket as unknown as R2Bucket;
    const first = new Uint8Array([7]);
    expect(await putIfAbsent(store, "k", first.buffer, {})).not.toBeNull();
    expect(await putIfAbsent(store, "k", BYTES.buffer, {})).toBeNull();
    expect(t.bucket.map.get("k")?.bytes).toEqual(first);
  });

  it("answers the visitor even when the store write fails", async () => {
    const t = setup();
    t.bucket.putThrows = true;
    const { res, originCalls } = await t.send(THUMB);
    expect(res.headers.get("x-edge-store")).toBe("filled");
    expect(await body(res)).toEqual(BYTES);
    expect(originCalls).toBe(1);
    await expect(t.settle()).resolves.toBeDefined();
    expect(t.bucket.puts).toBe(1);
  });
});
