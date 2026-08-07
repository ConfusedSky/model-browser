# Lightbox Info Panel

## Why

The lightbox shows only the model and its bare file name — there's no way to see *where* the model lives (which folder, which zip), which matters once flat view mixes models from many subfolders into one grid. An info panel puts the full path in view right where you're inspecting the model.

## What Changes

- The lightbox gains an info panel to the right of the viewer square showing the model's full virtual path (e.g. `/models/kits/arms.zip!/left.stl`) plus the metadata already on the entry: file name, format, size, and modified time. A copy button copies the full path to the clipboard.
- The panel's controls join the lightbox's existing focus trap; the bottom-center name pill is replaced by the panel (the name now lives there).
- Client-only: everything displayed is already on `DirEntry` — no server, API, or persistence changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: MODIFIED "Lightbox expanded view" — the lightbox includes an info panel with the model's full path and file metadata, with a copy-path affordance.

## Impact

- `client/src/viewer/ViewerLayer.tsx` — lightbox dialog becomes viewer square + side panel; name pill removed; focus trap already picks up new buttons (`querySelectorAll('button')`).
- No changes to the orbit overlay, session, renderer, thumbnails, or server.
