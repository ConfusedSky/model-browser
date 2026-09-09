## 1. The two pure pieces

- [x] 1.1 `client/src/lib/placement.ts`: `measurePlacement(scroller, tiles)` — the first
      tile crossing the top edge and its offset (D1); `applyPlacement(scroller, tile,
      placement)` for `top` and `center` alignments; `resolvePlacement(request, entries)`
      — the fallback chain of D4 as a pure function returning what to apply. Unit cells for
      each, including a resize (a tile found in a different row keeps its offset) and the
      flat fall-through (anchor absent, child absent → top)
- [x] 1.2 `client/src/lib/trail.ts`: the session mirror (D2) — `current()`, `record(idx,
      *(2026-09-09: landed as `measurePlacement(scrollportTop, tiles)` + `resolvePlacement`
      pure, with `measureIn(scroller)` / `applyIn(scroller, resolved)` as the DOM adapters
      — `applyIn` takes the resolved answer rather than a tile, so the lookup by
      `data-entry-tile` lives in one place. 26 cells in `client/test/placement.test.ts`;
      falsified: child fallback skipped → the two deep-arrival cells fail (`expected
      { kind: 'top' } to deeply equal { kind: 'center', path: '/Kit A' }`); offset ignored
      → the anchor and resize cells fail (`expected 230 to be 250`, `expected +0 to be
      -20`). Tile lookup is an attribute scan, not `CSS.escape` + `querySelector`:
      happy-dom refuses any backslash in a quoted attribute selector, so the selector form
      could not be tested with a path carrying quotes — see `tilesIn`'s comment)*
- [x] 2.1 `commitUrl` stamps `{ idx }` into the state it writes, merged with `LIGHTBOX_ENTRY`
      / `SIMILAR_ENTRY` when those are passed; a push is the current index plus one, a
      replace keeps it; boot without one is index 0 via `replaceState` (D2). `isLightboxEntry`
      and `similarDepth` unchanged. Cells in the urlState suite — 2026-09-09: `historyIndex()`
      added, `commitUrl` returns `{ idx, wrote }`; six cells under "the entry index" in
      `urlState.test.ts`; falsified twice (overwrite instead of merge → 4 marker cells fail;
      push writes the current index → 5 cells fail)
- [ ] 2.2 `onPop` reads the index off `history.state` and raises the entry's placement as
      the pending request, or `top` when the mirror knows nothing

## 3. App wiring

- [ ] 3.1 Record: a throttled scroll listener on `mainRef` files the current entry's
      placement into the mirror (D2); nothing filed while a listing is in flight or the
      skeleton is up
- [ ] 3.2 Request: `goUp` walks the mirror for the parent's row with the current flat
      state and raises `{ anchor, offset }`, else `{ center: child }` (D3/D4); every other
      landing source raises `top`; the reveal raises `{ center: path }` through the same
      channel, so `pendingReveal` becomes one case of the pending placement and `marked`
      keeps only the highlight
- [ ] 3.3 Apply: one effect on the settled answer (the `pendingReveal` gate) resolves the
      request against `state.result.entries`, applies it against `mainRef`, and clears it
      (D5). `Tile`'s `scrollIntoView` on `marked` is removed; `Grid` gives the effect a way
      to find a tile by path (a `data-path` on the tile, or a ref map — say which in the
      report and why)
- [ ] 3.4 Fresh landings set the scroller to 0 explicitly (D5's last paragraph), so a fast
      landing with no skeleton no longer keeps a clamped old offset

## 4. Tests, then falsify

- [ ] 4.1 App-level cells, one per scenario of the delta: back after a re-fetch; dismiss;
      ↑ after a descent; ↑ after an excursion (the walk skips the search row); ↑ from a
      deep link centres the child; ↑ in flat falls to the top; a tile click lands at the
      top after an earlier scrolled visit; a resize between leave and return; lightbox
      close touches nothing (assert no listing request and the scroller untouched)
- [ ] 4.2 Falsify: make `walkBack` return the latest match instead of the nearest → the
      excursion cell fails; make `resolvePlacement` skip the child fallback → the
      deep-link cell fails; restore `scrollIntoView` in `Tile` and drop the apply effect →
      the offset cells fail; record the failure text

## 5. Live

- [ ] 5.1 Dev instance, the real library: scroll `/` a few screens, enter a kit, Back —
      measure the anchor tile's rect before and after (`getBoundingClientRect` through
      Playwright, not a screenshot); repeat with ↑; repeat after resizing the window
      between; a deep link into a kit then ↑ centres the kit; the lightbox close case
- [ ] 5.2 The band observer follows the placement: after a Back that lands mid-listing,
      the thumbnails queued first are the ones on screen, not the listing's first rows

## 6. Land it

- [ ] 6.1 `bun run typecheck` and both suites green
- [ ] 6.2 `openspec validate retrace-placement --strict`, archive dry run on a fresh copy;
      after archiving, check the applied `directory-browsing` text carries no change-scoped
      prose
