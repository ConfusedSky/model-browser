# Tasks — immutable-thumbnail-serving

> Ordering: independent — can land before everything else in the trip-reduction set
> (`docs/web-demo-notes.md`, 2026-09-02). Coordination: `thumbnail-sweep-priority`
> (active) MODIFYs two *other* requirements in `model-thumbnails` and touches
> `useThumbnails` — this change's delta is ADD-only with a distinct title (checked at
> drafting), and its client edits are additive fields on the slot; re-read that change's
> delta and `useThumbnails` against main before starting and before archiving either.
> `listing-tree-cache`'s thumbnail-state layer (its D7/§6) will later deliver the
> generation with listings; nothing here waits on it.

## 1. Server: the generation

- [x] 1.1 `cache.ts`: sidecar gains `gen` (additive; absent reads as 0 for
      compatibility, but see 1.2). Every write path for an entry — PNG store, camera
      set/discard, axis set/discard — increments it. Reads return it
- [x] 1.2 Monotonicity across eviction (design D1/risk): a write creating a sidecar
      that does not exist seeds `gen` from a monotonic source (`Date.now()` at first
      write) rather than 0, so a re-created entry's generation exceeds any previously
      issued for that path. Test: write, delete the entry, write again — the second
      gen is strictly greater
      — landed 2026-09-02 (e3f5604) with a correction on the record: the specified
      cell CANNOT catch a bad seed (the allocator's high-water is module state, so
      within one process even a 0-seeded counter answers "strictly greater" — its
      falsification passed 102 cells). The shipped cell resets modules and pins a
      fresh process's first generation against the wall clock, which does fail
      against the 0-seed
- [x] 1.3 `app.ts` `GET /api/thumb`: optional `gen` query param. Hit + `gen` current →
      `Cache-Control: public, max-age=31536000, immutable`. Hit + `gen` stale → current
      body and gen, `Cache-Control: no-cache`. Hit + no `gen` → `Cache-Control:
      no-cache` + `ETag` from the generation, 304 on matching `If-None-Match`. Any
      non-hit → `Cache-Control: no-store`. `PUT /api/thumb` response echoes the
      post-write generation
- [x] 1.4 Server tests (`server/test/`): each tier's headers; 304 on matching
      validator and full body on mismatch; miss carries `no-store`; a PUT bumps gen and
      its echo matches a subsequent GET; stale-gen request answers current content
      uncacheable; the 1.2 monotonicity cell

## 2. Client: passing and learning the key

- [x] 2.1 `client.ts`: `getThumb(path, mtime, ao, gen?)` appends `gen` when given;
      `ThumbResult` carries `gen`, and `putThumb`'s return type changes from
      `Promise<void>` (its `okOrThrow` skips the body today) to carry the echoed gen —
      a signature change across the interface, both implementations, and the harness
      mock, named as such (review m16)
- [x] 2.2 `useThumbnails`: keep the last-seen gen on the entry's slot as `thumbGen` —
      NOT `generation`, which `EntrySlot` already uses for its retirement counter
      (review m15) — pass it on that entry's next fetch, update it from GET and PUT
      echoes. The out-of-hook PUT sites reach the slot through `setThumb` after all
      — this line's first version had them "rely on the stale-gen tier", which the
      post-landing review (a2c5c28) proved unreachable: an immutable-cached answer
      at the outdated number never contacts the server. `ThumbState` carries `gen`;
      writers that know their echo pass it, `discardThumbFraming` clears, absence
      means re-learn. No persistence — slots retire on
      navigation, so each listing visit's first fetch per entry rides the ETag tier
      until listings deliver gens
- [x] 2.3 Client tests: gen present → appended to the URL; absent → byte-identical
      request URL to today's (compat: absent-ao pattern is the precedent); a PUT's
      echoed gen is used by the entry's next GET; harness thumb mock extended
      additively so every pre-existing test passes unchanged

## 3. Verification

- [x] 3.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
- [ ] 3.2 (headers half proven under 3.3's run; what remains is the browser-side
      network-panel evidence: cache hits on revisit, orbit re-keying, AO variants
      caching independently) Live, dev instance: browse a listing twice — network panel shows tile
      responses served from browser cache (memory/disk) on the revisit, 304s only for
      entries first seen this session; orbit a model, release — its next fetch is a
      full 200 with a higher gen, tiles around it stay cached; toggle AO — the other
      variant's URLs cache independently
- [x] 3.3 Header check against a second client (fresh profile or curl): gen-less GET
      answers `no-cache` + ETag and 304s on the validator; `gen`-carrying GET answers
      `immutable`; miss answers `no-store`
      — run 2026-09-02, curl against the hot-reloaded dev instance (3177), a real
      library model: gen-less hit → 200 `no-cache` + ETag "0"; If-None-Match → 304;
      current-gen → `public, max-age=31536000, immutable`; stale-gen (1 vs 0) → 200
      `no-cache` with current gen in body; nonexistent path → `no-store`. A
      pre-generation sidecar reads gen 0, as specified
