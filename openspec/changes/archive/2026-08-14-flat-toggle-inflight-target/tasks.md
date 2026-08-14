# Tasks — flat-toggle-inflight-target

## 1. Client

- [x] 1.1 `target` state in `client/src/App.tsx`: set to the requested target in `fetchListing` beside the `requestRef` bump; reset to `null` in the `.catch` only when `req === requestRef.current` (D1)
- [x] 1.2 `toggleFlat` re-requests the hoisted `dest = target ?? path` (guarding the empty-path case on the same value), leaving the existing `onFail` flat-state revert untouched (D2)
- [x] 1.3 `goUp` derives its parent from `dest` (D3), zip-boundary logic unchanged, so repeated `↑` presses during a slow listing ascend the ancestry
- [x] 1.4 Show `dest` in the header (D4): pass it as `PathBar`'s `path` prop and key the `↑` button's disabled predicate off it, so the bar moves the moment a navigation is requested and the control never deadens against the committed path; 1.1's failure reset reverts both beside the error *(the target started as a ref in 1.1 and was promoted to state here — a ref write cannot re-render the bar)*

## 2. Tests

- [x] 2.1 Component test beside `flatToggle.test.tsx` (same `HttpApiClient` module-mock harness): untoggling flat while an `↑` navigation is in flight requests the navigation's destination and lands there nested; toggling after the newest navigation failed re-requests the committed path; a quiet toggle (nothing in flight) still requests the committed path
- [x] 2.2 Test for D3: pressing `↑` twice during a slow listing requests the grandparent and lands there; the superseded first `↑` response is discarded *(verified to fail pre-fix on the user-visible symptom: still showing the origin's listing)*
- [x] 2.3 Tests for D4: the path input updates immediately on each `↑` while the listing is pending (asserted inside the grandparent test) and reverts to the committed path when the navigation fails
- [x] 2.4 Extract the shared App-mount harness `client/test/appHarness.tsx` (api/renderer module-mock factories, mount/unmount lifecycle, query helpers) and fold `flatToggle.test.tsx`, `listingSkeleton.test.tsx`, and `flatToggleInFlightTarget.test.tsx` onto it — `vi.mock` stays per-file (it is hoisted) but resolves through the harness so all files share one `listDir`

## 3. Verification

- [x] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 3.2 Manual via Playwright MCP against the dev instance: flat on, `↑` with a slowed listing, untoggle mid-flight — the nested parent renders, not the origin directory *(verified 2026-08-14: delayed /api/dir 1500ms in-page, ↑ from e2e-models, untoggled 300ms in — landed at `…/sdd/tasks` nested with its dir tiles, flat off. D3 likewise: two rapid ↑ presses under a 1200ms delay landed at the grandparent `…/sdd`, not `…/sdd/tasks` twice. D4: the path bar read the parent 50ms after the first press and the grandparent 50ms after the second, both while the listings were still in flight)*
