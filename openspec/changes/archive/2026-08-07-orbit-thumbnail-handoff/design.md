# Design — orbit-thumbnail-handoff

## Context

On orbit-drag release, `ViewerLayer.onUp` fires `settle → onPersist` without awaiting it, and the dismissal paths (`onPointerLeave`, release-outside-tile, scroll/resize) unmount the overlay immediately. `App.persist()` snapshots offscreen, PUTs, then `setThumb` — so the tile under the departing overlay still shows the old orientation for the in-flight window, then swaps: the observed jitter. The lightbox path (`closeLightbox`) already awaits `settle` and `onPersist` before `onDismiss`, proving the shape works; the orbit overlay just never adopted it. Prior archived work (viewer-thumbnail continuity) made the handoff seamless in *space* (framing, sRGB); this change makes it seamless in *time*.

## Goals / Non-Goals

**Goals:**
- After an orbit drag, the overlay stays mounted until the tile's new thumbnail is applied and decodable, then unmounts onto matching pixels.
- The overlay can never be wedged open by a slow or failed persist.
- A deferred dismiss never cancels a newer interaction (new press on this or another tile).

**Non-Goals:**
- Scroll/resize dismissal continuity — the overlay is `position: fixed`; holding it during scroll detaches it from its tile, which is worse than the swap. Stays immediate.
- Lightbox changes (already persistence-aware), thumbnail-queue/server/API changes, and click-through (non-drag) dismissals, which persist nothing and stay immediate.

## Decisions

### D1: Gate dismissal in ViewerLayer on the pending persist promise

`onUp` stores the `settle → onPersist` chain in a `pendingPersistRef`. Post-drag dismiss triggers (`onPointerLeave`, release-outside) go through one `dismissAfterPersist()` that awaits `Promise.race([pending, timeout])` before calling `onDismiss()`. When nothing is pending it dismisses synchronously, preserving today's behavior for non-drag paths.

*Alternative — hold in App by delaying `setViewer(null)`:* App can't distinguish "dismiss after drag" from other dismissals without new plumbing, and ViewerLayer already owns gesture state; the lightbox precedent (await inside the layer, then `onDismiss`) keeps both modes symmetric.

### D2: `persist()` resolves only when the new thumb is paint-ready

`App.persist()` gains two steps before resolving: decode the snapshot blob (`createImageBitmap` / `Image.decode` on the object URL) *before* `setThumb`, so the `<img>` swap can't flash a half-decoded frame; ViewerLayer then waits two `requestAnimationFrame`s after the awaited persist resolves, giving React time to commit the new `src` under the still-mounted overlay before unmounting.

*Alternative — `flushSync` around `setThumb`:* forces a synchronous commit but not a paint, and couples App to the overlay's timing; double-rAF is the established idiom for "committed and painted".

### D3: Bounded hold — timeout and error both fall through to dismissal

`dismissAfterPersist` races the persist against ~1.5s. Persist already catches its own errors (best-effort contract, unchanged), so the race resolves on failure too; either way the overlay dismisses with the old-thumbnail swap as the degraded case — exactly today's behavior, never worse.

### D4: Stale-dismiss guards

When the deferred dismiss fires: no-op if a new gesture is active (`pointer.current.down`) — the new gesture's own release owns dismissal; and no-op if the `viewer` prop identity changed since scheduling (a new tile's viewer replaced this one — calling `onDismiss` would clobber it, since `closeViewer` unconditionally nulls the shared viewer state).

Corollary the hold makes necessary: a new press can now replace the `viewer` prop while the layer stays mounted (immediate dismissal used to force an unmount/remount between tiles), so a viewer identity change re-arms the pointer/gesture state exactly as a fresh mount would — otherwise the new tile's drag and promote would be dead.

## Risks / Trade-offs

- [Overlay lingers up to the timeout on slow PUTs] → 1.5s cap; snapshot+PUT is local-loopback and typically well under it. The hold is invisible when the pointer is still over the tile (overlay persists there anyway today).
- [Double-rAF is a heuristic, not a paint guarantee] → decode-before-`setThumb` removes the expensive step; a missed frame degrades to today's behavior, never worse.
- [Deferred dismiss interleaving with rapid tile-hopping] → D4 guards; the session-close path in the mount effect already handles the old session's teardown on entry change.

## Open Questions

None — failure semantics deliberately match the existing best-effort persist contract.
