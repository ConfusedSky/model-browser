# Design — file-name-search

## Context

`listFlat` (server/src/listing.ts) already does everything a recursive search needs: it walks directories and zips under a root with a visited-set for symlink safety, charges every examined entry to a step budget, collects models named by root-relative path into `walk.models`, sorts by base name, applies a cap, and flags truncation. The client reaches it through `ApiClient.listDir(path, { flat })` and `fetchListing` in `App`, which carries the latest-wins `requestRef` guard, the pending/skeleton state, and the truncation notice. The header already hosts the path bar and the Flat toggle.

## Goals / Non-Goals

**Goals:**
- Typing narrows the current grid instantly with zero requests.
- An explicit deep search finds models by name anywhere under the current directory, with flat-listing ergonomics (file-name labels over relative-path names, shared thumbnails/camera, truncation, skeleton).
- Both modes work from nested and flat views, and inside zips.
- The grid is never ambiguous about what it is showing: search results read as results, and an empty grid says why it is empty.

**Non-Goals:**
- Fuzzy matching, globs, or content search — case-insensitive substring on the base name only.
- Search history, saved searches, or cross-root search.
- Recursive *directory* results in deep search — the walk's recursive payload is models; containers stay top-level.

## Decisions

### D1: Deep search is `listFlat` with a match predicate, not a new walker

`listFlat(vpath)` gains an optional `query`: after the walk, models are filtered by case-insensitive substring on their base name (`n.slice(n.lastIndexOf('/') + 1)`, the same basename the sort comparator uses) *before* the cap, so the cap bounds matches rather than raw walk output; top-level containers are filtered by the same predicate. Everything else — budget, visited set, zip descent, sort order, `truncated` — is untouched and shared. A blank or whitespace-only query is treated as absent (a plain flat listing), everywhere the parameter is interpreted. The endpoint stays `/api/dir`: `q` composes with `flat=true` (`flat=true&q=…` is a deep search); a non-blank `q` without `flat=true` is a 400, since plain-listing filtering is the client's job and silently ignoring the parameter would mask bugs. `ApiClient.listDir` builds that URL by concatenation (client/src/api/client.ts), so `q` — free-form user text, unlike the boolean `flat` — must go through `encodeURIComponent`; an unescaped `&` or `#` in a query would otherwise truncate it silently server-side. This carves an exception out of directory-browsing's "absence of the flat flag yields the nested listing" clause, so this change carries a `directory-browsing` MODIFIED delta alongside the new capability.

*Alternative — a separate `/api/search` walker:* duplicates the budget/visited/zip rules that took the flat-folder-view change several reviews to pin down; a predicate on the proven walk cannot drift from it.

### D2: The filter is client view state layered over `listing`

Two distinct pieces of state share the one input: `filter`, the live text, and `query`, the last *committed* deep search (set on submit, null otherwise). `filter` narrows the rendered entries (`entries.filter(e => e.name.toLowerCase().includes(q))` at render time) without touching `listing`, requests, or `useThumbnails`.

Keeping the filtered array out of `useThumbnails` is a hard constraint, not a nicety: its effect keys on `entries` and, on any change of that identity, *resets the whole thumb map* to `loading` and cancels the in-flight lookups (client/src/hooks/useThumbnails.ts, the `setThumbs(new Map(models.map(…)))` at the top of the effect). Passing it a filtered array — the obvious single-`useMemo` refactor — would therefore blank and re-fetch every tile on every keystroke. The filtered array reaches `Grid` and nothing else; `listing` (stable state identity) is what `useThumbnails` sees. It applies over whatever listing is showing, deep-search results included: after a submit, editing the text filters the results client-side and only another submit re-searches. Every tile kind is matched by its full `name` — in flat view a model's name is its relative path, so path fragments match too, even though the tile is *labeled* by file name alone (`baseName` in `Grid.tsx`, path in the tooltip). Matching the label instead would make a folder fragment stop matching in exactly the view that exists to search across folders. Emptying the input issues no request while no query is committed; with one committed, it clears both states and re-issues the ordinary listing (D3). Navigation clears both without an extra request — the navigation is the request. The truncation notice keeps describing the underlying listing, not the filtered view.

### D3: Deep search rides `fetchListing`; the query is part of the request, not the toggle

Submitting the search (Enter in the input, or its Deep button) calls the existing `fetchListing` path with `{ flat: true, q }` — targeted at the user's *newest requested* directory: the hoisted `dest = target ?? path` that flat-toggle-inflight-target establishes in `App` (its D4) and that the `↑` button, the flat toggle, and the path bar already read. A search submitted while a navigation is in flight therefore searches where the user is going, not where they came from. The request inherits the monotonic `requestRef` guard, the pending/skeleton reveal, and the error banner; the response renders as an ordinary listing so tiles, thumbnails, orbit handoff, and camera persistence need no changes. The committed query is App state shown in the input; clearing it re-issues the plain listing for the current path (nested or flat per the toggle), and navigating away drops it — deep search is a transient query view, not a mode that follows navigation. While deep results are shown the Flat toggle reflects its own state untouched; pressing it simply issues its ordinary request, which supersedes the search by latest-wins.

**Ordering dependency:** this change edits the same `fetchListing`/`toggleFlat` region of `App.tsx` as `flat-toggle-inflight-target`, and D3 reads the `dest` that change hoists. That change landed and was archived 2026-08-14 (its deltas are in the main specs), so `dest` is there to read — but re-read `App.tsx` against main before applying, since it landed after this design was written. Its component tests now mount through the shared `client/test/appHarness.tsx`; this change's client tests use the same harness rather than repeating the mocks.

### D4: Search results say they are search results, and an empty result says so

A deep search replaces the grid with entries from arbitrary depths while the path bar keeps naming the searched directory — nothing else on screen distinguishes "these are the matches for *bracket*" from "this is what that folder contains". The committed query is therefore surfaced next to the grid (the truncation notice's slot and register: a short line, not a modal), and clearing it is what returns to browsing. Two empty states get the same treatment, because a bare empty grid is indistinguishable from a bug: a deep search with no matches states that nothing matched, and a live filter that hides every tile states that the filter is hiding them (different sentence — the entries are still loaded, and erasing the input brings them straight back).

Deep results are flat-shaped whatever the flat toggle reads, since the search always requests `flat=true`. Rather than driving the toggle from the search (which would leave it lit over an ordinary listing after the query clears), the toggle keeps its own state, the search indicator explains why the grid looks flat, and pressing the toggle issues its ordinary request — superseding the search by latest-wins, exactly as any navigation does.

### D5: Search walks on its own, larger budget; a truncated empty search says so (added post-implementation)

Found in use: a search for a name deep in an 80-folder library returned empty with `truncated: true` — the shared 20k-step walk budget died in the alphabet before reaching the match, and the UI's "No models matched" claim was false. Two fixes, one concern. Server: when a non-blank query is present, `listFlat` budgets from `MODEL_BROWSER_SEARCH_BUDGET` (default 200k) instead of `MODEL_BROWSER_FLAT_BUDGET` (20k) — a browse must render everything it walks as tiles, so its budget bounds payload; a search discards non-matches and returns at most the cap, so its budget buys reach and can afford 10×, behind the existing skeleton. Client: an empty search response carrying `truncated` renders "ran out of budget — try a deeper folder" instead of "No models matched", and suppresses the generic omitted-notice (which would double-speak). A non-truncated empty search keeps the plain no-match sentence.

*Alternative — one bigger shared budget:* punishes the flat view, which would walk (and render) 10× the tiles. *Alternative — resumable/streaming search:* real fix for arbitrarily large libraries, real complexity; deferred until a 200k horizon proves too small.

**Known limit — an abandoned search still runs to completion.** Latest-wins is client-side only: `requestRef` discards the superseded *response*, but nothing cancels the walk, and `server/src` has no abort or timeout path at all. Submitting several searches in a row therefore stacks that many concurrent walks, each free to spend 200k steps of sequential `stat` calls — an amplification the 10× budget makes 10× worse, since the same pattern previously topped out at 20k apiece. The step budget bounds *work per request*, not time and not concurrent load. Accepted for a single-user localhost app, where the realistic worst case is a few impatient Enters against a warm page cache. The fix, if it ever bites, is to thread the request's `AbortSignal` down into `takeStep` so an abandoned search stops at its next step; that is new server behavior (cancellation semantics, and what a cancelled request returns), so it belongs in its own change with a spec delta rather than riding along here.

## Risks / Trade-offs

- [Two inputs in the header (path bar, search) compete for width] → the search input stays compact (fixed basis, grows on focus); cosmetic, tuned at apply.
- [A deep search on a huge tree is expensive] → bounded by the same step budget and cap as any flat listing; truncation is reported the same way.
- [Filter mode hides tiles while `truncated` math counts the full listing] → the notice already describes the response, not the view; accepted.
- [`truncated` on a search can mean "more matches than the cap" or "the budget died before the walk finished, matches may be missing entirely", and the notice wording ("some were omitted") does not distinguish them] → accepted as-is; the flag's recorded semantics ("any model was dropped, whether by the cap or by the budget") already conflate the two for flat listings.
- [`q` without `flat` becoming meaningful later] → reserved by the 400 today; loosening it is additive.
