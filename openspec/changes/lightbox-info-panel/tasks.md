# Tasks — lightbox-info-panel

## 1. Lightbox layout & panel

- [ ] 1.1 Restructure the lightbox dialog in `client/src/viewer/ViewerLayer.tsx`: horizontal flex — `relative` square wrapper around the canvas host + ~18rem info panel; move the `min(80vh,80vw)` sizing off the dialog onto the wrapper with `shrink-0` (the host is `h-full w-full`, which only works while the dialog *is* the square); re-anchor the spinner, load-error display, and axis control into the square wrapper; close button stays dialog-anchored top-right with the panel reserving that corner, DOM order square → panel → close; remove the bottom-center name pill (design D1)
- [ ] 1.2 Cap the dialog at `max-w-[95vw]` for small windows so the **panel** shrinks (`min-w-0`) and the square never does — a squeezed square breaks live-view/thumbnail aspect parity, since `snapshot()` always captures at `aspect = 1` (D1)
- [ ] 1.3 Move `onPointerDown={startGesture}`, the wheel-zoom handler, and the `cursor-grab active:cursor-grabbing touch-none` classes from the dialog to the canvas host so panel interaction never starts a gesture, wheel over the panel never zooms, and the panel keeps a normal cursor and can be touch-scrolled (D3)
- [ ] 1.4 Add `client/src/lib/format.ts` with byte-size and date formatters — the client has none today — plus `client/test/format.test.ts` covering the unit boundaries and a zero size (D4)
- [ ] 1.5 Render panel content from `viewer.entry` (never from the session, so the panel is up during load and after a load error): name, full virtual path (`break-all`, no truncation), format — `DirEntry.format` is optional, so handle undefined — size and modified date via 1.4's formatters, with the modified time labeled as the archive's for zip entries since `DirEntry.mtime` is the zip's; panel scrolls with `overflow-y-auto` for long paths (D1/D2)
- [ ] 1.6 Copy-path button: `navigator.clipboard.writeText` with brief "copied" feedback; guard on `navigator.clipboard` existing (it is `undefined` outside a secure context and the call then throws synchronously, so a bare `.catch()` misses it) and wrap the call — on either failure select the path text instead and show no "copied" feedback (D2)

## 2. Verification

- [ ] 2.1 `bun run typecheck` and `bun run test` pass; adjust any ViewerLayer tests that assumed the name pill or dialog-level gesture binding, and add a component test that pointerdown on the canvas host starts a gesture while pointerdown on the panel does not (no existing test covers the gesture binding — design Risks)
- [ ] 2.2 Manual E2E via Playwright MCP: open a plain model and a zip-entry model — panel shows correct full paths and the zip entry's modified time is labeled as the archive's; copy button puts the path on the clipboard; dragging or wheel-scrolling on the panel neither orbits, zooms, nor closes; orbit/zoom on the canvas unchanged; load-failure state (error display, spinner) renders within the viewer square, not over the panel, and the panel still shows a copyable path for the failed model
- [ ] 2.3 Manual E2E: Tab cycles viewer → axis controls → copy → close and stays trapped; Esc still closes and persists; closing returns focus to the tile
- [ ] 2.4 Manual E2E: narrow the window until `max-w-[95vw]` engages — the viewer square stays square (panel shrinks), and a thumbnail persisted at that size frames the model the same as the live view did
