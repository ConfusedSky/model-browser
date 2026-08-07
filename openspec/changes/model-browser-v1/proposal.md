## Why

Downloaded 3D-print models (Printables/Thingiverse zips, loose STLs) pile up in directories with no way to see what anything is without opening a slicer. A local browser that shows every model as an orbitable 3D thumbnail — including models still inside zips — makes the library actually browsable.

## What Changes

- New app (greenfield): local Bun + Hono server with a browser UI (React/Vite/Tailwind/three.js).
- Directory browsing with an editable path bar (server-backed autocomplete, localStorage recents) and a thumbnail grid of STL/3MF/OBJ files, subdirectories, and zips.
- Zip files browse like folders — contents listed from the central directory without extracting anything to disk; entries addressed via virtual paths (`foo.zip!/inner/part.stl`).
- Static PNG thumbnails rendered client-side, persisted server-side keyed by `path + mtime`; camera/rotation state stored alongside each thumbnail keyed by path only, so orbited orientation survives sessions and browsers.
- Drag-to-orbit on any tile via a single shared live WebGL overlay canvas; hover pre-warms a byte-budgeted mesh LRU so orbit starts instantly; releasing the orbit re-snapshots the thumbnail.
- Lightbox expanded view with full orbit/zoom controls.
- Collapsible right side panel scaffolding a chat interface (empty placeholder for future AI chat about models).
- Electron-ready seams: Hono (runs on Bun and Node) and a frontend `ApiClient` abstraction over all I/O; no Bun-only APIs in shared app logic.

## Capabilities

### New Capabilities
- `directory-browsing`: Path bar (editable, autocomplete, recents), directory listing, and thumbnail grid navigation across folders and zip virtual folders.
- `model-thumbnails`: Client-side thumbnail rendering pipeline, server-side persistent thumbnail + camera-state cache, render queue with tile pop-in.
- `model-viewer`: Shared live orbit overlay canvas (mousedown-to-orbit on tiles), hover-warmed mesh LRU, lightbox expanded view, rotation-state persistence on release.
- `zip-browsing`: Zip-as-virtual-folder listing via central directory, on-demand entry decompression, virtual path addressing.
- `chat-panel`: Collapsible right-side panel with a placeholder chat UI (no backend behavior yet).

### Modified Capabilities

(none — greenfield project)

## Impact

- New codebase: `server/` (Bun + Hono API: dir listing, file/zip-entry streaming, thumbnail + camera cache, path autocomplete) and `client/` (React + Vite + Tailwind + three.js).
- New dependencies: hono, react, three, a zip library (e.g. fflate), vite, tailwind.
- Server-side cache directory (e.g. `~/.cache/model-browser/`) for thumbnails and camera states.
- Localhost-only: server reads arbitrary local paths; no auth, not for hosted deployment.
- Future work explicitly out of scope: Electron shell, AI chat backend, decimated proxy meshes.
