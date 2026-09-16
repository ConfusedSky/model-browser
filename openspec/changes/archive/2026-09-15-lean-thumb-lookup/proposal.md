## Why

The JSON thumbnail lookup answers with the render base64'd into its body, on every hit,
for every caller. Two of the three callers throw those bytes away. The lightbox's open
reads a saved camera and axis off the answer and nothing else — and never revoked the
object URL the client minted for the pixels, so every open leaked one.
`renderEntryThumbnail` reads the orientation and the staleness verdict, minted the URL
and revoked it on the next line. Only `useThumbnails`' fallback, for a tile the listing
did not annotate, actually shows what it was sent.

The render is the whole weight of the answer. Measured over this machine's cache on
2026-09-15, 608 renders (`find ~/.cache/model-browser -name "*.webp" -printf "%s\n" |
sort -n`): 6,260 bytes median, 17,334 max, so ~8.3 KB of base64 at the median against a
few hundred bytes of labels. The bulk jobs pay it per entry over a whole library, and
the demo pays it over a network rather than a loopback socket.

The HTTP tiers `immutable-thumbnail-serving` established already spare a *repeat* of the
same URL. What they cannot spare is the first call, and these two callers are all first
calls: each names an entry the caller is about to re-render or open.

## What Changes

- **A lookup may ask for no pixels.** `GET /api/thumb` takes `pixels`, read exactly as
  `ao` is: `off` withholds the render, `on` and absent serve it. An unknown value is a
  400, as an unknown `ao` is.
- **The verdict is not weakened.** The server still reads the render file — `stat` is a
  different question than a read, and a file that answers a `stat` and throws on a read
  would be reported as a hit whose pixels no one can get. What is saved is the base64
  and the wire, not the disk.
- **`ApiClient.getThumb` takes the flag** and mints no object URL under it, even if a
  body arrives carrying pixels. `ViewerLayer`'s open and `renderEntryThumbnail` pass it;
  `useThumbnails` does not.
- `renderEntryThumbnail` drops its `pngUrl !== undefined` gate — `isCurrentRender`
  already requires `state === "hit"`, which is the same fact — and the two
  `revokeObjectURL` calls that existed only to clean up after the answer.

## Impact

- Affected specs: `model-thumbnails`
- Affected code: `server/src/app.ts` (`/api/thumb`), `server/src/cache.ts`
  (`ThumbCache.get`), `client/src/api/client.ts` (`ApiClient.getThumb`,
  `HttpApiClient.getThumb`), `client/src/viewer/ViewerLayer.tsx`,
  `client/src/lib/entryActions.ts`
- No wire break: a client that names no `pixels` sends the bytes it always sent and
  receives the answer it always received. `off` is a distinct URL, so no cache entry —
  browser, edge or otherwise — can hand a pixel-less body to a caller that asked for
  pixels.
