# Design — listing-in-flight-feedback

## Context

Every listing request funnels through `fetchListing` in `App`, which stamps it with a monotonic `requestRef` so only the newest response may write state (added in flat-folder-view: a flat walk can take seconds while a nested listing is instant). Nothing, however, reflects the in-flight window itself: the previous grid stays rendered and clickable until the winning response lands. Nested listings on a warm disk resolve in milliseconds; flat walks and cold removable media take seconds.

## Goals / Non-Goals

**Goals:**
- A navigation that takes noticeable time visibly acknowledges the click, quickly.
- The common fast path never flickers.
- Stale tiles stop being clickable while a slower listing is being fetched.

**Non-Goals:**
- Progress reporting or cancellation UI for the walk itself — the request either lands or is superseded.
- Per-tile pressed/spinner states; the skeleton is a whole-grid treatment.
- Skeleton anywhere else (thumbnails already have per-tile loading states).

## Decisions

### D1: In-flight state is derived from the `requestRef` counter, cleared only by the newest request

`fetchListing` sets `pending` when it issues a request; the `.then`/`.catch` clear it only when `req === requestRef.current` — the same latest-wins comparison that guards the state writes. A superseded request therefore cannot clear (or re-set) the flag for its successor; toggling, retyping the path, or navigating again while one request drags simply moves the flag to the newest request. Success and failure clear it identically — an error lands in the existing `error` banner over the still-current grid.

### D2: The skeleton reveals only after a delay (~200 ms)

An immediate swap would flash a skeleton on every warm-disk navigation. `pending` feeds a small delayed-flag hook (`useDelayedFlag(pending, SKELETON_DELAY_MS)`): the skeleton renders only if the request is still unresolved after the delay, and hides the instant `pending` drops. 200 ms sits under the threshold where a click starts to feel ignored but above virtually every nested listing. The delay constant lives beside the hook; the component test overrides nothing — it drives a never-resolving `listDir` past the delay with real timers, the same way `flatToggle.test.tsx` drives its races.

### D3: The skeleton replaces the grid; the header stays live

While the skeleton shows, the grid (and the truncation notice) is not rendered — the old tiles are stale navigation targets, and leaving them clickable during a slow walk is exactly the double-click trap this change removes. The skeleton is a static grid of pulsing placeholder tiles (fixed count, same `aspect-square` cell as real tiles, Tailwind `animate-pulse`) — enough motion to read as "working" without a separate spinner element. The path bar, `↑`, and the Flat toggle remain interactive: retyping, going up, or toggling off mid-flight issues a newer request that takes over the flag (D1).

## Risks / Trade-offs

- [A borderline ~200 ms response flashes the skeleton for a frame] → accepted; the alternative (minimum-display time) adds artificial latency to real content.
- [The skeleton hides the previous grid the user might still want to glance at] → deliberate (D3); the path bar still shows where they are, and `↑`/retype/toggle remain available to bail out.
- [Fixed placeholder count may not match the incoming listing size] → cosmetic; the skeleton is an acknowledgment, not a prediction.
