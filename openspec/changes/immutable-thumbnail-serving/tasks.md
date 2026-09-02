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

- [ ] 1.1 `cache.ts`: sidecar gains `gen` (additive; absent reads as 0 for
      compatibility, but see 1.2). Every write path for an entry — PNG store, camera
      set/discard, axis set/discard — increments it. Reads return it
- [ ] 1.2 Monotonicity across eviction (design D1/risk): a write creating a sidecar
      that does not exist seeds `gen` from a monotonic source (`Date.now()` at first
      write) rather than 0, so a re-created entry's generation exceeds any previously
      issued for that path. Test: write, delete the entry, write again — the second
      gen is strictly greater
- [ ] 1.3 `app.ts` `GET /api/thumb`: optional `gen` query param. Hit + `gen` current →
      `Cache-Control: public, max-age=31536000, immutable`. Hit + `gen` stale → current
      body and gen, `Cache-Control: no-cache`. Hit + no `gen` → `Cache-Control:
      no-cache` + `ETag` from the generation, 304 on matching `If-None-Match`. Any
      non-hit → `Cache-Control: no-store`. `PUT /api/thumb` response echoes the
      post-write generation
- [ ] 1.4 Server tests (`server/test/`): each tier's headers; 304 on matching
      validator and full body on mismatch; miss carries `no-store`; a PUT bumps gen and
      its echo matches a subsequent GET; stale-gen request answers current content
      uncacheable; the 1.2 monotonicity cell

## 2. Client: passing and learning the key

- [ ] 2.1 `client.ts`: `getThumb(path, mtime, ao, gen?)` appends `gen` when given;
      `ThumbResult` and the PUT result carry `gen` (additive to `shared/types.ts` wire
      shapes)
- [ ] 2.2 `useThumbnails`: keep the last-seen gen on the entry's slot (the `EntrySlot`
      map it already holds), pass it on that entry's next fetch, update it from GET and
      PUT echoes. No persistence — a fresh session rides the ETag tier until it learns
      generations (and later, until listings deliver them)
- [ ] 2.3 Client tests: gen present → appended to the URL; absent → byte-identical
      request URL to today's (compat: absent-ao pattern is the precedent); a PUT's
      echoed gen is used by the entry's next GET; harness thumb mock extended
      additively so every pre-existing test passes unchanged

## 3. Verification

- [ ] 3.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
- [ ] 3.2 Live, dev instance: browse a listing twice — network panel shows tile
      responses served from browser cache (memory/disk) on the revisit, 304s only for
      entries first seen this session; orbit a model, release — its next fetch is a
      full 200 with a higher gen, tiles around it stay cached; toggle AO — the other
      variant's URLs cache independently
- [ ] 3.3 Header check against a second client (fresh profile or curl): gen-less GET
      answers `no-cache` + ETag and 304s on the validator; `gen`-carrying GET answers
      `immutable`; miss answers `no-store`
