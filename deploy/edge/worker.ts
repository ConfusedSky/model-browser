import { classify, replay, storable, type Classified } from "./route";

export interface Env {
  STORE: R2Bucket;
  THUMB_EPOCH: string;
  MESH_EPOCH: string;
  // Development only: `wrangler dev` would otherwise fetch from itself.
  ORIGIN?: string;
}

export type Origin = (request: Request) => Promise<Response>;

type Ctx = Pick<ExecutionContext, "waitUntil">;

type StoreHeader = "hit" | "filled" | "pass";

function tagged(res: Response, value: StoreHeader): Response {
  const out = new Response(res.body, res);
  out.headers.set("x-edge-store", value);
  return out;
}

/** R2 must never overwrite a stored version, so a put only lands on an absent key. */
export function putIfAbsent(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer,
  options: Omit<R2PutOptions, "onlyIf">,
): Promise<R2Object | null> {
  return bucket.put(key, body, {
    ...options,
    onlyIf: { etagDoesNotMatch: "*" },
  });
}

/** `null` is a miss; "fail" is a store the Worker cannot trust, so it passes through. */
async function stored(
  bucket: R2Bucket,
  key: string,
): Promise<Response | null | "fail"> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    return "fail";
  }
  if (object === null) return null;
  const { contentType, cacheControl } = object.httpMetadata ?? {};
  // An object without its headers cannot be replayed as the origin's answer.
  if (contentType === undefined || cacheControl === undefined) {
    // Never overwritten, so only an epoch advance or a manual delete clears it.
    console.warn(`edge store: ${key} lacks its headers; passing through`);
    return "fail";
  }
  const headers = new Headers(
    replay(
      { contentType, cacheControl, custom: object.customMetadata ?? {} },
      object.size,
    ),
  );
  headers.set("x-edge-store", "hit");
  return new Response(object.body, { status: 200, headers });
}

export async function handle(
  request: Request,
  env: Env,
  ctx: Ctx,
  origin: Origin,
): Promise<Response> {
  const continent = request.cf?.continent;
  let route: Classified;
  try {
    route = classify({
      method: request.method,
      url: request.url,
      headers: request.headers,
      continent: typeof continent === "string" ? continent : null,
      thumbEpoch: env.THUMB_EPOCH,
      meshEpoch: env.MESH_EPOCH,
    });
  } catch {
    route = { action: "pass", reason: "classify" };
  }
  if (route.action === "pass") return tagged(await origin(request), "pass");

  const hit = await stored(env.STORE, route.key);
  if (hit === "fail") return tagged(await origin(request), "pass");
  if (hit !== null) return hit;

  const res = await origin(request);
  const keep = storable(route.kind, res.status, res.headers);
  if (keep === null) return tagged(res, "pass");

  const copy = res.clone();
  const { key } = route;
  ctx.waitUntil(
    (async () => {
      try {
        await putIfAbsent(env.STORE, key, await copy.arrayBuffer(), {
          httpMetadata: {
            contentType: keep.contentType,
            cacheControl: keep.cacheControl,
          },
          customMetadata: keep.custom,
        });
      } catch {
        // The visitor already has the origin's answer; the next miss retries.
      }
    })(),
  );
  return tagged(res, "filled");
}

function originFor(env: Env): Origin {
  const base = env.ORIGIN;
  if (base === undefined) return (r) => fetch(r);
  return (r) => {
    const url = new URL(r.url);
    return fetch(new Request(new URL(url.pathname + url.search, base), r));
  };
}

export default {
  fetch(request, env, ctx) {
    // An uncaught throw then reaches the origin instead of answering an error it never gave.
    ctx.passThroughOnException();
    return handle(request, env, ctx, originFor(env));
  },
} satisfies ExportedHandler<Env>;
