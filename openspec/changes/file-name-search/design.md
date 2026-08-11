# Design — file-name-search

## Context

`listFlat` (server/src/listing.ts) already does everything a recursive search needs: it walks directories and zips under a root with a visited-set for symlink safety, charges every examined entry to a step budget, collects models named by root-relative path into `walk.models`, sorts by base name, applies a cap, and flags truncation. The client reaches it through `ApiClient.listDir(path, { flat })` and `fetchListing` in `App`, which carries the latest-wins `requestRef` guard, the pending/skeleton state, and the truncation notice. The header already hosts the path bar and the Flat toggle.

## Goals / Non-Goals

**Goals:**
- Typing narrows the current grid instantly with zero requests.
- An explicit deep search finds models by name anywhere under the current directory, with flat-listing ergonomics (relative-path labels, shared thumbnails/camera, truncation, skeleton).
- Both modes work from nested and flat views, and inside zips.

**Non-Goals:**
- Fuzzy matching, globs, or content search — case-insensitive substring on the base name only.
- Search history, saved searches, or cross-root search.
- Recursive *directory* results in deep search — the walk's recursive payload is models; containers stay top-level.

## Decisions

### D1: Deep search is `listFlat` with a match predicate, not a new walker

`listFlat(vpath)` gains an optional `query`: after the walk, models are filtered by case-insensitive substring on their base name (`n.slice(n.lastIndexOf('/') + 1)`, the same basename the sort comparator uses) *before* the cap, so the cap bounds matches rather than raw walk output; top-level containers are filtered by the same predicate. Everything else — budget, visited set, zip descent, sort order, `truncated` — is untouched and shared. The endpoint stays `/api/dir`: `q` composes with `flat=true` (`flat=true&q=…` is a deep search); a `q` without `flat=true` is a 400, since plain-listing filtering is the client's job and silently ignoring the parameter would mask bugs.

*Alternative — a separate `/api/search` walker:* duplicates the budget/visited/zip rules that took the flat-folder-view change several reviews to pin down; a predicate on the proven walk cannot drift from it.

### D2: The filter is client view state layered over `listing`

A `filter` string in `App`, fed by a header search input, narrows the rendered entries (`entries.filter(e => e.name.toLowerCase().includes(q))` at render time) without touching `listing`, requests, or `useThumbnails` (whose effect keys on `entries` — the unfiltered listing — so already-warm thumbnails stay warm while filtering). Every tile kind is matched by its display name — in flat view a model's name is its relative path, so path fragments match too. Clearing the input or navigating resets the filter. The truncation notice keeps describing the underlying listing, not the filtered view.

### D3: Deep search rides `fetchListing`; the query is part of the request, not the toggle

Submitting the search (Enter in the input, or its Deep button) calls the existing `fetchListing` path with `{ flat: true, q }` for the current directory: the request inherits the monotonic `requestRef` guard, the pending/skeleton reveal, and the error banner; the response renders as an ordinary listing so tiles, thumbnails, orbit handoff, and camera persistence need no changes. The active query is App state shown in the input; clearing it re-issues the plain listing for the current path (nested or flat per the toggle), and navigating away drops it — deep search is a transient query view, not a mode that follows navigation. While deep results are shown the Flat toggle reflects its own state untouched; pressing it simply issues its ordinary request, which supersedes the search by latest-wins.

## Risks / Trade-offs

- [Two inputs in the header (path bar, search) compete for width] → the search input stays compact (fixed basis, grows on focus); cosmetic, tuned at apply.
- [A deep search on a huge tree is expensive] → bounded by the same step budget and cap as any flat listing; truncation is reported the same way.
- [Filter mode hides tiles while `truncated` math counts the full listing] → the notice already describes the response, not the view; accepted.
- [`q` without `flat` becoming meaningful later] → reserved by the 400 today; loosening it is additive.
