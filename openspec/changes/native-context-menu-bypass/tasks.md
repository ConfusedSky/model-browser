# Tasks — native-context-menu-bypass

> Client only. Touches `Grid.tsx`, which `thumbnail-image-serving` §2.6 will
> also touch (that task is Grid/App; it does not name `ViewerLayer.tsx`) —
> small, disjoint hunks, but re-read both files against main before editing
> (parallel sessions). No `RIG_VERSION` bump: nothing here changes a pixel.

## 1. The predicate, its three callers, and the release path

- [x] 1.1 `client/src/lib/gesture.ts`: export `nativeMenuRequested(e: {
      shiftKey: boolean; button: number })` returning `e.shiftKey && e.button
      === 2`, with a doc comment carrying D2's two reasons (Shift over Ctrl;
      the button clause is what makes "pointer only" true by construction,
      not by Chrome's keydown suppression) and D3's measurement in one line.
      `menuAt` and `onMenuKey` in `Grid.tsx` untouched
- [x] 1.2 `Grid.tsx`: both tiles' `onContextMenu` return before
      `preventDefault` when `nativeMenuRequested(e)`; one comment at the model
      tile names the requirement's exception, so the next reader does not
      "fix" the missing `preventDefault` (D2)
- [x] 1.3 `ViewerLayer.tsx`, the release path (D5): `onUp` returns on
      `e.button !== 0` before touching `pointer.current` — the secondary
      button's release is not the primary's. `onUp`'s body became
      `endGesture(at, { promote })` in the component body, reached by both
      callers through `endGestureRef` (D6, D9 R1): the effect installs its
      listeners once, so a direct call would keep the mount render's copy —
      and did, before the ref, persisting a swapped-in viewer's pixels under
      the old path. The settle/persist chain is still the one
      `dismissAfterPersist` awaits; `onUp` calls with `promote: true`
- [x] 1.4 `ViewerLayer.tsx`, the bypass (D2/D6): `raiseEntryMenu` returns
      when `nativeMenuRequested(e)`, first calling `endGesture(e, { promote:
      false })` if `pointer.current.down`; its doc comment gains the exception
      beside "both swallow `contextmenu`" and says why the gesture is ended
      (the browser's menu takes the primary's release)
- [x] 1.5 `EntryMenu.tsx`: no change (D4). Confirmed by reading; the
      confirmation lives in cell 2.4, which fails if the capturing
      `contextmenu` listener is removed

## 2. Cells

- [x] 2.1 Helpers (D7): `entryMenu.test.tsx`'s `secondaryPress` gains `{
      shift?: boolean }`, dispatches `button: 2` on the `contextmenu` event
      (happy-dom defaults it to `0`, which would never satisfy the predicate),
      and returns whether the app took it (`!el.dispatchEvent(...)`);
      `viewerMenu.test.tsx`'s gains the same option and button, and dispatches
      the `pointerup` (`button: 2`, on window) after the `contextmenu`. Every
      existing caller of either helper still passes
- [x] 2.2 `entryMenu.test.tsx`, the bypass on tiles: a shifted press on a
      **folder** tile and on a **model** tile is not taken and raises no
      `[role="menu"]`; an unshifted press on each is still taken and still
      raises the menu (the control). "No orbit overlay, no lightbox" is
      asserted too, but as a D5 press-side anchor — it is decided by
      `onModelPointerDown`'s button check, not by the guard, and cannot fail
      under this cell's falsification. Falsify by removing the guard from the
      tile handlers: "not taken" and "no menu" must fail
- [x] 2.3 `viewerMenu.test.tsx`, the bypass on the viewer: a shifted press
      (with release) on the lightbox is not taken, raises no menu, and the
      lightbox is still open; a shifted press on the orbit overlay mid-hold
      (the file's hold helper) is not taken, raises no menu, mounts no
      lightbox, and ends the gesture — after it, a `pointermove` beyond the
      drag threshold orbits nothing (the session's `orbit` spy is not called)
      and a later primary `pointerup` promotes nothing (D6). Falsify twice:
      remove the guard from `raiseEntryMenu` ("not taken" fails); keep the
      guard but drop the `endGesture` call ("orbits nothing" fails)
- [x] 2.4 A raised menu yields (D4), `entryMenu.test.tsx`: raise the menu on
      one tile; dispatch a shifted `contextmenu` (`button: 2`) on another
      tile **with no preceding `pointerdown`** — the menu is gone, no menu is
      open, and the event was not taken. Falsify twice: remove `EntryMenu`'s
      capturing `contextmenu` listener ("menu is gone" fails); make the tile
      handler take the shifted press ("not taken" fails). A second cell does
      the full press for the user-visible outcome
- [x] 2.5 The release guard (D5), `viewerMenu.test.tsx`: mid-hold, an
      **unshifted** secondary press and release (`pointerdown` 2,
      `contextmenu` 2, `pointerup` 2) raises the app's menu and does **not**
      open the lightbox; the overlay is still mounted and a later primary
      `pointerup` still promotes. Falsify by removing `onUp`'s button check:
      "no lightbox" fails — this is the latent bug the review found, so the
      falsification also documents that main has it
- [x] 2.6 Pointer only (D3), `entryMenu.test.tsx`: a `keydown` `F10` with
      `shiftKey` on a focused tile raises the menu; a `contextmenu` shaped as
      Chrome shapes a keyboard one (`shiftKey: true`, `button: -1`, at the
      element's centre) raises the menu too, anchored at the event. Falsify
      against a `shiftKey`-only predicate: the second cell must fail
- [x] 2.7 Every cell above is checked against its named broken variant
      before it is checked off — grep that the mutation removes the guard at
      the site the cell exercises, not a sibling

## 3. Platform surface

- [x] 3.1 `docs/platform-surface.md`, under *Latent OS assumptions*: a
      **Secondary press** bullet — the app suppresses the platform menu and
      offers Shift+secondary as the way through, recognised by Shift plus the
      secondary button; Shift and not Ctrl because Ctrl+click *is* the
      secondary press on macOS and arrives as `contextmenu` with `ctrlKey`;
      by the same token Ctrl+Shift+click there carries `button: 0` and is not
      the bypass (a two-finger tap or a second button is) — unverified;
      Firefox implements the same gesture below the page and never dispatches
      the event, Chrome dispatches it and the app declines it (D1/D2)

## 4. Verification

- [x] 4.1 `bun run typecheck` and `cd client && bunx vitest run` pass —
      686 client, 589 server (2026-09-02, after the review fold-in, on a main
      that also carries the peer's `listing-tree-cache`). One pre-existing cell
      needed a fidelity fix:
      `viewerLayer.test.tsx`'s "errored orbit overlay still promotes"
      dispatched a bare `new Event('pointerup')` — no `button` at all, which
      no browser sends and which the release guard reads as not the primary's;
      it now dispatches a `PointerEvent`. The suite's other `pointerup`s rely
      on happy-dom's default `button: 0`, which is fine and unchanged
- [x] 4.2 **Done 2026-09-02, this session, Playwright Chromium 150 headless
      against the dev instance on the real library (flat root), read through
      a window bubble `contextmenu` listener — `defaultPrevented` is the
      proxy for "the browser's menu shows", since headless draws none.**
      Folder and zip tiles, a model tile, the orbit overlay mid-hold and
      mid-drag, and the lightbox: plain right-click prevented and the app's
      menu raised on every surface; Shift+right-click not prevented and no
      app menu on every surface, no overlay or lightbox mounted by it. With
      the app's menu open, Shift+right-click on another tile closed it, not
      prevented (a shifted click landing *on* the open menu leaves it, the
      documented unchanged case). Plain right-click released mid-hold: menu
      up, overlay still mounted, **no lightbox** — and the primary's own
      release then promoted. Mid-drag Shift+right-click: not prevented,
      overlay still mounted, and the primary's later release opened nothing;
      mid-hold without drag the same. **Persist hold under the shifted
      press:** the overlay stays mounted through the press and goes when the
      pointer leaves the tile, as after any release (D6: recorded, either was
      acceptable). Firefox: see below
- [x] 4.2b **Firefox — verified by Masa, 2026-09-02, on the system Firefox:**
      Shift+right-click shows the browser's menu and plain right-click still
      raises the app's menu (no Playwright Firefox build here, so this half
      was a manual check; the app takes the unshifted path unchanged)
