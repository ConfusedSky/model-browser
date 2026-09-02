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

### D1: A write generation, allocated monotonically, is the one cache validator

The sidecar gains `gen: number` (additive; an entry without one reads as 0), and it is
**entry-level, not per-render** — necessarily so: `put()` invalidates the ao *sibling*
in three cases (`supersedes` → the sibling PNG is removed; `moved` and the
unowned-pose rule → `clearRecipe`), so a per-render gen would leave the invalidated
sibling's URL unchanged while its bytes changed. Accepted cost: a write to one variant
churns the other variant's cached URL once.

Every `ThumbCache` write for the entry — either render's PNG, camera set or discarded,
axis changed — assigns a fresh gen from a **module-level monotonic allocator**, never
`prev + 1` computed inside the merge: `put()` is an unserialized read-modify-write (its
own comment accepts the stale-sidecar race as unclosable without locking), and a
prev-derived increment can issue the same gen twice with different bytes — which under
`immutable` pins the loser's pixels in a browser with no recovery path (review finding
S3; this decision originally asserted a serialization the code disclaims). The
allocator returns `max(prev + 1, lastGen + 1, Date.now())`, updating its high-water
`lastGen` in the same synchronous step: `lastGen` closes the concurrent-put race
(allocation is atomic on the JS thread), `Date.now()` keeps gens above anything issued
by a previous process (eviction and re-creation cannot resurrect an old URL), and
`prev + 1` covers a stored gen from outside this process's clock — a cache directory
copied between machines, or skew — which the other two terms would regress below.

`path + mtime + ao + gen` then fully names the response bytes: mtime covers the model
changing, ao the recipe requested, gen every server-side write including the authored
camera. Nothing else can change the answer, so no other component (rig, lighting,
posed) belongs in the key — those change only via a re-render, which is a write, which
bumps gen. A `RIG_VERSION` bump alone rewrites nothing and pins nothing: the stale-rig
response stays cached at its gen until the client re-renders and PUTs, which allocates
a new gen and moves every subsequent fetch to a new URL.

Only `ThumbCache.put` allocates: the two other `writeMeta` callers — `maintain()`'s
size-cap write-back and `migrate()`'s re-key — **preserve** the gen through their
spreads and must never bump it, and eviction deliberately does not bump either: a
browser holding the entry at its current gen holds bytes still correct for that
path + mtime + recipe, so serving from its own cache beats a needless re-render
(worker finding, 2026-09-02, recorded here so a hand-built replacement object at
either site is recognizable as the regression it would be).

One bound measured at implementation (2026-09-02, probe re-runnable in
`allocateGen`'s terms): the `lastGen + 1` term outruns wall-clock under burst
allocation — 200 puts in 16 ms ended 184 ms ahead — so a restart after a burst can
re-issue numbers below the previous process's high-water. Reaching a live collision
needs burst + restart + whole-entry eviction + an exact numeric hit, and the `prev`
floor covers every case where the sidecar survives; accepted. If cross-restart
monotonicity ever becomes a real guarantee (a second reader, a synced cache), persist
the high-water mark — and note the first attempted restart test asserted
strictly-greater across restart and failed against correct code for exactly this
reason, so do not re-add that assertion without the persistence.

*Alternative — hash the response:* content-addressing without a counter, but the ETag
would have to be computed per request from the body, and the client could never predict
the URL; a counter is predictable, cheap, and the listing layer can carry it.

### D2: Two caching tiers, decided by whether the client could know the generation

A client that knows the current gen sends it and gets `Cache-Control: public,
max-age=31536000, immutable` — `public` pinned deliberately: on the loopback app there
are no intermediary caches so the directive is inert, and the demo, where an edge
cache exists, is exactly where `public` is wanted. (The stale-gen tier is bare
`no-cache` with no validator — asymmetric with the gen-less tier, accepted: the
client re-keys immediately from the body's current gen, so revalidating that answer
has no caller.) A client that cannot know it omits `gen` and gets
`Cache-Control: no-cache` plus an `ETag` built from the generation, answering 304 to a
matching `If-None-Match`: one round trip, ~zero bytes, instead of the full base64
payload. This is what makes the change independent of `listing-tree-cache` — and
standalone, this tier is most of the story: learned gens live on `EntrySlot`s, which
the reconciler retires on navigation, so each entry's first fetch per *listing visit*
— not per session — rides the ETag tier (review m15's sizing). Once listings carry the
gen (that change's declared seam), the client is fully keyed from the start and the
304s disappear too. The upgrade is additive on both sides of the wire.

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
  re-rendered from scratch] → gen must never regress: the allocator's `Date.now()`
  term keeps a re-created entry's gen above anything a browser has seen (a 0-seeded
  counter would re-issue old URLs with new bytes), and its `prev + 1` term keeps it
  above a stored gen minted by another machine's clock.
- [Two clients orbit the same entry concurrently] → last write wins exactly as today
  for the *bytes*; the *gens* differ by construction (the allocator's synchronous
  high-water step — D1), so the loser's gen is simply never current: a GET carrying
  it takes the stale-gen tier and re-keys. The racing-puts test cell pins both the
  distinct-gens and never-immutable-at-the-loser's-gen facts. (This bullet originally
  claimed the write path serializes gens — it does not, which is why allocation moved
  outside the merge.)
- [`immutable` pins a bug: a corrupt PNG cached forever] → the write that fixes it
  bumps gen; the bad URL is abandoned, not purged. Same story as any content change.
- [CDN behavior on the demo] → both tiers are standard HTTP semantics; an edge holds
  gen-keyed tiles indefinitely and revalidates gen-less ones against origin. Nothing
  demo-specific in this change.
