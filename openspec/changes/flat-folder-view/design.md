# Design — flat-folder-view

## Context

`listDir` resolves a virtual path to either a filesystem directory (`listFsDir`) or a zip subtree (`listZipDir`) and returns one level of `DirEntry`s; the client's `useThumbnails` pipeline and viewer operate purely on `DirEntry.path` (virtual path) + `mtime`, and `Grid` renders `entry.name` as the tile label. Thumbnails and camera state are keyed by virtual path server-side, independent of how a listing was produced. `listFsDir` deliberately follows symlinked directories (stat, not dirent), which a recursive walk must make cycle-safe.

## Goals / Non-Goals

**Goals:**
- One request returns the folder's immediate container tiles plus every model under it (through subfolders and zips) as ordinary `DirEntry`s, so the entire existing tile/orbit/thumbnail/navigation machinery works untouched.
- Distinguishable labels for same-named models in different subfolders.
- Bounded work on huge trees, with truncation visible to the user.

**Non-Goals:**
- Flat view *inside* the results of another zip's flat view or any nested-zip descent — nested zips stay rejected by design (D6).
- Grouping/section headers, search/filtering, or sort options — flat is one alphabetical grid by relative path; refinements are future changes.
- Persisting the toggle across reloads or per-folder — session-sticky UI state only, promotable later if the view proves out.

## Decisions

### D1: `flat` is a query flag on `GET /api/dir`, not a new endpoint

Same path/vpath semantics, same error taxonomy, same guard; the response stays a `DirListing`. `ApiClient.listDir` gains an options argument. A separate endpoint would duplicate vpath resolution and error handling for no isolation benefit.

### D2: Flat entries are plain `DirEntry`s with `name` = root-relative path

A flat listing is the root's immediate `dir`/`zip` entries (exactly as the nested listing reports them — top level only, no recursive folder tiles) followed by `kind: 'model'` entries for every model under the root. Model `path`s are the same virtual paths a nested browse would produce (so thumbnail PNGs and camera state are shared between views); model `name`s are relative to the requested root — `printers/voron/part.stl`, or `kit.zip!/arms/left.stl` for zip contents. The existing `sortEntries` rank (dir < zip < model) already puts containers before models, `Grid` already renders `name` and routes dir/zip tiles through `onEnter`, so navigation and labels need no client change; `DirEntry`'s shape is untouched, so `useThumbnails`, hover-warm, and the viewer consume flat listings blindly. A zip's tile and its extracted models both appear — the tile is the way down, the models are the flat content; same for folders.

*Alternative — client-side recursion (N requests):* thundering-herd of `/api/dir` calls, client-side cycle/caps logic, and interleaved partial state; the server walk is one bounded request.

### D3: Walk = existing per-level listers + realpath cycle guard + entry cap

`listFlat` walks depth-first alphabetically, reusing the module's per-level logic: filesystem levels via `readdir`+`stat` (skipping dot-entries, as today), zips flattened via `listZipEntries` in one step (zip name lists are already flat — every model entry under the prefix, minus nested `.zip`s, which are skipped, not errors, in a walk). Each *directory* is entered only once, keyed by `realpath`, making symlink cycles terminate; the walk stops at a model cap (500) and sets `truncated: true` on `DirListing` (optional field — nested listings never set it). Unreadable subdirectories are skipped rather than failing the whole walk; only an unreadable *root* is a 404, matching `listDir` today.

*Alternative — depth cap instead of realpath set:* still explodes on wide trees and still loops within the cap; the visited-set is exact and cheap.

### D4: Toggle lives in App state beside the path bar, sticky within the session

A single `flat` boolean in `App`; `navigate` passes it through, and toggling re-fetches the current path. Flat mode renders the same `Grid` — top-level container tiles first, then models, falling out of the listing order with no Grid changes. A small notice renders when `truncated` is set ("showing first 500 models"). Entering a folder from the path bar (or `↑`) stays in flat mode until toggled off — consistent with "I'm browsing this collection flat right now".

## Risks / Trade-offs

- [Huge trees make one slow request] → cap at 500 models + skip-on-error keeps the walk bounded; truncation is explicit, never silent.
- [500 fresh thumbnails hammer the render queue on first flat view] → the existing limited-concurrency queue and orbit-suspension already govern this; tiles fill progressively, same as a big nested directory.
- [Relative-path labels can be long] → tile labels already truncate with ellipsis; the full name remains in `alt`/hover.
- [Same model reachable via two symlinked routes appears twice] → accepted; entries are keyed by their virtual path and each renders/persists independently. The cycle guard only guarantees termination.

## Open Questions

None.
