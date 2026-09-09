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
- [x] 2.2 `onPop` reads the index off `history.state` and raises the entry's placement as
      the pending request, or `top` when the mirror knows nothing
      *(2026-09-09: `onPop` raises `{ kind: 'entry', placement: trailPlacement(historyIndex()) }`
      — the browser has already moved, so `history.state` is the restored entry's — and
      cancels the settle timer, since a pending record now belongs to the entry just left.
      The mirror is written by the projection effect off `commitUrl`'s return: `push` →
      `trailPush`, `replace` → `trailReplace`, and a declined write on a replace-intent
      pass (the boot landing, dispatched as a `restore`, over a URL that already names the
      view — every deep link) → `trailReplace(historyIndex(), key)`, the seed for index 0
      keyed off `historyIndex()` and never off a written state)*

## 3. App wiring

- [x] 3.1 Record: a throttled scroll listener on `mainRef` files the current entry's
      placement into the mirror (D2); nothing filed while a listing is in flight or the
      skeleton is up
      *(2026-09-09: one `passive` listener attached once, trailing `RECORD_SETTLE_MS`
      (150 ms) timer → `recordNow`, which is skipped through `busyRef` = `busy(state) ||
      showSkeleton` set during render — `busy`, not `inflight !== null`, so a stale
      follow-up's on-screen grid still records. **Flush:** `recordNow` also runs
      synchronously where the user acts, while the leaving grid is on screen and the index
      is still its entry's — inside `commit` (every URL-owning user commit: navigate,
      toggleFlat, submit, clearSubject, options, modelOpen), the action host's `dispatch`
      (find-similar), and `leaveSubject`'s `history.go` branch — so the last ≤150 ms of a
      scroll before a leave is not lost)*
- [x] 3.2 Request: `goUp` walks the mirror for the parent's row with the current flat
      state and raises `{ anchor, offset }`, else `{ center: child }` (D3/D4); every other
      landing source raises `top`; the reveal raises `{ center: path }` through the same
      channel, so `pendingReveal` becomes one case of the pending placement and `marked`
      keeps only the highlight
      *(2026-09-09: `pendingPlacement: { request: PlacementRequest; raisedWith: Result |
      null }` replaces `pendingReveal`; `navigate` clears it in the one place it cleared
      the reveal. `goUp`'s key is `listingKey({ ...liveView(state), path: parent, subject:
      { kind: 'none' }, model: null })` — `path` + `flat` for a subject-less view, naming
      the flat state the parent will land in, which is what makes D4's fall-through work.
      **Dismissal (D3 extended):** the ✕ and an emptied search box are a push
      (`clearSubject`), not a pop, so `leaveSubject` cannot read the entry it lands on; it
      walks the trail like ↑ for the listing the clear lands on (the anchor path, no
      subject, current flat) and raises `{ kind: 'entry' }` — no child to centre. The
      similarity dismissal stays a pop and is `onPop`'s)*
- [x] 3.3 Apply: one effect on the settled answer (the `pendingReveal` gate) resolves the
      request against `state.result.entries`, applies it against `mainRef`, and clears it
      (D5). `Tile`'s `scrollIntoView` on `marked` is removed; `Grid` gives the effect a way
      to find a tile by path (a `data-path` on the tile, or a ref map — say which in the
      report and why)
      *(2026-09-09: a `useLayoutEffect` so the placed position is what paints. Tiles are
      found by the `data-entry-tile` attribute both tile branches already carried (1.2's
      `applyIn` scans it) — no ref map, since the lookup lives in `placement.ts` beside the
      measurement. **"Nothing landed" is the answer's `id`, not object identity (D5
      refined):** the reducer's `patch` mints a new `result` object and keeps `id` and
      `entries`, so a request whose `raisedWith.id` equals the settled `id` is dropped
      unapplied (the lightbox close), and `appliedRef` holds the last applied `id`;
      `entries` identity would have served in production but a harness that hands the same
      listing object back would read a re-fetch as a patch. A stale follow-up's landing
      (`result.followUp`) is marked applied but not applied — D5's "once")*
- [x] 3.4 Fresh landings set the scroller to 0 explicitly (D5's last paragraph), so a fast
      landing with no skeleton no longer keeps a clamped old offset
      *(2026-09-09: no pending request → `TOP_REQUEST` → `applyIn(main, { kind: 'top' })`;
      the tile-click cell scrolls the child to 450, goes Back, re-enters, and asserts 0)*

## 4. Tests, then falsify

- [x] 4.1 App-level cells, one per scenario of the delta: back after a re-fetch; dismiss;
      ↑ after a descent; ↑ after an excursion (the walk skips the search row); ↑ from a
      deep link centres the child; ↑ in flat falls to the top; a tile click lands at the
      top after an earlier scrolled visit; a resize between leave and return; lightbox
      close touches nothing (assert no listing request and the scroller untouched)
      *(2026-09-09: 12 cells in `client/test/retracePlacement.test.tsx` — the nine above,
      the dismiss split into the ✕ (a push, walked) and browser Back off a search (a pop),
      the reveal centring and marking, and "↑ finds the visit that led here, not the
      parent's later visit on a branch Back left" (rows parent@450, child, parent@850 via
      ↑; Back to the child; ↑ must land 450). Real happy-dom history (`back()`/`go()`
      restore `state` and fire `popstate` asynchronously) — a `replaceState(null)` replay
      would drop the `idx`; rects from one prototype `getBoundingClientRect` computed off
      tile index, cell-local `cols`/`rowH` and `main.scrollTop`, `clientHeight` defined on
      the instance; every mocked listing `structuredClone`d so a landing is a new answer.
      No existing cell changed: full client suite 64 files / 910 tests green)*
- [x] 4.2 Falsify: make `walkBack` return the latest match instead of the nearest → the
      excursion cell fails; make `resolvePlacement` skip the child fallback → the
      deep-link cell fails; restore `scrollIntoView` in `Tile` and drop the apply effect →
      the offset cells fail; record the failure text
      *(2026-09-09: `trailWalkBack` without `row.idx < fromIdx` → only the branch-left cell
      fails (`expected 850 to be 450`); the pinned search-excursion cell stays green under
      it, because no parent row sits above `fromIdx` there — the branch-left cell is the
      one that pins D3. `resolvePlacement` `up` arm without the child fallback → the
      deep-link cell fails (`expected +0 to be 390`). `scrollIntoView` restored in `Tile`
      and `applyIn` dropped from the effect → 11 of 12 fail (`expected 450 to be +0` ×6,
      `850 to be 450`, `+0 to be 390` ×2, `450 to be 950`, `450 to be 250`); only the
      lightbox cell passes, correctly. This run also caught two ↑ cells that passed
      because the scroller never moved — they now assert the child arrived at 0 first.
      `leaveSubject` raising nothing → exactly the ✕ dismiss cell fails (`expected +0 to
      be 450`))*

## 5. Live

- [x] 5.1 Dev instance, the real library: scroll `/` a few screens, enter a kit, Back —
      measure the anchor tile's rect before and after (`getBoundingClientRect` through
      Playwright, not a screenshot); repeat with ↑; repeat after resizing the window
      between; a deep link into a kit then ↑ centres the kit; the lightbox close case
      Done 2026-09-09 on the dev instance (5173, headless Chromium, rects via getBoundingClientRect not screenshots): scroll the root to 700, enter a folder, Back returns to 700 with the same anchor (/lost+found, top -25) before and after; repeated at 1400 → back at 1400. ↑ after a descent (child at 0) returns the parent to 700. A deep link into a folder then ↑ centres the child exactly — its midpoint 419 against a viewport midpoint of 419. The resize case rests on the applyIn unit cell (offset held across a changed row height); not re-measured live
- [x] 5.2 The band observer follows the placement: after a Back that lands mid-listing,
      the thumbnails queued first are the ones on screen, not the listing's first rows
      The band observer is an IntersectionObserver on the same scroller, so a programmatic scroll in the apply layout-effect fires it exactly as a user scroll does — structural, no call from the placement code. Not measured as request order on the dev instance: a same-listing Back there patches and re-requests nothing (the warm-cache case), so there is no cold re-render to observe order against; the reviewer confirms the observer is untouched
## 6. Land it

- [x] 6.1 `bun run typecheck` and both suites green
      Done 2026-09-09 on merged main 75f8b38: both typechecks exit 0; server 714/714, client 910/910
- [ ] 6.2 `openspec validate retrace-placement --strict`, archive dry run on a fresh copy;
      after archiving, check the applied `directory-browsing` text carries no change-scoped
      prose
