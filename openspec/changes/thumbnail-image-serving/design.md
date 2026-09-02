# Design — thumbnail-image-serving

## Context

The cached-thumbnail path today, per tile: `useThumbnails`' `start` pushes a
lookup into the module-level `lookupLimit` (`makeLimiter(8)`, plain FIFO);
the lookup calls `ApiClient.getThumb`, which GETs `/api/thumb?path&mtime[&ao][&gen]`;
the server (`app.ts`'s `/api/thumb` handler, `ThumbCache.get`) answers JSON
carrying the labels (`lighting`, `rig`, `posed`), the stored `camera`/`axis`,
the write `gen`, and — on a hit — the PNG **base64-encoded** in `png`;
`ApiClient` decodes that into a `Blob` and mints an object URL
(`base64ToBlobUrl`); the hook's hit branch applies its staleness test
(`cached.lighting === THUMB_LIGHTING && cached.rig === RIG_VERSION && !poseStale`)
and calls `setThumb` with the URL, whose ownership (`slot.url`, revoke on
displace/remove/unmount) the hook then carries. `Tile` renders `thumb.url` as
an `<img src>` and does not care what scheme it is.

`immutable-thumbnail-serving` (2026-09-02) gave that GET three cache tiers —
`immutable` when the request names the current `gen`, an `ETag`/304 validator
tier otherwise, `no-store` on a miss — and the client now sends the `gen` it
last learned. That makes a revisit's JSON *cacheable*; it does not make it
free: the request is still made, the body is still parsed, the Blob still
minted. Its Non-Goals rule out an image response, citing only the base64
overhead (~33%) — the profile that motivates this change (proposal) shows the
request itself is the cost.

`listing-tree-cache` D7/§6 (drafted, not landed) adds an in-memory per-path
**thumbnail-state index** to `ThumbCache` — presence and staleness per
occlusion variant, the write generation, `framed` — attached to `DirEntry` at
emission in `app.ts` beside `applyDisplayNames`, as additive fields, never
blocking emission (*Derived annotations ride the listing*). That is the seam
this change consumes: the listing knows whether a tile's picture exists and
which generation it is; this change makes the tile draw it from that fact.

Measured (2026-09-02, this session, real library, flat root, ~60% cached):
618 lookups, 49.7 MB, 65 s wall, worst single lookup 3.7 s; `/api/dir` 434 ms;
poses 37 ms. Concurrent with the sweep's far drain reading 2.4 GB of meshes
off the same USB disk.

## Goals / Non-Goals

**Goals:**
- A cached tile costs the browser one native image fetch, and on a revisit
  zero bytes — no lookup request, no JSON, no base64, no object URL.
- The lookups that remain are ranked by the same band map that ranks renders,
  so a visible tile's answer is never queued behind off-screen ones.
- A pending lookup is never starved by the sweep's far drain on the same disk.

**Non-Goals:**
- Replacing `GET /api/thumb`. It stays, byte-for-byte, as the fallback for
  what the listing cannot answer and for every client written against it.
- Changing what a thumbnail looks like, the recipe, `RIG_VERSION`, the cache's
  on-disk shape, or the PUT.
- Folding poses into the listing. `listing-tree-cache` §6.1 does that as its
  own layer, and the wave costs 37 ms today.
- Building the thumbnail-state index. That is `listing-tree-cache` §6.2; this
  change reads it and adds fields to it.
- Serving freshly rendered pixels through the image route. A just-rendered
  PNG is already in memory as a Blob; re-fetching it would be a round trip for
  bytes the client has.

## Decisions

### D1: An image route beside the JSON one, on the same key and the same tiers

`GET /api/thumb/image?path&mtime[&ao=off][&gen]` answers `image/png` bytes.
It shares the JSON route's key (`path + mtime + ao + gen`) and its exact cache
tiers — `immutable` when `gen` names the current generation, `ETag`/304
otherwise, `no-store` and 404 on a miss — by extracting that tier logic into
one helper both routes call, so the two cannot drift. A request naming a
superseded `gen` is answered with the *current* bytes under `no-cache`, as the
JSON route does: never stale pixels, merely an uncacheable answer.

*Alternative — make the JSON route negotiate `Accept: image/png`:* one URL,
two body shapes, and `<img>` cannot send the header the client would need to
choose with. Two routes are clearer than one route with two personalities.

### D2: The listing carries the labels the client's staleness test reads

`listing-tree-cache` 6.2 attaches presence/staleness/`gen`/`framed`. Presence
alone cannot let the client skip the lookup, because whether a present render
is *usable* is the client's decision: `RIG_VERSION` and `POSE_VERSION` are
client constants the server deliberately never interprets (the same reason
`ThumbCache` stores and echoes labels without reading them). So the
annotation carries, per occlusion variant, the labels the hook's hit test
compares — `lighting`, `rig`, `posed` — and, entry-level, the stored `camera`
and `axis` (which the tile needs for the lightbox to open at the user's
orientation, exactly as a lookup answers them today). The hook then runs the
*same* test it runs on a `getThumb` answer, on the entry, with no request.

Wire shape, additive on `DirEntry`:

```
thumb?: {
  gen: number
  framed: boolean
  camera?: CameraState
  axis?: OrbitAxis
  ao?:   { state: 'hit' | 'stale' | 'miss'; lighting?: string; rig?: number; posed?: number }
  noao?: { state: 'hit' | 'stale' | 'miss'; lighting?: string; rig?: number; posed?: number }
}
```

~120 bytes per entry, ~60 KB on a 500-tile listing — one request growing by a
third, against 618 requests and 50 MB removed. `listing-tree-cache` 6.3
should adopt this shape rather than invent a second one; the proposal names
the coordination.

### D3: The hook decides per entry, before any lookup

`start` gains a first branch: if the entry carries `thumb` and the variant
for the recipe in force reads `hit` under the client's test (labels equal the
constants, `poseStale` false against the pose the client holds), the slot's
state becomes `ready` with `url = ApiClient.thumbImageUrl(path, mtime, ao, gen)`
and `camera`/`axis` from the entry — and nothing is pushed anywhere. Every
other case — no annotation (an entry the index has not seen, an older
server), `stale`, `miss`, or a `posed` the client's pose predates — takes
today's lookup path unchanged, and the lookup's answer still governs.

The URL is a plain string the hook does not own: object-URL ownership
(`slot.url` revocation on displace, removal and unmount) applies only to
`blob:` URLs, decided by prefix. A tile can therefore hold either kind over
its life — an image URL from the listing, then a `blob:` from its own render
or the lightbox's persist — and the hook releases exactly what it minted.

`<img>` gets `loading="lazy"` and `decoding="async"`: the browser then
fetches listing-known images as they approach the viewport, which is a
prefetch band of the browser's own on top of the sweep's, and a 500-tile
cached listing costs a screenful of image fetches rather than 500.

### D4: Lookups are ranked by reusing the render queue's class, not its instance

The lookups that remain are a small, keyed, cancellable, bounded set — which
is what `RenderQueue` already is, minus suspension. `lookupLimit` becomes a
module-level `new RenderQueue(8)` on which `suspend` is never called
(documented on the instance); `setBands` calls `setRanking` on both queues
with the same map. Keyed by path, so a visible tile's lookup ranks visible.
`makeLimiter` is retired.

*Alternative — teach `makeLimiter` ranking:* a second copy of the ranking
and take-by-rank code, which is exactly the drift the queue's D1 warned
against.

### D5: Far dispatch yields to pending lookups

`RenderQueue.take` skips `far`-ranked jobs while a gate says lookups are
pending: the instance gains `setFarGate(() => boolean)` and the hook wires
`() => lookupQueue.pending === 0`; `RenderQueue` gains a `pending` count of
live jobs and an `onIdle` hook the lookup queue uses to `poke` the render
queue when the last lookup settles, so far work resumes without waiting for
the next push. Nearer-than-far work is unaffected — a visible tile's render
still runs beside a pending lookup, because that lookup is for a tile the user
also wants.

Why gate rather than rank: the two queues share a disk, not a scheduler.
Ranking cannot express "do not start that 25 MB read while this 50 KB read is
waiting" across instances; a gate can.

### D6: Rollback and coexistence

Every piece is additive: a client without the annotation takes the lookup
path; a server without the image route is never asked for it (the client
only builds image URLs from an annotation, which only that server emits).
Older clients ignore `thumb` on entries. Removing the change is deleting the
route and the branch.

## Risks / Trade-offs

- [The annotation goes stale between emission and the fetch — the entry was
  re-rendered after the listing was served] → the image URL names the old
  `gen`; the server answers the current bytes under `no-cache`. Never stale
  pixels; one uncacheable fetch. The next listing names the new generation.
- [Listing payload grows] → ~60 KB on the 500-tile cap, one request; against
  50 MB removed. Recorded, not mitigated.
- [500 `<img>` fetches at once through the dev proxy's HTTP/1.1 connection
  limit] → `loading="lazy"` makes the browser fetch by approach, not by
  listing; the visible screen's ~16 images arrive first by the browser's own
  priority.
- [`RenderQueue` doing double duty invites suspension to leak into lookups]
  → the lookup instance is documented as never suspended, and a cell pins
  that a suspended render queue does not stall a lookup.
- [A lookup that outlives its listing now ranks by a map that has moved on]
  → the hook already resets the map per listing, and a stale rank misorders
  one lookup at most; cancellation on retirement is unchanged.
- [Coordination with `listing-tree-cache` 6.3's field shape] → D2 names the
  shape; the proposal makes adopting it that change's task, and this change's
  server tasks are sequenced after §6 lands.

## Open Questions

- Whether the pose the client holds for an entry should also ride the
  annotation (then `poseStale` is decidable from the entry alone). That is
  §6.1's layer; if it lands first, the hook's first branch reads it and the
  pose wave only fills gaps — no change to this design's contract.
