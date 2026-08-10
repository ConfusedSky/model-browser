# Flat Toggle Follows In-Flight Navigation

## Why

Toggling the flat view re-requests the last *committed* path, but a navigation's target only commits when its response lands. Toggling while a navigation is still in flight — flat on, click `↑`, untoggle while the slow walk runs — therefore issues a newer request for the directory the user just left, and the latest-wins guard (correctly) lets it supersede the navigation. The user is yanked back to where they started. Reproduced end-to-end via Playwright against the dev instance.

## What Changes

- **Client**: `App` tracks the newest *requested* navigation target alongside the existing `requestRef` counter. `toggleFlat` re-requests that target — the path the user most recently asked for — instead of the last committed `path`. When the newest request has failed, the toggle falls back to the committed path (the listing actually on screen). No behavior change when nothing is in flight: the newest requested target then equals the committed path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: MODIFIED requirement — the flat view toggle re-requests the user's newest navigation target (in flight or committed), never an older committed path.

## Impact

- `client/src/App.tsx` — a target ref written in `fetchListing`, read in `toggleFlat`; failure handling resets it to the committed path. No server, API, or component changes.
- `client/test/` — component test alongside `flatToggle.test.tsx`: untoggling mid-flight lands in the in-flight target, not the origin directory; toggling after a failed navigation still re-requests the committed path.
