# Flat Folder View

## Why

Model collections are usually organized in nested folders (per-designer, per-kit, per-part), so answering "what's in here?" means clicking into every subfolder. A flat view shows every model recursively under the current folder in one grid — browse a whole collection at a glance, orbit and lightbox included.

## What Changes

- **Server**: `GET /api/dir` gains a `flat=true` query flag. A flat listing returns the requested root's *immediate* subdirectory and zip tiles (top level only — so you can still navigate down while flat), followed by every model recursively under the root — descending into subdirectories and into zip files (one archive level, per the nested-zip design rule) — with each model's `name` set to its path relative to the requested root, so labels distinguish `a/part.stl` from `b/part.stl`. Models are ordered by **file name**, so same-named parts from different folders sit together. Hidden (dot-prefixed) directories are skipped as in normal listings. Each real directory is entered at most once (keyed by realpath), which makes the walk cycle-safe under symlinks and lists a file reachable by several routes once. The walk is bounded by a hard budget (directories visited, models scanned) independent of the 500-model return cap; anything dropped by either sets a new optional `truncated` flag on `DirListing`. A root inside a zip is flat too — its immediate directories as tiles, every model under the prefix, no further descent.
- **Client**: a flat-view toggle beside the path bar. When active, navigation requests flat listings; the grid shows the top-level folder/zip tiles first (navigable as usual), then all model tiles with relative-path labels. Hover-warm, drag-orbit, lightbox, and thumbnail persistence work unchanged — entries carry the same virtual paths, so thumbnails/camera state are shared with the nested view. The toggle stays on while navigating within the session.
- **Client (thumbnail pipeline)**: `useThumbnails` currently runs the whole per-tile job — including the `getThumb` cache lookup, which touches no renderer — inside the 2-slot render queue, so even a fully cached view paints two tiles at a time. Flat view makes hundreds of cached tiles the common case, so the cache lookup moves out of the render queue under its own concurrency limit; only miss/stale load→parse→render work stays gated by the queue, leaving the single-renderer and orbit-suspension invariants untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: ADDED requirements — recursive flat listing on the server (top-level container tiles + recursive models, zip-descending, dedup/cycle-safe, budgeted and capped) and the client's flat-view toggle with relative-path labels.
- `model-thumbnails`: MODIFIED requirement — the render queue gates rendering work only; cached-thumbnail lookups run outside it under their own concurrency limit.

## Impact

- `server/src/listing.ts` — recursive walk (`listFlat`), reusing `listFsDir`/`listZipDir` internals; `server/src/app.ts` — `flat` query param.
- `shared/types.ts` — optional `truncated` on `DirListing`; no `DirEntry` changes.
- `client/src/api/client.ts` — `listDir(path, { flat })` (all I/O stays in ApiClient per D1).
- `client/src/App.tsx` — flat toggle state + truncation notice; `Grid` unchanged (labels ride `entry.name`, thumbnails key off unchanged virtual paths).
- `client/src/hooks/useThumbnails.ts` — cache lookup moved off the render queue (D6).
