# Thumbnail Image Serving

## Why

Measured 2026-09-02 on the real library (this session's run — re-measure before
citing, task 6.1): opening the 500-tile flat root with ~60% of its thumbnails
already cached cost **618 `/api/thumb` lookups, 49.7 MB over the wire and 65
seconds of wall time** — against one `/api/dir` at 434 ms and a pose wave of
two requests at 37 ms. Every cached tile is a separate JSON request whose body
carries the PNG *base64-encoded* (~80 KB each), parsed by the client into a
Blob and minted as an object URL, through an 8-wide FIFO limiter that makes a
visible tile's hit wait behind hundreds of off-screen ones, on a disk the
thumbnail-sweep drain is reading meshes from at the same time. A local server
feels slow because the cached path costs almost as much as the uncached one.

`immutable-thumbnail-serving` (2026-09-02) made those lookups HTTP-cacheable
by generation, and `listing-tree-cache` §6 will attach each entry's thumbnail
state to the listing. Neither removes the request: the first keeps its JSON
body, and its own Non-Goals rule out an image response; the second delivers
the *state*, not the bytes. This change is the shape both were pointing at.

## What Changes

- **Cached thumbnails are images the tile references by URL.** A new
  `GET /api/thumb/image` answers the PNG bytes directly — `image/png`,
  `immutable` when the URL names the current generation, the same
  `path + mtime + ao + gen` key `immutable-thumbnail-serving` defined. A tile
  whose listing entry says "cached under the current recipe, generation N"
  sets `<img src>` to that URL and never calls `getThumb`: no limiter, no JSON,
  no base64 (−33% bytes), no Blob, no object URL to own, native parallel
  fetching, and on a revisit the browser's own cache answers with zero bytes.
- **The listing carries what a lookup used to answer.** The per-entry
  thumbnail state `listing-tree-cache` §6.2/6.3 attaches — presence and
  staleness per occlusion variant, the write generation, `framed` — is joined
  here by the recipe labels the client's staleness test reads (`lighting`,
  `rig`, `posed`) and the stored `camera`/`axis`, so the client applies the
  *same* test it applies to a `getThumb` answer today, locally, per entry,
  from the listing. The test stays client-side: `RIG_VERSION` and
  `POSE_VERSION` are client constants the server deliberately never
  interprets.
- **A lookup is issued only for what the listing could not answer** — an
  entry with no annotation (the index has not seen it), a stale or missing
  render, or a pose the client holds that the entry's `posed` predates. Those
  lookups are **ranked like renders**: the lookup limiter takes the same band
  map the render queue does, so a visible tile's lookup no longer waits behind
  off-screen ones.
- **Far mesh reads yield to pending lookups.** The render queue does not
  dispatch `far`-ranked work while lookups are pending — a cache hit for a
  tile on screen must never wait on a deferred tile's 25 MB read. Everything
  nearer than far is unaffected; the idle drain resumes the moment lookups
  settle.
- **Freshly rendered pixels keep their object URL** until eviction, as today —
  the bytes are already in memory, and a PUT's echoed generation is what the
  *next* listing will name. Nothing about rendering, the recipe, `RIG_VERSION`
  or the cache's on-disk shape changes.
- Unchanged: `GET /api/thumb`'s JSON contract (still served, still the
  fallback for what the listing cannot answer), the PUT, the sidecars, the
  sweep's ranking and deferral, the pose wave (37 ms is not a problem worth a
  change; §6.1's pose layer shrinks it further on its own).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-thumbnails`: ADD *Cached thumbnails are served as images* (the image
  endpoint and its caching contract); ADD *A listing-known thumbnail is drawn
  without a lookup* (the client consumes the entry's state and labels, applies
  its staleness test locally, and references the image by URL); ADD *Lookups
  are ranked with renders*; ADD *Far reads yield to pending lookups*. All
  ADD-only with distinct titles: `immutable-thumbnail-serving` ADDs *Thumbnail
  responses are cacheable by their key* here and this change builds on it;
  `listing-tree-cache` ADDs to `listing-cache` (*Derived annotations ride the
  listing*), which is the annotation this change reads and does not redefine.

## Impact

- `server/src/app.ts` — `GET /api/thumb/image` beside `GET /api/thumb`: same
  key, same generation tiers, `image/png` body, `no-store` on a miss. The
  listing emission attaches the recipe labels and stored camera/axis to
  `listing-tree-cache` 6.3's per-entry annotation (one additive object; this
  change owns its fields, that change owns the index they come from).
- `server/src/cache.ts` — the in-memory index of 6.2 exposes labels and
  camera/axis per entry alongside presence/staleness/gen; a read of the PNG
  bytes by key for the image route.
- `shared/types.ts` — `DirEntry.thumb?` (additive): per-variant
  `{ state: 'hit' | 'stale' | 'miss', lighting?, rig?, posed? }`, plus
  entry-level `gen`, `camera?`, `axis?`, `framed`.
- `client/src/api/client.ts` — `thumbImageUrl(path, mtime, ao, gen)`; no new
  fetch.
- `client/src/hooks/useThumbnails.ts` — the slot's `start` reads the entry's
  annotation first and, where it answers, sets the tile's URL to the image URL
  and issues no lookup; the lookup limiter becomes rank-aware (`setBands`
  feeds it the same map); object-URL ownership applies only to `blob:` URLs.
- `client/src/three/queue.ts` — a `lookupsPending` gate on `far` dispatch.
- `client/src/components/Grid.tsx` — none: a tile draws `thumb.url` whatever
  scheme it is.
- Ordering: **after `listing-tree-cache` §6** (this consumes its per-entry
  annotation and its `ThumbCache` index) and after `immutable-thumbnail-serving`
  (already landed). Coordinate the annotation's field names with that change's
  6.3 before either lands — this proposal names them; that change's task
  should adopt or amend them, not invent a second shape.
