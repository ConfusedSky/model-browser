# Immutable Thumbnail Serving

## Why

`getThumb` already sends a versioned URL — `/api/thumb?path=…&mtime=…` plus the AO
variant — but the route sends no `Cache-Control` at all, so the browser refetches every
tile's response (meta plus base64 PNG, the payload's bulk) on every visit, re-buying
pixels it was handed last time. On the planned public demo the same gap makes every tile
a full origin round trip per visitor per visit — the single largest recurring transfer
cost identified by the trip-reduction thread in `docs/web-demo-notes.md` (2026-09-02),
and the cheapest to close: a response header and one URL parameter.

## What Changes

- The thumbnail sidecar and its wire echoes gain a **write generation**: a counter that
  moves on every write to the entry (a render landing, a camera saved or discarded).
  Any change to what a thumbnail URL would answer bumps it, so `path + mtime + ao + gen`
  fully names the response bytes.
- `GET /api/thumb` becomes cacheable in two tiers:
  - a request carrying the generation (`gen`) is answered **`immutable`** with a long
    `max-age` — the URL names the exact bytes, and any later write moves the client to a
    new URL, so the cached entry is simply never asked for again;
  - a request without `gen` (a client that cannot yet know it — a fresh session before
    any listing carried one) is answered with validator-based caching (`no-cache` +
    `ETag` derived from the generation), so a repeat visit costs a 304 instead of the
    full base64 payload;
  - a **miss** is never cacheable (`no-store`) — a tile must not stay empty after a
    render lands.
- The client tracks the generation it learns (from GET echoes and its own PUTs) and
  sends it when known. When `listing-tree-cache`'s thumbnail-state layer lands, listings
  deliver the generation per entry and every tile fetch is fully keyed from the first
  request — that change's declared seam; this one works without it, degrading to 304s.
- No storage change anywhere: one PNG per path and recipe on disk, overwritten in place
  exactly as today. The only aged copies live in browser and CDN caches under their own
  eviction.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-thumbnails`: one ADDED requirement (thumbnail responses are cacheable by their
  key, with the generation's semantics). ADD-only beside `thumbnail-sweep-priority`'s
  active MODIFYs of *Client-side thumbnail rendering* and *Recipe-labelled thumbnails* —
  no title overlap, checked 2026-09-02.

## Impact

- `server/src/cache.ts` — the sidecar gains `gen`; reads echo it, writes bump it.
- `server/src/app.ts` — `GET /api/thumb` reads `gen`, sets `Cache-Control`/`ETag`,
  answers 304 on a matching validator; `PUT /api/thumb` echoes the new generation.
- `client/src/api/client.ts` — `getThumb` passes `gen` when known; `ThumbResult` and the
  PUT result carry it; `useThumbnails` keeps it per entry (in the slot it already holds).
- `shared/types.ts` — additive `gen` on the thumb wire shapes.
- Coordination: `thumbnail-sweep-priority` (active) MODIFYs other requirements in the
  same capability and touches `useThumbnails` — additive fields only here, and re-read
  its delta before archiving either change. `listing-tree-cache` (active) declares the
  generation-per-entry seam this change consumes later; neither blocks the other.
- The demo (`web-demo-backlog` 1.3) inherits full immutability for free: a read-only
  baked cache never bumps a generation, and a CDN edge can hold every tile.
