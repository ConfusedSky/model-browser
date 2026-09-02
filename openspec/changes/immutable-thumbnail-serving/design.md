# Design — immutable-thumbnail-serving

## Context

`GET /api/thumb` (in `app.ts`) answers a JSON body: sidecar meta plus the PNG as base64
(`ThumbGetResponse.png`, which `getThumb` turns into a blob URL via `base64ToBlobUrl`).
The URL already carries `path`, `mtime`, and the AO variant — the request names a
specific render (`ao-as-recipe-dimension` D2) — but no response sets `Cache-Control`, so
the browser treats every answer as uncacheable and refetches the full payload per tile
per visit. `ThumbCache` (`cache.ts`) stores one PNG per path and recipe plus one JSON
sidecar `{mtime, lighting, rig, posed}` with `camera`/`axis`; writes overwrite in place.

Two facts complicate naive immutability, and the decisions below exist for them:

- **The response is not a pure function of the current URL.** The camera is *authored* —
  an orbit release PUTs new pixels and a new camera at the same `path + mtime`. Marking
  today's URL immutable would pin pre-orbit pixels in the browser forever.
- **A response can be a miss** (`status` not `hit`), and a cached miss would leave a tile
  permanently empty after its render lands.

## Goals / Non-Goals

**Goals:**
- A repeat visit re-downloads zero thumbnail bytes for tiles that have not changed.
- Any write to an entry is visible on the next fetch — no stale pinning, ever.
- Zero storage added anywhere the app owns; no on-disk migration (additive sidecar field).
- Works standalone today; upgrades to zero *requests* when `listing-tree-cache`'s
  thumbnail-state layer delivers generations with listings.

**Non-Goals:**
- Splitting the PNG out of the JSON body into an image response. It would drop the
  base64 overhead (~33%) but reshape the wire `ao-as-recipe-dimension` D2's
  compatibility argument rests on, for a payload the cache makes free on revisits anyway.
- The listing-attached thumbnail state itself — that is `listing-tree-cache`'s D7 layer;
  this change only defines the generation it will carry.
- Demo-mode serving policy (1.3's business); it inherits this mechanism unchanged.

## Decisions

### D1: A write generation, bumped by every write, is the one cache validator

The sidecar gains `gen: number` (additive; an entry without one reads as 0). Every
`ThumbCache` write for the entry — PNG replaced, camera set or discarded, axis changed —
increments it. `path + mtime + ao + gen` then fully names the response bytes: mtime
covers the model changing, ao the recipe requested, gen every server-side write
including the authored camera. Nothing else can change the answer, so no other component
(rig, lighting, posed) belongs in the key — those change only via a re-render, which is
a write, which bumps gen. A `RIG_VERSION` bump alone rewrites nothing and pins nothing:
the stale-rig response stays cached at its gen until the client re-renders and PUTs,
which bumps gen and moves every subsequent fetch to a new URL.

*Alternative — hash the response:* content-addressing without a counter, but the ETag
would have to be computed per request from the body, and the client could never predict
the URL; a counter is predictable, cheap, and the listing layer can carry it.

### D2: Two caching tiers, decided by whether the client could know the generation

A client that knows the current gen sends it and gets `Cache-Control: public,
max-age=31536000, immutable`. A client that cannot know it (first fetch of a session
today — nothing has told it) omits `gen` and gets `Cache-Control: no-cache` plus an
`ETag` built from the generation, answering 304 to a matching `If-None-Match`: one
round trip, ~zero bytes, instead of the full base64 payload. This is what makes the
change independent of `listing-tree-cache`: today every first-per-session fetch is a
cheap 304; once listings carry the gen (that change's declared seam), the client is
fully keyed from the start and the 304s disappear too. The upgrade is additive on both
sides of the wire.

The gen-carrying request must also *answer* the current gen in the body: a stale-gen
request (the client's number lost a race with a concurrent write) is answered with the
current bytes and current gen, un-cached (`no-cache`), so the client re-keys — never a
redirect, never an error.

### D3: A miss is `no-store`

Only a `hit` participates in caching at all. A miss cached even briefly outlives the
render that fills it — the exact tile-stays-empty failure — and misses are cheap to
re-ask (no base64 body). `no-store` on every non-hit answer, unconditionally.

### D4: The client learns generations passively and keeps them where slots already live

`getThumb` responses and `PUT /api/thumb` responses echo `gen`; `useThumbnails` keeps it
on the per-entry slot it already maintains (the `EntrySlot` map), and passes it on the
next fetch for that entry. No new store, no persistence — a session that never learned a
gen just rides the 304 tier. This is deliberately the same passive shape
`ao-as-recipe-dimension` used for `rig`/`lighting` echoes.

## Risks / Trade-offs

- [Browser caches a gen-keyed response, then the entry is evicted server-side and
  re-rendered from scratch at gen 0] → gen must never regress: `ThumbCache` seeds a
  fresh entry's gen from a monotonic source when the sidecar is absent — the simplest
  sound one is `Date.now()` at first write, with increments from there — so a
  re-created entry's gen is always above any the browser has seen. (A plain 0-seeded
  counter would re-issue old URLs with new bytes.)
- [Two clients orbit the same entry concurrently] → last write wins exactly as today;
  gen serializes under `ThumbCache`'s existing write path, and D2's stale-gen answer
  re-keys the loser on its next fetch.
- [`immutable` pins a bug: a corrupt PNG cached forever] → the write that fixes it
  bumps gen; the bad URL is abandoned, not purged. Same story as any content change.
- [CDN behavior on the demo] → both tiers are standard HTTP semantics; an edge holds
  gen-keyed tiles indefinitely and revalidates gen-less ones against origin. Nothing
  demo-specific in this change.
