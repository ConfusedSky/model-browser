# Tasks — file-name-search

## 1. Server

- [x] 1.1 `listFlat(vpath, query?)` in `server/src/listing.ts`: filter walked models by case-insensitive substring on base name before the cap; filter top-level containers by the same predicate; blank/whitespace query treated as absent (D1)
- [x] 1.2 `server/src/app.ts`: accept `q` on `/api/dir` with `flat=true`; 400 a non-blank `q` without the flat flag; blank `q` ignored either way
- [x] 1.3 Server tests: matches across depths and inside zips; deep search rooted in a zip and in a directory inside one; folder-name-only match excluded; case-insensitivity; cap applies to matches and sets `truncated`; budget truncation still reported; blank `q` = plain listing; non-blank `q` without `flat` rejected

## 2. Client

- [x] 2.1 `ApiClient.listDir` options gain `q` (interface *and* `HttpApiClient`), appended through `encodeURIComponent` — the URL is built by concatenation, so free-form text needs escaping; wire test in `apiClient.test.ts` uses a query containing `&` and a space so an unescaped regression fails (D1)
- [x] 2.2 Header search input in `client/src/App.tsx`: separate `filter` (live text, narrows rendered entries by their full `name` — the relative path in flat/deep views, not the shortened tile label — at render time, no requests) and `query` (committed on submit) states; typing over deep results filters them; both cleared on navigation (D2). The filtered array goes to `Grid` **only**: `useThumbnails` keeps receiving the unfiltered `listing`, since its effect resets the whole thumb map to `loading` on any `entries` identity change — a filtered array would blank and re-fetch every tile per keystroke
- [x] 2.3 Deep search: Enter (or the input's Deep affordance) commits the query and issues `fetchListing` with `{ flat: true, q }` at the newest requested target — the hoisted `dest = target ?? path` from flat-toggle-inflight-target (landed; re-read `App.tsx` against main first); clearing a committed query re-issues the ordinary listing per the flat toggle; navigation drops the query (D3)
- [x] 2.4 Search legibility (D4): while a query is committed the grid is labeled as results for it; a search with no matches states that nothing matched; a filter that hides every tile states that the filter is hiding them (distinct wording — the entries are still loaded); the flat toggle keeps its own state throughout
- [x] 2.5 Component tests on the shared `client/test/appHarness.tsx`: typing filters all tile kinds without new `listDir` calls and erasing restores; deep search request carries `q` and renders relative-path results with the truncation notice; editing text over results filters without a new request; clearing a committed query re-requests the plain listing; a search submitted mid-navigation targets the in-flight destination; a superseding navigation discards a late search response; thumbnails are not reset by typing (the thumb map survives a filter keystroke); both empty states and the results label render (2.4)

## 3. Verification

- [x] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 3.2 Manual E2E via Playwright MCP: filter narrows the fixture grid live (and its tiles' thumbnails do not reload as you type); deep search from the fixture root finds nested and zipped models by name; results are labeled as search results; a no-match query and an all-hiding filter each state why the grid is empty; skeleton shows on a slowed search; clearing restores browsing — *verified 2026-08-14: filter → [fat_cat.stl] with img srcs stable; deep search from the tasks root found the nested model, and from a library folder found matches inside `…Heroes.zip!/…` labeled by file name with relative-path tooltips; both empty states and the results label rendered; skeleton appeared under a 900ms-delayed walk; clearing restored the nested listing*

## 4. Search budget & truncated-empty honesty (D5, added post-implementation)

- [x] 4.1 `listFlat` budgets a queried walk from `MODEL_BROWSER_SEARCH_BUDGET` (default 200000) instead of `MODEL_BROWSER_FLAT_BUDGET`; server tests prove the separation (a browse that truncates at budget 2 while a search under the same env still finds the nested match) and that `MODEL_BROWSER_SEARCH_BUDGET` bounds the search walk
- [x] 4.2 A truncated empty search renders "ran out of budget — try a deeper folder" instead of "No models matched", suppressing the generic omitted-notice; component test pins the message choice
- [x] 4.3 Manual E2E: the search that surfaced this (`MechGunslinger` from the library root, previously a false empty) returns its matches — *verified 2026-08-17: 32 results in 0.85s from the root, walk completed (no truncation), loose files and their zip-entry twins both found, results label rendered*
