# Flat Folder View

## Why

Model collections are usually organized in nested folders (per-designer, per-kit, per-part), so answering "what's in here?" means clicking into every subfolder. A flat view shows every model recursively under the current folder in one grid — browse a whole collection at a glance, orbit and lightbox included.

## What Changes

- **Server**: `GET /api/dir` gains a `flat` query flag. A flat listing returns the requested folder's *immediate* subdirectory and zip tiles (top level only — so you can still navigate down while flat), followed by every model recursively under the folder — descending into subdirectories and into zip files (one level, per the nested-zip design rule) — with each model's `name` set to its path relative to the requested root, so labels distinguish `a/part.stl` from `b/part.stl`. Hidden (dot-prefixed) directories are skipped as in normal listings. The walk is cycle-safe under symlinks and capped; a truncated result says so via a new optional `truncated` flag on `DirListing`.
- **Client**: a flat-view toggle beside the path bar. When active, navigation requests flat listings; the grid shows the top-level folder/zip tiles first (navigable as usual), then all model tiles with relative-path labels. Hover-warm, drag-orbit, lightbox, and thumbnail persistence work unchanged — entries carry the same virtual paths, so thumbnails/camera state are shared with the nested view. The toggle stays on while navigating within the session.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: ADDED requirements — recursive flat listing on the server (top-level container tiles + recursive models, zip-descending, cycle-safe, capped) and the client's flat-view toggle with relative-path labels.

## Impact

- `server/src/listing.ts` — recursive walk (`listFlat`), reusing `listFsDir`/`listZipDir` internals; `server/src/app.ts` — `flat` query param.
- `shared/types.ts` — optional `truncated` on `DirListing`; no `DirEntry` changes.
- `client/src/api/client.ts` — `listDir(path, { flat })` (all I/O stays in ApiClient per D1).
- `client/src/App.tsx` — flat toggle state + truncation notice; `Grid`/`useThumbnails` unchanged (labels ride `entry.name`, thumbnails key off unchanged virtual paths).
