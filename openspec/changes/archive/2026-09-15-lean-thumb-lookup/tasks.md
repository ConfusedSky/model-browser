## 1. The route

- [x] 1.1 `GET /api/thumb` reads a `pixels` query beside `ao` — `on`/`off`/absent, an
      unknown value answered 400 `invalid pixels: <value>` before the library resolve, as
      an unknown `ao` is — and passes it to `ThumbCache.get`. Verify: `server/test/api.test.ts`
      "reads an explicit `pixels=on` as the render, exactly as an absent one" and "rejects
      a `pixels` query that is neither on nor off"
- [x] 1.2 `ThumbCache.get` takes `pixels` and drops the render from the answer **after**
      `read` — `read` itself unchanged, so the hit/stale verdict and the LRU clock are the
      same for both callers (design D2). Verify: `server/test/cache.test.ts` "answers
      without the render when the caller asks for no pixels, and still calls a vanished
      file stale" and "bumps the render's LRU clock on a pixel-less read"
- [x] 1.3 The hit tiers are untouched: a lean hit carries the same `ETag` and answers a
      matching `If-None-Match` with a 304. Verify: the revalidation half of
      `server/test/api.test.ts` "serves the answer without the render when `pixels=off`"

## 2. The client

- [x] 2.1 `ApiClient.getThumb` gains `pixels`, appended to the URL only when false — the
      rule `ao` and `gen` follow, so a caller that knows nothing new sends byte-identical
      requests. Verify: `client/test/apiClient.test.ts` "getThumb asks for no pixels only
      when told to, and drops the render from the answer"
- [x] 2.2 No object URL is minted under the flag, whatever the body carries (design D3).
      Verify: the `lean.pngUrl` / default-call halves of the same cell
- [x] 2.3 `ViewerLayer`'s open passes it — the call that read a camera off a full answer
      and leaked the URL minted for its pixels. Verify: `client/test/lightboxClose.test.tsx`
      "opened at a stored camera" asserts the five-argument call, which no tile lookup makes
- [x] 2.4 `renderEntryThumbnail` passes it, drops the `pngUrl !== undefined` gate (design
      D4) and the two `revokeObjectURL` calls. Verify: `client/test/thumbnailCommands.test.ts`
      "read the stored orientation from the cache" and "answers current for an entry
      already drawn"

## 3. The record

- [x] 3.1 `ThumbGetResponse.png` and `ThumbResult.pngUrl` say that a hit carries no
      pixels when the read asked for none — both docs read "present on a hit" flatly
      before, which the change made false
- [x] 3.2 The measurement lives in `/api/thumb`'s own comment with the command that
      re-runs it and the date it was taken, and is not retyped anywhere else
