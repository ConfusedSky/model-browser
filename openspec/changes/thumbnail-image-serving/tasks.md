# Tasks — thumbnail-image-serving

> **What can start today:** §0, §1.1–1.2, §3 and §4 depend on nothing unlanded
> — only `immutable-thumbnail-serving` (archived 2026-09-02). **What waits on
> `listing-tree-cache` §6:** 1.3, 1.4, 2.2's annotation branch, 2.5, 5.1's
> annotated cells, 5.3, and 6.2's revisit measurement. That change's 6.3
> already carries this change's field shape (design D2). Re-read `app.ts`'s
> `/api/thumb` handler, `cache.ts`, `useThumbnails.ts`, `queue.ts`,
> `Grid.tsx` and `App.tsx` against main before starting — parallel sessions,
> and `listing-tree-cache` is being built in this tree.
>
> No `RIG_VERSION` bump: nothing here changes a pixel.

## 0. Hold far lookups, rank the rest (D0/D4 — lands first, client only)

- [ ] 0.1 `RenderQueue` gains a held-far mode (constructor option): `take`
      never dispatches `far`-ranked jobs; they wait until a re-ranking moves
      them. `lookupLimit` becomes a module-level `new RenderQueue(8)` in that
      mode, keyed by path, on which `suspend` is never called — say so on the
      instance; structurally `App` holds no reference to it. Retire
      `makeLimiter`. Cancellation on retirement is unchanged: the push handle
      joins `slot.cancels` as before
- [ ] 0.2 One helper applies a band map to **both** queues, and both writers
      use it — `setBands`, and the sweep effect's per-listing reset
      (`4161f37`) — so the lookup queue never keeps a previous listing's far
      verdict for a survivor (D4)
- [ ] 0.3 The module-level queue's cross-mount state has an owner: the hook's
      wiring effect clears the far gate and `onIdle` (§4) in its cleanup, and
      the module exports a test reset called in `beforeEach` beside the
      preference-module resets `client/test/CLAUDE.md` documents (D4)
- [ ] 0.4 Cells: a far tile's lookup is not issued at open and is issued when
      reported near (the D0 cell — falsify by unholding far); a visible tile's
      lookup is taken ahead of earlier-queued off-screen ones under the
      render-order rule in `client/test/CLAUDE.md` (hold the lookup queue's
      slots so rank decides); a suspended render queue does not stall a
      lookup; a listing change resets the lookup ranking (falsify by resetting
      only the render queue); a leaked pending lookup from one cell does not
      close the next cell's gate (the reset)

## 1. Server: the image route and the annotation's fields

- [ ] 1.1 Extract the JSON route's cache-tier logic (`immutable` when the
      request names the current `gen`, `ETag`/304 otherwise, `no-store` on a
      miss) into one helper in `app.ts`, and re-point `/api/thumb` at it with no
      behaviour change — its `api.test.ts` cells must pass untouched (D1)
- [ ] 1.2 `GET /api/thumb/image?path&mtime[&ao=off][&gen]`: same key, same
      helper, `image/png` body; 404 + `no-store` for **anything but a hit**
      (`stale` has no pixels); a superseded `gen` answers the current bytes
      under `no-cache`; confined exactly as the lookup route is; **bumps the
      PNG's LRU clock** exactly as `ThumbCache.get`'s hit does (D1, D7)
- [ ] 1.3 *(after §6)* `ThumbCache`'s in-memory index (`listing-tree-cache`
      6.2) exposes, beside presence/`gen`/`framed`, the per-variant labels
      (`lighting`, `rig`, `posed`), the entry-level `camera`/`axis`, and the
      **sidecar's mtime** — `state` is derived at emission against the entry's
      mtime, never stored as a verdict (D2). Maintained on the same reads and
      writes, no extra I/O per listing
- [ ] 1.4 *(after §6)* Emission attaches design D2's `thumb` shape to model
      entries as an additive field on a **copy** of the cached entry, at
      **every** site that emits model entries — the directory and flat
      listings and `/api/peek` beside `applyDisplayNames`, and the two scoring
      routes' `hitsToEntries` join (D2). `shared/types.ts` gains
      `DirEntry.thumb?` with field docs saying which side owns which decision

## 2. Client: drawing from the listing

- [ ] 2.1 `ApiClient.thumbImageUrl(path, mtime, ao, gen)` — a pure URL builder,
      the same query shape `getThumb` sends, so the image URL and the lookup
      URL name the same bytes (D1)
- [ ] 2.2 *(after §6)* `useThumbnails`: `start` returns the annotation's
      verdict — `hit` under the client's predicate (`lighting ===
      THUMB_LIGHTING`, `rig === RIG_VERSION`, `poseStale` false against the
      pose held — the *same* predicate the hit branch applies to a lookup
      answer, extracted so it cannot drift) → the reconciler seeds that entry
      `ready` at the image URL with the entry's `camera`/`axis` **and `gen`**
      in the **same `setThumbs` updater** that seeds `loading` for the other
      added entries, never through `setThumb` during the sweep (D3: the batch
      would overwrite it and nothing would ever write again). Every other
      verdict takes the lookup path unchanged
- [ ] 2.3 Survivors re-read the annotation: the survivor test becomes
      `slot.ao === ao && samePose(...) && slot.entry.thumb?.gen === entry.thumb?.gen`,
      and a survivor's `slot.entry` is updated to the new entry (D3)
- [ ] 2.4 Object-URL ownership by scheme: revocation on displace, removal and
      unmount fires only for `blob:` URLs; `setThumb` from outside (`persist`,
      `entryActions`) still mints and releases `blob:` (D3)
- [ ] 2.5 *(after §6)* The image can fail: `ThumbView` takes the **path** it
      draws and an `onImageError(path)` held by identity in `App`; the hook
      remembers the refused generation on the slot (cleared when a listing
      delivers a different `gen`) and demotes the entry to the lookup path —
      once per generation, so a pose wave or toggle does not rebuild the same
      404 URL, and a pulled disk's 503s do not become 500 retire/start cycles
      (D3)
- [ ] 2.6 The tile `<img>` gets a declared square box (`width: 100%;
      aspect-ratio: 1 / 1`), `loading="lazy"`, `decoding="async"`, and keeps
      `ThumbView`'s placeholder up until its `load` event when its URL is an
      image URL; `overlayRectFor`'s fallback also covers an `<img>` whose rect
      is empty — so a press on a listing-drawn tile before its image loads
      opens the orbit overlay at the box, not at 0×0 (D3). This is a
      Grid/App change; a cell presses a tile whose `<img>` has not loaded and
      asserts the rect

## 3. (folded into §0)

- [ ] 3.1 Confirm nothing remains here: ranking and holding both landed in
      §0. Kept as a numbered placeholder so the proposal's "§3/§4 land first"
      references resolve

## 4. Far reads yield to pending lookups

- [ ] 4.1 `RenderQueue`: `pending` counts live jobs (**not** `jobs.length +
      running` — husks are spliced only inside `take`); `setFarGate(fn)`;
      `take` skips `far`-ranked jobs while the gate says no, **unless the gate
      has read closed for longer than `FAR_GATE_MAX_MS`** (a named constant,
      tuned in 6.2 above the measured worst lookup of 3.7 s); `onIdle` fires
      **after** the decrement that makes `pending` zero; a public `poke()`
      re-pumps (D5)
- [ ] 4.2 The hook wires the render queue's gate to "a lookup ranked nearer
      than far is pending" (the lookup queue exposes that count, not just
      `pending`) and the lookup queue's `onIdle` to the render queue's `poke`;
      both cleared in the wiring effect's cleanup (0.3)
- [ ] 4.3 `queue.test.ts` cells, DOM-free: with the gate closed a far job is
      skipped while a near job runs; the gate opening plus `poke` starts the
      far job with no new push; `pending` excludes cancelled husks; a gate
      that never opens releases far work after the bound (fake timers); a
      gate closed only by far-ranked lookups does not hold far renders

## 5. Tests

- [ ] 5.1 *(after §6)* `thumbnailQueue.test.tsx` hook cells with annotated
      entries: a listing whose entries all carry a current `hit` issues
      **zero** `getThumb` calls, every tile is `ready` at an image URL with the
      entry's camera/axis, and — the F1 cell — the state survives the sweep's
      own added-entry seed (falsify by seeding through `setThumb`); an entry
      labelled with an old `rig` issues a lookup; an entry with no `thumb`
      takes the lookup path; an entry whose `posed` predates the held pose
      issues a lookup; a later listing naming a newer `gen` for a survivor
      restarts it (falsify by dropping `gen` from the survivor test); a tile
      drawn from the listing keeps the entry's `gen` on its slot (falsify by
      omitting `gen`); a tile drawn from an image URL, re-rendered to `blob:`,
      then removed, revokes exactly one URL (falsify by revoking by identity);
      the eviction cell — **synthesized**: happy-dom fetches no images and
      fires neither `load` nor `error`, so the cell dispatches `onImageError`
      and pins the wiring and the once-per-generation memory (falsify by
      forgetting the refusal → a second `start` rebuilds the 404 URL); the
      premise that a 404 image fires `error` is 6.2's to prove in a browser
- [ ] 5.2 `api.test.ts` server cells: the image route's bytes equal the
      lookup's decoded `png` for the same key; `immutable` when `gen` matches,
      `no-cache` with current bytes when superseded, 404 `no-store` on a miss
      **and on a stale entry**; the route bumps the PNG's mtime as the JSON hit
      does; the JSON route's existing cells untouched by the helper extraction
- [ ] 5.3 *(after §6)* App-mount cell in `folderSheets.test.tsx`: a listing
      with annotated entries mounts with no `getThumb` traffic and tiles
      showing image URLs; one unannotated entry beside them is looked up; a
      folder-sheet cell's image error demotes the *cell's* path, not the
      folder's
- [ ] 5.4 Confirm no renderer-mock update is needed and `RIG_VERSION` is
      untouched — nothing here renders

## 6. Verification

- [ ] 6.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 6.2 Re-run the proposal's profile against the real library, in stages,
      recording whose run and the conditions beside the 2026-09-02 baseline
      (618 lookups / 49.7 MB / 65 s): **after §0 alone** — lookups issued at
      open on the cached flat root (target: the visible screen plus the near
      band) and wall time to every visible tile; **after §1–§2** — lookups on
      a fully annotated listing (target: zero), bytes on a second load of the
      same listing (target: zero for cached tiles), and the listing's own
      payload growth measured, not estimated; in the browser, that a 404
      image fires `error` and the tile recovers. Tune and freeze
      `FAR_GATE_MAX_MS` here, above the measured worst lookup
- [ ] 6.3 With the far drain running (an uncached listing left open), confirm
      a fresh listing's cached tiles fill at lookup speed, not disk-contention
      speed — the gate's whole point, measured rather than asserted — and that
      the drain resumes after the gate's bound when a lookup is made to hang
