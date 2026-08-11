# Tasks — file-name-search

## 1. Server

- [ ] 1.1 `listFlat(vpath, query?)` in `server/src/listing.ts`: filter walked models by case-insensitive substring on base name before the cap; filter top-level containers by the same predicate (D1)
- [ ] 1.2 `server/src/app.ts`: accept `q` on `/api/dir` with `flat=true`; 400 a `q` without the flat flag
- [ ] 1.3 Server tests: matches across depths and inside zips; folder-name-only match excluded; case-insensitivity; cap applies to matches and sets `truncated`; budget truncation still reported; `q` without `flat` rejected

## 2. Client

- [ ] 2.1 `ApiClient.listDir` options gain `q`, encoded onto the request (with wire test)
- [ ] 2.2 Header search input in `client/src/App.tsx`: `filter` state narrowing rendered entries by displayed name at render time — no requests, thumbnails untouched, cleared on navigation (D2)
- [ ] 2.3 Deep search: Enter (or the input's Deep affordance) issues `fetchListing(path, …, { flat: true, q })` through the existing pending/latest-wins plumbing; clearing the query re-issues the ordinary listing per the flat toggle; navigation drops the query (D3)
- [ ] 2.4 Component tests beside `flatToggle.test.tsx`: typing filters all tile kinds without new `listDir` calls and erasing restores; deep search request carries `q` and renders relative-path results with the truncation notice; clearing re-requests the plain listing; a superseding navigation discards a late search response

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual E2E via Playwright MCP: filter narrows the fixture grid live; deep search from the fixture root finds nested and zipped models by name; skeleton shows on a slowed search; clearing restores browsing
