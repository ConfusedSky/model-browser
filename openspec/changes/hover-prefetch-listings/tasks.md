# Tasks — hover-prefetch-listings

> **Unparked 2026-09-08**: `public-deployment` archived, which was the condition. §1 still
> gates §2 — but take it against `demo-infrastructure`'s origin (Caddy, HTTP/2), not the
> SSH tunnel the CX23 was driven through, whose connection-per-request shape flatters any
> prefetch. Before starting, re-read `design.md`'s Context against the source: this was
> drafted 2026-09-03 and four changes have archived since. The thumbnail half left this
> change on the same date (design D4) and is drafted as `hover-prefetch-thumbnails`.

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
- [ ] 1.4 In the same sweep, record **hover-to-click dwell** — the premise nothing here has
      measured. With a 120 ms linger, a 90–150 ms trip and up to 300 ms of annotation fill,
      the dwell distribution decides whether clicks land on a filed answer or join one in
      flight, and the two are worth very different amounts (design D6)

## 2. The listing warm

- [ ] 2.1 `client/src/lib/listingPrefetch.ts`: `ListingPrefetch` with `key`, `warm`,
      `take`, the constants `PREFETCH_MAX` (8), `PREFETCH_TTL_MS` (30 s),
      `PREFETCH_INFLIGHT_MAX` (2) (design D2). A rejected `warm`
      evicts its entry rather than filing it — a filed rejection is handed to the click by
      `take`, which fails a navigation that never fetched. Pure module, timers injected as
      `createHoverWarmer`'s are
- [ ] 2.2 `Grid.tsx`: `onDirHover: (path: string | null) => void` prop; the non-model tile
      branch calls it on `onPointerEnter`/`onPointerLeave`, mirroring the model branch
- [ ] 2.3 `App.tsx`: a second `createHoverWarmer` (`dirHover`) whose callback returns immediately while
      `liveView(state).flat` is true (design D2/D5), and otherwise builds the key through
      the reducer's own request recipe rather than by hand, then calls
      `prefetch.warm(key, () => api.listDir(path, opts))` with no signal
- [ ] 2.4 `App.tsx` request effect, plain-listing branch: `prefetch.take(key)` before
      `api.listDir`, **skipped for a follow-up request** (design D3) — a follow-up asks to
      refresh the key it just landed, and answering it from the store leaves the refreshing
      affordance up until the next navigation. A hit or an in-flight promise lands through
      the existing `land`. The reducer is not touched — confirm with `git diff` that
      `reducer.ts` is unchanged when this section closes

## 3. (moved)

The thumbnail warm left this change on 2026-09-08 (design D4) for
`hover-prefetch-thumbnails`. Two of its tasks were wrong as written and are corrected
there rather than carried: the walk must descend into `entry.preview`, since sheet cells
are nested there after `listing-tree-cache` and a folder-of-folders would otherwise warm
nothing; and `useThumbnails` already exports `isCurrentRender`, the test the tile itself
applies, so nothing needs exporting.

## 4. Tests

Client conventions: `client/test/CLAUDE.md`. Run from the workspace dir
(`cd client && bunx vitest run …`). Every cell below is a scenario in the delta spec;
grep the test file for the assertion before checking a line off.

- [ ] 4.1 `listingPrefetch.test.ts`: warm files on resolve; take is one-shot; take joins an
      in-flight promise; TTL expiry; `PREFETCH_MAX` drops oldest; `PREFETCH_INFLIGHT_MAX`
      drops a third warm; a rejected warm leaves nothing filed.
      Fake timers throughout
- [ ] 4.2 App-level, through `appHarness.tsx` (`mountApp`, its shared `listDir` mock and
      `tiles()`) — `interaction.test.ts` drives the warmer factory, not App, so it is the
      wrong home for a warm-then-click sequence. Hovering a dir tile past
      `HOVER_LINGER_MS` calls `listDir` with the click's options; crossing under it calls
      nothing; hover-then-click makes exactly one `listDir` call and lands (the *warmed
      folder opens* and *click beats the warm* scenarios); hovering while flat is on calls
      nothing (the *flat* scenario); a warm whose request rejects, then a click, makes the
      click's own call (the *warm that failed* scenario)
- [ ] 4.3 A follow-up is never answered from the store: land a listing whose answer
      carries `stale: true` (a plain listing is not marked stale by this server, so the
      mock supplies it), let the follow-up fire, and assert it reaches `listDir` rather
      than a filed entry — and that the refreshing affordance clears
- [ ] 4.4 A warm never navigates: hover past the linger, no click; assert `pushRecent` and
      the URL commit were not called and `state.result` is unchanged
- [ ] 4.5 (moved with §3 to `hover-prefetch-thumbnails`.) Thumbnail warm: entries carrying `thumb` annotations, the warm creates `Image`s for exactly the drawable ones, with the URL `thumbImageUrl` builds for the current `ao`; flip `aoEnabled` and
      assert the no-AO URLs (the *variant the tile will use* scenario). Spread the real
      renderer module for `RIG_VERSION` — never a literal (CLAUDE.md)
- [ ] 4.6 **Falsify** each cell once (memory: *falsify the mutation too*): comment out the
      `take` in the request effect and confirm 4.2's one-call assertion goes red; restore

## 5. E2E on the hosted or throttled instance

- [ ] 5.1 Under the 120 ms simulated RTT (1.2), hover a folder ≥ 300 ms then click: the
      grid renders with no skeleton (the reveal delay is 200 ms) and **no listing request
      is made on the click** — count requests rather than reading `transferSize`, which
      Chrome reports for memory-cache hits and Safari does not. Compare against the same
      click with no hover and record both timings here, dated
- [ ] 5.2 Re-run 1.1 on the hosted origin with the change deployed; the number moves or
      the change is reverted. Record the after-number beside the before

## 6. Close

- [ ] 6.1 `docs/web-demo-notes.md`: the trip-reduction paragraph's pointer to this change
      gains the measured before/after
- [ ] 6.2 Archive dry run on a fresh copy of `openspec/` (CLAUDE.md), then
      `openspec archive hover-prefetch-listings --yes`; after archiving, read
      `openspec/specs/directory-browsing/spec.md` and keep only what a future editor of
      the capability needs from any comment that crossed over
