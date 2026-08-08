# Lightbox Info Panel

## Why

The lightbox shows only the model and its bare file name — there's no way to see *where* the model lives (which folder, which zip), which matters once flat view mixes models from many subfolders into one grid. An info panel puts the full path in view right where you're inspecting the model.

## What Changes

- The lightbox gains an info panel to the right of the viewer square showing the model's full virtual path (e.g. `/models/kits/arms.zip!/left.stl`) plus the metadata already on the entry: file name, format, size, and modified time (for zip entries `DirEntry.mtime` is the containing archive's mtime, so the panel labels it as the archive's modified time). A copy button copies the full path to the clipboard.
- The panel's controls join the lightbox's existing focus trap; the bottom-center name pill is replaced by the panel (the name now lives there). Because the panel reads the directory entry rather than the mesh, it is up from the moment the lightbox opens — including for a model that is still loading or fails to load.
- Client-only: everything displayed is already on `DirEntry` — no server, API, or persistence changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: MODIFIED "Lightbox expanded view" — the lightbox includes an info panel with the model's full path and file metadata, with a copy-path affordance.

## Impact

- `client/src/viewer/ViewerLayer.tsx` — lightbox dialog becomes viewer square + side panel; the square's overlays (spinner, load-error display, axis control) re-anchor to a square wrapper; name pill removed; focus trap already picks up new buttons (`querySelectorAll('button')`).
- `client/src/lib/format.ts` (new) — byte-size and date formatting for the panel; the client has no such helper today.
- No changes to the orbit overlay, session, renderer, thumbnails, or server.
