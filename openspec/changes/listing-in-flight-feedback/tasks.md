# Tasks — listing-in-flight-feedback

## 1. Client

- [ ] 1.1 `pending` state in `client/src/App.tsx`, set in `fetchListing` when a request issues and cleared in `.then`/`.catch` only when `req === requestRef.current` — supersession moves it to the newer request, never clears it early (D1)
- [ ] 1.2 Delayed-flag hook (`useDelayedFlag(pending, SKELETON_DELAY_MS = 200)`): true only once `pending` has held for the delay, false the moment `pending` drops; timer cleaned up on change/unmount (D2)
- [ ] 1.3 Skeleton render branch replacing `Grid` (and the truncation notice) while revealed: fixed count of `aspect-square` `animate-pulse` placeholder tiles matching the grid's cell layout; header (path bar, `↑`, Flat toggle) untouched and interactive (D3)

## 2. Tests

- [ ] 2.1 Component test beside `flatToggle.test.tsx` (same `HttpApiClient` module-mock harness, real timers): a never-resolving `listDir` shows the skeleton after the delay and the old tiles are gone; a fast-resolving `listDir` never shows it; a second navigation while pending wins and clears it; a rejected request clears it and shows the error with the prior grid restored

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual via Playwright MCP against the dev instance: navigate into a large flat listing — skeleton appears then fills; warm nested navigation shows no flicker
