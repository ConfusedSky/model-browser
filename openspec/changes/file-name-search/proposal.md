# File Name Search

## Why

Finding a part today means walking folders or flat-listing a whole tree and scanning tiles by eye. A name search closes the gap two ways: instantly narrowing what is already on screen, and — when the part is somewhere below — asking the server to hunt for it recursively the same way the flat walk already traverses the tree.

## What Changes

- **Filter mode (frontend)**: a search input in the header narrows the tiles already on screen as you type — case-insensitive substring on the tile's name, applied to every kind (folders, zips, models), in nested and flat views alike. Pure view state: no requests, clearing restores the full listing, navigation resets it.
- **Deep search mode (backend)**: an explicit action (Enter / a Deep button on the search box) sends the query to the server, which reuses the flat walk — same recursive descent, zip handling, symlink/visited rules, step budget, and model cap — returning the models under the current directory whose *file name* matches, labeled by relative path exactly like a flat listing, plus the top-level folder/zip tiles whose names match. Results render in the normal grid (thumbnails, orbit, lightbox, camera persistence all shared), the cap applies to matches (not raw walk output), truncation is reported, and the in-flight skeleton and latest-wins guard apply as for any listing.

Assumptions: matching is case-insensitive substring on the entry's base name (no glob/fuzzy); deep search matches model files recursively but directories only at the top level (the walk's recursive payload is models); leaving deep search (clearing the query or navigating) returns to the ordinary listing for the current path.

## Capabilities

### New Capabilities

- `file-search`: searching the library by file name — the live on-screen filter and the recursive server-side deep search.

### Modified Capabilities

None — the deep search extends the existing flat-walk machinery behind the same listing endpoint, without changing any recorded directory-browsing behavior.

## Impact

- `server/src/listing.ts` — `listFlat` gains an optional query: filter walked models (and top-level containers) by name before the cap. `server/src/app.ts` — `q` parameter on `/api/dir` alongside `flat`.
- `client/src/api/client.ts` — `listDir` options gain `q`.
- `client/src/App.tsx` — search input + mode affordance in the header; filter as view state over the current listing; deep search through the existing `fetchListing` path (skeleton, latest-wins, truncation notice for free).
- `client/test/`, `server/test/` — filter and deep-search coverage.
