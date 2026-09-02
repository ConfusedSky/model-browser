# Thumbnail Image Serving

> Reviewed twice before implementation (2026-09-02): a peer session's review
> (eviction fallback, the `gen` contract) and a fresh opus review whose
> twenty-three findings are folded in here and dispositioned in design D8.
> The second review also corrected this proposal's cost story — read the Why
> as it stands, not as first drafted.

## Why

Measured 2026-09-02 on the real library (this session's run — re-measure before
citing, task 6.2): opening the 500-tile flat root with ~60% of its thumbnails
already cached cost **618 `/api/thumb` lookups, 49.7 MB over the wire and 65
seconds of wall time** — against one `/api/dir` at 434 ms and a pose wave of
two requests at 37 ms. Every cached tile is a separate JSON request whose body
carries the PNG base64-encoded (~80 KB each), parsed into a Blob and minted as
an object URL, through an 8-wide FIFO limiter that makes a visible tile's hit
wait behind hundreds of off-screen ones.

What those 65 seconds are, honestly: 49.7 MB at ~765 KB/s over loopback is not
a transport cost. It is the USB disk serving 618 PNG reads while the sweep's
far drain pulled 2.4 GB of meshes off the same head. So the wins are three,
and they are not the same win:

1. **On a first visit, the cost is how many cached tiles are looked up at
   all.** A tile far off screen does not need its 80 KB in memory until the
   user approaches it. Today's limiter looks up every tile in listing order;
   ranking those lookups by the sweep's band map and *holding* the far ones
   turns 618 reads into the ~16 on screen plus the near band — a pure client
   change on machinery that already exists, and the first step here (§0).
2. **On a revisit, the cost should be zero.** `immutable-thumbnail-serving`
   made the lookup cacheable by generation, but a cacheable JSON request is
   still a request, a parse and a Blob. An image the tile references by URL is
   answered by the browser's own cache with no request, once the listing can
   say which image and which generation.
3. **A lookup for a tile the user can see must not wait on the drain.** The
   deferred far reads and the cache lookups share one disk; ranking cannot
   express "do not start that 25 MB read while this 50 KB read waits" across
   two queues, a gate can.

`listing-tree-cache` §6 will attach each entry's thumbnail state to the
listing; `immutable-thumbnail-serving` gave the lookup its generation and
cache tiers. Neither removes the request. This change is the shape both were
pointing at, staged so the half that needs nothing from anyone lands first.

## What Changes

- **§0, landable today: far lookups are held, and lookups are ranked.** The
  lookup limiter becomes a ranked queue on the same band map that ranks
  renders; a lookup for a `far` tile is not issued until the tile is nearer.
  Unlike renders, held lookups do *not* drain at idle: a lookup warms nothing
  on disk, it only pulls an off-screen tile's PNG into memory, and on a cached
  500-tile listing that is 500 Blobs nobody is looking at. This step alone
  captures most of the measured first-visit cost with no server work and no
  dependency on another change.
- **Cached thumbnails are images the tile references by URL.** A new
  `GET /api/thumb/image` answers the PNG bytes — `image/png`, `immutable`
  when the URL names the current generation, on the same `path + mtime + ao +
  gen` key and the same three tiers `immutable-thumbnail-serving` defined. A
  tile whose listing entry says "cached under a recipe the client judges
  current, generation N" sets `<img src>` to that URL and never calls
  `getThumb`. The image is `loading="lazy"`, so a cached listing costs a
  screenful of image fetches, not a listing's worth; on a revisit the
  browser's cache answers with no request.
- **The listing carries what a lookup used to answer.** The per-entry state
  `listing-tree-cache` §6.2/6.3 attaches is joined by the recipe labels the
  client's usability test reads and the stored camera/axis, so the client
  applies the *same* test it applies to a `getThumb` answer today, locally,
  per entry. The test stays client-side: `RIG_VERSION` and `POSE_VERSION` are
  client constants the server deliberately never interprets. The annotation
  is attached wherever model entries are emitted — the directory and flat
  listings, peeks, and the two scoring routes' hit joins — so a meaning or
  similarity grid gets it too.
- **Far mesh reads yield to pending lookups for nearer tiles.** The render
  queue does not dispatch `far`-ranked work while a lookup ranked nearer than
  far is pending — and the gate is time-bounded, so one wedged lookup cannot
  freeze the idle drain the sweep promised.
- **A listing-drawn tile recovers on its own.** An entry evicted between
  emission and fetch answers 404; the image's `onError` demotes the entry to
  the lookup path, once per generation, remembered on the slot.
- **The cache's eviction clock is kept honest.** The image route bumps the
  same least-recently-read clock the lookup bumps; a browser-cached view is
  invisible to the server by design, and that trade is recorded rather than
  hidden (design D7).
- Unchanged: `GET /api/thumb`'s JSON contract (still served, still the answer
  for what the listing cannot say), the PUT, the sidecars, the sweep's
  ranking and deferral of renders, every pixel, `RIG_VERSION`, and the pose
  wave — 37 ms is not a problem worth a change, and §6.1's pose layer shrinks
  it further on its own.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-thumbnails`: ADD *Cached thumbnails are served as images*; ADD *A
  listing-known thumbnail is drawn without a lookup*; ADD *Lookups are ranked
  with renders, and far lookups wait*; ADD *Far reads yield to pending
  lookups* (which says in its own words that it qualifies *Client-side
  thumbnail rendering*'s deferral rule, and that the gate is bounded so "a
  listing left open warms itself" survives). All ADD-only with distinct
  titles — checked against main and every active delta:
  `immutable-thumbnail-serving` ADDs *Thumbnail responses are cacheable by
  their key* here and this change builds on it; `listing-tree-cache` ADDs to
  `listing-cache` (*Derived annotations ride the listing*), the annotation
  this change consumes and does not redefine.

## Impact

- `client/src/hooks/useThumbnails.ts` — (§0) the lookup limiter becomes a
  module-level ranked queue whose far rank is held, with one helper writing
  both queues' rankings (the per-listing reset included) and a test reset;
  `start` reads the entry's annotation first and, where it answers, the
  tile's state is seeded in the same batch that seeds `loading` — never a
  competing `setThumb` — at the image URL with the entry's camera/axis and
  `gen`; the survivor test includes the annotation's generation; object-URL
  ownership applies to `blob:` URLs only; an `onError` demotion remembered
  per slot and generation.
- `client/src/three/queue.ts` — `pending` (live jobs, husks excluded), a
  far gate with a liveness bound, `onIdle`, `poke`, and a held-far mode for
  the lookup instance.
- `client/src/components/Grid.tsx` — the tile `<img>` gets a declared square
  box (`aspect-ratio: 1/1`) so `overlayRectFor` measures a real rect before
  the lazy image loads, `loading="lazy"`/`decoding="async"`, a placeholder
  until `load`, and an `onError` that reports the *path* it draws — `ThumbView`
  is shared with folder-sheet cells.
- `client/src/App.tsx` — `overlayRectFor`'s fallback widened to an `<img>`
  with no box yet; the `onImageError` callback held by identity.
- `client/src/api/client.ts` — `thumbImageUrl(path, mtime, ao, gen)`; no new
  fetch. (`getThumb` still takes no abort signal — noted, not changed here.)
- `server/src/app.ts` — `GET /api/thumb/image` beside `GET /api/thumb`,
  sharing one extracted tier helper; the annotation attached at every
  model-entry emission site.
- `server/src/cache.ts` — the image bytes read for the route, bumping the LRU
  clock exactly as the JSON hit does; the 6.2 index exposes per-variant labels
  and camera/axis and stores the sidecar's mtime so `state` is *derived* at
  emission, never stored.
- `shared/types.ts` — `DirEntry.thumb?` (additive), design D2's shape.
- Ordering: §0/§3/§4 and the image route (§1.1–1.2) depend on nothing
  unlanded and can start today. The annotation half — 1.3, 1.4, 2.2's first
  branch, 2.5, 5.1, 5.3, 6.2 — waits on `listing-tree-cache` §6, whose 6.3
  already carries this change's field shape (its tasks, 2026-09-02).
