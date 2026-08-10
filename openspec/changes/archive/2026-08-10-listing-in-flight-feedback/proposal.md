# Listing In-Flight Feedback

## Why

A directory request in flight has no visible effect: the old grid stays on screen, fully interactive, until the response lands. On slow targets — a flat walk over a big collection, a cold read from removable media — a click on a folder tile looks like a dropped click for seconds, inviting repeat clicks on stale tiles.

## What Changes

- **Client**: `App` tracks whether the newest listing request (the one `requestRef` already designates) is still in flight. If it is still unresolved after a short reveal delay (~200 ms), the grid is replaced by a skeleton — a grid of pulsing placeholder tiles — until the response lands. Fast navigations resolve inside the delay and never flicker. The path bar, `↑`, and the Flat toggle stay interactive throughout; the stale grid's tiles do not (they are stale navigation targets). Success, failure, and supersession all clear the in-flight state via the existing latest-wins guard, so a stale response can neither strand nor dismiss the skeleton out of turn.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: ADDED requirement — in-flight listing feedback (delayed skeleton reveal, no flicker on fast responses, header controls stay live, latest-wins clearing).

## Impact

- `client/src/App.tsx` — in-flight state beside `requestRef`, delayed reveal, skeleton grid render branch. No server, API, or `Grid` changes.
- `client/test/` — component test alongside `flatToggle.test.tsx` (same module-mock harness): slow response shows the skeleton after the delay, fast response never shows it, skeleton clears on landing/failure/supersession.
