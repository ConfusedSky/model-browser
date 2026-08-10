# Tasks — flat-toggle-inflight-target

## 1. Client

- [ ] 1.1 `targetRef` in `client/src/App.tsx`: set to the requested target in `fetchListing` beside the `requestRef` bump; reset to `null` in the `.catch` only when `req === requestRef.current` (D1)
- [ ] 1.2 `toggleFlat` re-requests `targetRef.current ?? path` (guarding the empty-path case on the same value), leaving the existing `onFail` flat-state revert untouched (D2)

## 2. Tests

- [ ] 2.1 Component test beside `flatToggle.test.tsx` (same `HttpApiClient` module-mock harness): untoggling flat while an `↑` navigation is in flight requests the navigation's destination and lands there nested; toggling after the newest navigation failed re-requests the committed path; a quiet toggle (nothing in flight) still requests the committed path

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual via Playwright MCP against the dev instance: flat on, `↑` with a slowed listing, untoggle mid-flight — the nested parent renders, not the origin directory
