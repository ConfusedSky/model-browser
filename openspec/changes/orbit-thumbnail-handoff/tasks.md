# Tasks — orbit-thumbnail-handoff

## 1. Paint-ready persist (App)

- [ ] 1.1 In `App.persist()`, decode the snapshot blob (`createImageBitmap`, falling back to `Image.decode` on the object URL) before calling `setThumb`, so the resolved promise means "new thumbnail applied and decodable" (design D2)
- [ ] 1.2 Keep the existing best-effort catch: persist failures resolve (not reject) so callers' awaits always complete

## 2. Persistence-aware dismissal (ViewerLayer)

- [ ] 2.1 Store the `settle → onPersist` chain from `onUp` in a `pendingPersistRef` (D1)
- [ ] 2.2 Add `dismissAfterPersist()`: `Promise.race` the pending persist against a ~1.5s timeout, wait two `requestAnimationFrame`s, then `onDismiss()`; dismiss synchronously when nothing is pending (D1/D2/D3)
- [ ] 2.3 Route the post-drag dismiss triggers — `onPointerLeave` and release-outside-tile in `onUp` — through `dismissAfterPersist()`; leave scroll/resize and non-drag (click-through) dismissals immediate
- [ ] 2.4 Stale guards: when the deferred dismiss fires, no-op if `pointer.current.down` (new gesture active) or the `viewer` prop identity changed since scheduling (D4)

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual E2E via Playwright MCP: orbit-drag a tile, release outside it, and confirm the overlay holds until the tile shows the new orientation with no old-orientation flash
- [ ] 3.3 Manual E2E: rapid tile-hopping (release one drag, immediately press another tile) — the new interaction is not dismissed by the earlier pending hold; scroll mid-overlay still dismisses immediately
