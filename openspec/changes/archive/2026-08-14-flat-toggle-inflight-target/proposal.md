# Flat Toggle Follows In-Flight Navigation

## Why

Toggling the flat view re-requests the last *committed* path, but a navigation's target only commits when its response lands. Toggling while a navigation is still in flight — flat on, click `↑`, untoggle while the slow walk runs — therefore issues a newer request for the directory the user just left, and the latest-wins guard (correctly) lets it supersede the navigation. The user is yanked back to where they started. Reproduced end-to-end via Playwright against the dev instance.

## What Changes

- **Client**: `App` tracks the newest *requested* navigation target alongside the existing `requestRef` counter. `toggleFlat` re-requests that target — the path the user most recently asked for — instead of the last committed `path`. When the newest request has failed, the toggle falls back to the committed path (the listing actually on screen). No behavior change when nothing is in flight: the newest requested target then equals the committed path.
- **Client**: `goUp` derives the parent from the same newest-requested target — the same defect class: pressing `↑` twice during a slow listing previously re-requested the same parent instead of ascending to the grandparent.
- **Client**: the path bar shows the newest requested target immediately (the target becomes state, passed as `PathBar`'s `path` prop), reverting to the committed path on failure — without this the grandparent behavior is invisible until the walk lands.
- **Tests**: the App-mount component-test boilerplate repeated across `flatToggle.test.tsx`, `listingSkeleton.test.tsx`, and the new test file (module mocks, mount/unmount lifecycle, query helpers) is extracted into a shared `client/test/appHarness.tsx`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: MODIFIED requirement — the flat view toggle re-requests the user's newest navigation target (in flight or committed), never an older committed path.
- `directory-browsing`: MODIFIED requirement — thumbnail grid navigation: navigating to the parent derives it from the newest navigation target, so repeated `↑` presses during a slow listing ascend the ancestry.
- `directory-browsing`: MODIFIED requirement — editable path bar: the input reflects the newest requested target as soon as it is requested, reverting to the committed path on failure.

## Impact

- `client/src/App.tsx` — target state written in `fetchListing`, consumed as one hoisted `dest = target ?? path` by `toggleFlat`, `goUp`, the `↑` button's disabled predicate, and the path bar; failure handling resets it to the committed path. No server, API, or PathBar changes.
- `client/test/` — new `appHarness.tsx` (shared App-mount harness) and component tests alongside `flatToggle.test.tsx`: untoggling mid-flight lands in the in-flight target, not the origin directory; toggling after a failed navigation still re-requests the committed path; `↑↑` during a slow listing reaches the grandparent. `flatToggle.test.tsx` and `listingSkeleton.test.tsx` are folded onto the harness.
