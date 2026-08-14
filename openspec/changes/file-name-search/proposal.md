# File Name Search

## Why

Finding a part today means walking folders or flat-listing a whole tree and scanning tiles by eye. A name search closes the gap two ways: instantly narrowing what is already on screen, and — when the part is somewhere below — asking the server to hunt for it recursively the same way the flat walk already traverses the tree.

## What Changes

- **Filter mode (frontend)**: a search input in the header narrows the tiles already on screen as you type — case-insensitive substring on the tile's name, applied to every kind (folders, zips, models), in nested and flat views alike. Pure view state: no requests, clearing restores the full listing, navigation resets it.
- **Deep search mode (backend)**: an explicit action (Enter / a Deep button on the search box) sends the query to the server, which reuses the flat walk — same recursive descent, zip handling, symlink/visited rules, step budget, and model cap — returning the models under the current directory whose *file name* matches, labeled by relative path exactly like a flat listing, plus the top-level folder/zip tiles whose names match. Results render in the normal grid (thumbnails, orbit, lightbox, camera persistence all shared), the cap applies to matches (not raw walk output), truncation is reported, and the in-flight skeleton and latest-wins guard apply as for any listing.

- **Legibility (frontend)**: while a query is committed the grid is labeled as results for it rather than passing for a directory listing, and the two empty states explain themselves — a search that matched nothing, and a filter that hides every tile.

Assumptions: matching is case-insensitive substring on the entry's base name for deep search but on the *displayed* name for the filter (a deliberate asymmetry — flat-view labels are relative paths, so folder fragments match while filtering but not while deep-searching); a blank or whitespace-only query is treated as no query; deep search matches model files recursively but directories only at the top level (the walk's recursive payload is models); the input drives two distinct states — a live `filter` and a separately *committed* `query` — so typing over deep results filters them without re-searching; leaving deep search (clearing a committed query or navigating) returns to the ordinary listing.

## Capabilities

### New Capabilities

- `file-search`: searching the library by file name — the live on-screen filter and the recursive server-side deep search.

### Modified Capabilities

- `directory-browsing`: MODIFIED requirement — the recursive flat listing's "every model" and explicit-flag clauses are scoped to queryless requests, since a file-search query narrows the walk and a query without the flat flag is rejected.

## Impact

- `server/src/listing.ts` — `listFlat` gains an optional query: filter walked models (and top-level containers) by name before the cap. `server/src/app.ts` — `q` parameter on `/api/dir` alongside `flat`.
- `client/src/api/client.ts` — `listDir` options gain `q`.
- `client/src/App.tsx` — search input + mode affordance in the header; filter as view state over the current listing (the filtered array reaches `Grid` only, never `useThumbnails`); deep search through the existing `fetchListing` path at the hoisted `dest` target (skeleton, latest-wins, truncation notice for free); results label and the two empty states beside the truncation notice.
- `client/test/`, `server/test/` — filter and deep-search coverage.
