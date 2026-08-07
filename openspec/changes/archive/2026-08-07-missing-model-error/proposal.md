# Missing Model Error

## Why

Orbiting or opening the lightbox for a model whose file has been deleted (or whose zip entry vanished) fails silently: the viewer shows its loading spinner, the mesh fetch 404s, and the overlay just dismisses back to the cached thumbnail as if nothing happened. The user gets no signal that the file is gone — the stale thumbnail keeps advertising a model that no longer exists.

## What Changes

- **Explicit error state in the viewer**: when the session's mesh load fails (missing file, gone zip entry, unparseable model), the orbit overlay / lightbox shows an error message (file name + reason, e.g. "no such file") instead of silently dismissing. The lightbox stays open until dismissed normally (Esc / outside click / ✕); the orbit overlay's error dismisses like the overlay does today (pointer leave, scroll, click).
- **Grid reflects the failure**: the same failure marks the tile's thumbnail state as errored, so the grid stops advertising a healthy model (the existing broken-tile rendering is reused).
- **No persistence on error**: a failed session never persists camera/axis/thumbnail (nothing to snapshot), and dismissing an errored viewer skips the settle/persist path.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-viewer`: mesh-load failure in the orbit overlay or lightbox surfaces an explicit error state instead of silently dismissing; the tile is marked errored.

## Impact

- `client/src/viewer/ViewerLayer.tsx`: replace the silent `onDismiss()` on load failure with an error state; error UI in both orbit and lightbox modes; skip settle/persist when errored.
- `client/src/App.tsx`: failure callback marks the tile's thumb state as `error` (plumbed to `useThumbnails`' `setThumb`).
- Error message comes from the existing `HttpError` thrown by `ApiClient.fetchModel` (server already returns "no such file: …" / zip errors); no server or API changes.
