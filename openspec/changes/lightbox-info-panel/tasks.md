# Tasks — lightbox-info-panel

## 1. Lightbox layout & panel

- [ ] 1.1 Restructure the lightbox dialog in `client/src/viewer/ViewerLayer.tsx`: horizontal flex — square canvas host (unchanged sizing) + ~18rem info panel; remove the bottom-center name pill; cap dialog width for small windows (design D1)
- [ ] 1.2 Move `onPointerDown={startGesture}` (and the wheel-zoom handler) from the dialog to the canvas host so panel interaction never starts a gesture (D3)
- [ ] 1.3 Render panel content from `viewer.entry`: name, full virtual path (`break-all`, no truncation), format, human-readable size, modified date (D2)
- [ ] 1.4 Copy-path button: `navigator.clipboard.writeText` with brief "copied" feedback; select-the-text fallback on failure (D2)

## 2. Verification

- [ ] 2.1 `bun run typecheck` and `bun run test` pass; adjust any ViewerLayer tests that assumed the name pill or dialog-level gesture binding
- [ ] 2.2 Manual E2E via Playwright MCP: open a plain model and a zip-entry model — panel shows correct full paths; copy button puts the path on the clipboard; dragging on the panel neither orbits nor closes; orbit/zoom on the canvas unchanged
- [ ] 2.3 Manual E2E: Tab cycles viewer → axis controls → copy → close and stays trapped; Esc still closes and persists; closing returns focus to the tile
