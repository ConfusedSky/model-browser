# Orbit → Thumbnail Handoff

## Why

Releasing an orbit drag can dismiss the live overlay before the refreshed thumbnail exists: the snapshot → PUT → state-update pipeline is still in flight when the overlay unmounts, so the tile flashes the *old* orientation, then jumps to the new one. The lightbox already awaits persistence before closing; the orbit overlay does not, which is the jitter the user sees when dragging models around the grid.

## What Changes

- The orbit overlay's dismissal becomes persistence-aware: after a drag, any dismiss trigger (pointer leaving the tile, release outside the tile) holds the live view in place until the new thumbnail has been generated, applied to the tile's thumb state, and is ready to paint — then the overlay unmounts, landing on pixels that match the live view.
- Persist failure or slowness never wedges the overlay: on error or a short timeout, dismiss proceeds (the old-thumbnail swap is accepted as the degraded case, matching today's behavior).
- Scroll/resize dismissal stays immediate — the overlay is fixed-position, so holding it during scroll would leave it visibly detached from its tile.
- A deferred dismiss must not clobber a newer interaction (e.g. the user has already pressed another tile before the first tile's persist resolves).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: The "Drag-to-orbit on grid tiles via shared overlay canvas" requirement's dismissal clause changes — after an orbit drag, dismissal back to the static thumbnail SHALL wait for the refreshed thumbnail (with failure/timeout fallback) instead of unmounting immediately.

## Impact

- `client/src/viewer/ViewerLayer.tsx` — dismissal paths after a drag (`onUp` outside-tile dismiss, `onPointerLeave`) gate on the pending persist.
- `client/src/App.tsx` — `persist()` must resolve only once the new thumb state is applied (and the blob is decodable), so the overlay can await it; `closeViewer` guards against stale deferred dismissals.
- No server, API, or thumbnail-pipeline changes; lightbox behavior unchanged (it already awaits persist).
