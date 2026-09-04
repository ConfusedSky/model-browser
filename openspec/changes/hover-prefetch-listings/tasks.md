# Tasks — hover-prefetch-listings

> **Parked** (Masa, 2026-09-03) until `public-deployment` has landed and a hosted origin
> exists to measure against. Before starting: re-read `design.md`'s Context against the
> source — the request effect in `App.tsx` and `useThumbnails`' seeding step move often —
> and re-check the demo's bake shape (preview paths attached to dir entries) still holds,
> since D4's "the folder sheets ride the warm" rests on it.

## 1. Measure before building (gates §2–§4)

- [ ] 1.1 From a US-side vantage against the hosted origin, record the click-to-populated
      sequence for one folder open with the browser's network panel or a Playwright
      HAR: the listing request's duration, the gap to the first tile image request, and
      the last image's arrival. This is the number the change exists to move; write it
      here with the date, vantage, and origin
- [ ] 1.2 Repeat with a 120 ms simulated RTT locally (standalone Playwright's
      `route` with an in-handler delay, or Chrome's network throttling) so the cell can be
      re-run without a paid box. Record the local number beside the hosted one and note
      whether they agree in shape
- [ ] 1.3 Fire-rate sweep (design D6): with a temporary counter on the warm callback, move
      the cursor across a folder grid at a natural browsing pace and record how many
      warms fire per tile crossed. Decide from the number whether `HOVER_LINGER_MS` is
      shared or a `DIR_LINGER_MS` is introduced; record the decision and the number in
      `lib/hover.ts` beside the constant, not only here

## 2. The listing warm

- [ ] 2.1 `client/src/lib/listingPrefetch.ts`: `ListingPrefetch` with `key`, `warm`,
      `take`, the constants `PREFETCH_MAX` (8), `PREFETCH_TTL_MS` (30 s),
      `PREFETCH_INFLIGHT_MAX` (2), and the `warmImages` hook (design D2, D4). Pure
      module, timers injected as `createHoverWarmer`'s are
- [ ] 2.2 `Grid.tsx`: `onDirHover: (path: string | null) => void` prop; the non-model tile
      branch calls it on `onPointerEnter`/`onPointerLeave`, mirroring the model branch
- [ ] 2.3 `App.tsx`: a second `createHoverWarmer` (`dirHover`) whose callback builds the
      key from `state.view.flat` and `ownPrefs().folderMatching` and calls
      `prefetch.warm(key, () => api.listDir(path, opts))` — no signal (design D5)
- [ ] 2.4 `App.tsx` request effect, plain-listing branch: `prefetch.take(key)` before
      `api.listDir`; a hit or an in-flight promise lands through the existing `land`
      (design D3). The reducer is not touched — confirm with `git diff` that
      `reducer.ts` is unchanged when this section closes

## 3. The thumbnail warm

- [ ] 3.1 `useThumbnails.ts`: export `usable` (design D4). No behaviour change; a test that
      imports it directly pins the export
- [ ] 3.2 `App.tsx`: supply `warmImages` — first `PREFETCH_TILES` (24) model entries passing
      `usable` under `aoEnabled()`, each `new Image().src = api.thumbImageUrl(...)`; held on
      the store entry, dropped on take or expiry

## 4. Tests

Client conventions: `client/test/CLAUDE.md`. Run from the workspace dir
(`cd client && bunx vitest run …`). Every cell below is a scenario in the delta spec;
grep the test file for the assertion before checking a line off.

- [ ] 4.1 `listingPrefetch.test.ts`: warm files on resolve; take is one-shot; take joins an
      in-flight promise; TTL expiry; `PREFETCH_MAX` drops oldest; `PREFETCH_INFLIGHT_MAX`
      drops a third warm; `warmImages` is called once per resolve with the answer's
      entries. Fake timers throughout
- [ ] 4.2 `interaction.test.ts` (or a sibling): hovering a dir tile past `HOVER_LINGER_MS`
      calls `listDir` with the click's options; crossing under it calls nothing;
      hover-then-click makes exactly one `listDir` call and lands (the *warmed folder
      opens* and *click beats the warm* scenarios); hover, toggle flat, click makes a
      second call with `flat: true` (the *options changed* scenario)
- [ ] 4.3 Stale rides along: a warm whose answer carries `stale: true`, then a click, lands
      with `stale` set and the follow-up effect fires once — assert the second `listDir`
      call the follow-up makes, and no third
- [ ] 4.4 A warm never navigates: hover past the linger, no click; assert `pushRecent` and
      the URL commit were not called and `state.result` is unchanged
- [ ] 4.5 Thumbnail warm: with a listing whose entries carry `thumb` annotations (two `hit`,
      one absent, one failing `usable` by rig), the warm creates `Image`s for exactly the
      two, with the URL `thumbImageUrl` builds for the current `ao`; flip `aoEnabled` and
      assert the no-AO URLs (the *variant the tile will use* scenario). Spread the real
      renderer module for `RIG_VERSION` — never a literal (CLAUDE.md)
- [ ] 4.6 **Falsify** each cell once (memory: *falsify the mutation too*): comment out the
      `take` in the request effect and confirm 4.2's one-call assertion goes red; restore

## 5. E2E on the hosted or throttled instance

- [ ] 5.1 Under the 120 ms simulated RTT (1.2), hover a folder ≥ 300 ms then click:
      the grid renders with no skeleton (the reveal delay is 200 ms), and
      `performance.getEntriesByType('resource')` shows the tile images with
      `transferSize === 0` (cache hit). Compare against the same click with no hover and
      record both timings here, dated. This is the *paints from cache* scenario's proof
      that `Image` and `<img loading="lazy">` share the entry
- [ ] 5.2 Re-run 1.1 on the hosted origin with the change deployed; the number moves or
      the change is reverted. Record the after-number beside the before

## 6. Close

- [ ] 6.1 `docs/web-demo-notes.md`: the trip-reduction paragraph's pointer to this change
      gains the measured before/after
- [ ] 6.2 Archive dry run on a fresh copy of `openspec/` (CLAUDE.md), then
      `openspec archive hover-prefetch-listings --yes`; after archiving, read
      `openspec/specs/directory-browsing/spec.md` and keep only what a future editor of
      the capability needs from any comment that crossed over
