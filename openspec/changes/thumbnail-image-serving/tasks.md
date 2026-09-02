# Tasks — thumbnail-image-serving

> Ordering: **after `listing-tree-cache` §6** (6.2's `ThumbCache` index and
> 6.3's per-entry emission are what §1 below extends and §2 consumes) and after
> `immutable-thumbnail-serving` (landed 2026-09-02 — the generation and cache
> tiers §1 reuses). §3 and §4 (ranked lookups, the far gate) depend on neither
> and can land first. Re-read `app.ts`'s `/api/thumb` handler, `cache.ts`,
> `useThumbnails.ts` and `queue.ts` against main before starting — parallel
> sessions, and `listing-tree-cache` is being built in this tree. Coordinate
> the annotation's field shape (design D2) with that change's 6.3 before
> either lands.
>
> No `RIG_VERSION` bump: nothing here changes a pixel.

## 1. Server: the image route and the annotation's fields

- [ ] 1.1 Extract the JSON route's cache-tier logic (`immutable` when the
      request names the current `gen`, `ETag`/304 otherwise, `no-store` on a
      miss) into one helper in `app.ts`, and re-point `/api/thumb` at it with no
      behaviour change — its `api.test.ts` cells must pass untouched (D1)
- [ ] 1.2 `GET /api/thumb/image?path&mtime[&ao=off][&gen]`: same key, same
      helper, `image/png` body from `ThumbCache`'s bytes; 404 + `no-store` on a
      miss; a superseded `gen` answers the current bytes under `no-cache` (D1).
      Confined exactly as the lookup route is — a path the library refuses is
      refused here
- [ ] 1.3 `ThumbCache`'s in-memory index (`listing-tree-cache` 6.2) exposes,
      beside presence/staleness/`gen`/`framed`, the per-variant labels
      (`lighting`, `rig`, `posed`) and the entry-level `camera`/`axis` —
      maintained on the same reads and writes, no extra I/O per listing (D2)
- [ ] 1.4 Emission (`listing-tree-cache` 6.3's seam in `app.ts`, beside
      `applyDisplayNames`) attaches design D2's `thumb` shape to model entries
      as an additive field on a **copy** of the cached entry — never baked into
      the snapshot. `shared/types.ts` gains `DirEntry.thumb?` with the field
      docs saying which side owns which decision (the server states facts; the
      client judges usability)

## 2. Client: drawing from the listing

- [ ] 2.1 `ApiClient.thumbImageUrl(path, mtime, ao, gen)` — a pure URL builder,
      the same query shape `getThumb` sends (`ao=off` appended only when off;
      `gen` only when known), so the image URL and the lookup URL name the same
      bytes (D1)
- [ ] 2.2 `useThumbnails`' `start`: before any lookup, read `entry.thumb`; if
      the recipe-in-force variant reads `hit` and the client's own test passes
      (`lighting === THUMB_LIGHTING`, `rig === RIG_VERSION`, `poseStale` false
      against the pose the hook holds — the *same* predicate the hit branch
      applies to a lookup answer, extracted so it cannot drift), `setThumb`
      the tile `ready` at the image URL with the entry's `camera`/`axis` **and
      `gen: entry.thumb.gen`** — `setThumb` adopts the generation absence
      included since `a2c5c28`, so omitting it would wipe the slot's learned
      key and demote the entry's later fetches to the validator tier — and
      push nothing; every other case takes the lookup path unchanged (D3)
- [ ] 2.3 Object-URL ownership by scheme: `slot.url` revocation on displace,
      removal and unmount fires only for `blob:` URLs; an image URL is a
      string the hook does not own. `setThumb` from outside (`persist`,
      `entryActions`) still mints `blob:` and is still released (D3)
- [ ] 2.4 `Tile`'s `<img>` gains `loading="lazy"` and `decoding="async"` —
      the browser fetches listing-known images by approach, not by listing.
      Confirm `overlayRectFor`'s measurement of the image box is unaffected by
      a not-yet-loaded lazy image (it measures the box, not the pixels)
- [ ] 2.5 The image's `onError` demotes the entry to the lookup path (D3): the
      `<img>` reports the failure through a per-tile callback held by identity
      like the others; the hook retires the slot and starts it as if the
      annotation had said `miss`. Only for image URLs — a `blob:` URL that
      fails is the existing error path. An entry evicted between the listing's
      emission and the fetch answers 404 and recovers this way

## 3. Ranked lookups

- [ ] 3.1 Replace `lookupLimit`'s `makeLimiter(8)` with a module-level
      `new RenderQueue(8)` on which `suspend` is never called — say so on the
      instance — keyed by path; `setBands` calls `setRanking` on both queues
      with one map. Retire `makeLimiter` (D4)
- [ ] 3.2 A cell that a suspended render queue does not stall a lookup, and a
      cell that a visible tile's lookup is taken ahead of earlier-queued
      off-screen lookups — under the render-order rule in
      `client/test/CLAUDE.md`: hold the lookup queue's slots (gate the first
      eight lookups) so rank, not push order, decides

## 4. Far reads yield to pending lookups

- [ ] 4.1 `RenderQueue`: a `pending` count of live jobs, `setFarGate(fn)`,
      and `take` skipping `far`-ranked jobs while the gate says no; an
      `onIdle` callback fired when the last live job settles, and a public
      `poke()` that re-pumps (D5)
- [ ] 4.2 The hook wires the render queue's gate to
      `() => lookupQueue.pending === 0` and the lookup queue's `onIdle` to the
      render queue's `poke`, so far work resumes the moment lookups settle
- [ ] 4.3 `queue.test.ts` cells, DOM-free: with the gate closed a far job is
      skipped while a near job runs; the gate opening plus `poke` starts the
      far job with no new push; `pending` counts live jobs and excludes
      cancelled husks

## 5. Tests

- [ ] 5.1 `thumbnailQueue.test.tsx` hook cells with annotated entries: a
      listing whose entries all carry a current `hit` issues **zero**
      `getThumb` calls and every tile is `ready` at an image URL carrying the
      entry's camera/axis; an entry labelled with an old `rig` issues a lookup
      (the constants decide, not the server); an entry with no `thumb` takes
      the lookup path; an entry whose `posed` predates the held pose issues a
      lookup; a tile drawn from an image URL, re-rendered to a `blob:`, then
      removed, revokes exactly one URL; a tile drawn from the listing keeps the
      entry's `gen` on its slot, so its next lookup names it (the `setThumb`
      absence-clears rule); an entry evicted between annotate and fetch — the
      `<img>` fires `onError` — recovers through the lookup and never shows
      the error state. Falsify each against its broken variant (skip the test
      → the old-rig cell passes wrongly; revoke by identity → the ownership
      cell double-revokes; omit `gen` → the retention cell reads `undefined`;
      no `onError` wiring → the eviction cell stays broken)
- [ ] 5.2 `api.test.ts` server cells: the image route's bytes equal the
      lookup's decoded `png` for the same key; `immutable` when `gen` matches,
      `no-cache` with current bytes when superseded, 404 `no-store` on a miss;
      the JSON route's existing cells untouched by the helper extraction
- [ ] 5.3 App-mount cell in `folderSheets.test.tsx`: a listing with annotated
      entries mounts with no `getThumb` traffic and tiles showing image URLs;
      one unannotated entry beside them is looked up
- [ ] 5.4 Confirm no renderer-mock update is needed and `RIG_VERSION` is
      untouched — nothing here renders

## 6. Verification

- [ ] 6.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 6.2 Re-run the proposal's profile against the real library (flat root,
      cached): record lookups issued, bytes over the wire, wall time to every
      visible tile, and — on a second load of the same listing — bytes fetched
      for cached tiles (the target is zero). Record whose run and the
      conditions, beside the 2026-09-02 baseline of 618 lookups / 49.7 MB /
      65 s
- [ ] 6.3 With the far drain running (an uncached listing left open), confirm
      a fresh listing's cached tiles fill at lookup speed, not disk-contention
      speed — the gate's whole point, measured rather than asserted
