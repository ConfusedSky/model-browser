# Design — flat-toggle-inflight-target

## Context

Every listing request funnels through `fetchListing` in `App` (client/src/App.tsx), stamped by the monotonic `requestRef` so only the newest response writes state. The committed `path` state updates only in a request's `.then`. `toggleFlat` re-requests `path` — so while a navigation is in flight, it re-requests the directory the user just left, and as the newer request it (correctly) supersedes the navigation. Reproduced: flat on in `/models/a`, `↑` to `/models` still loading, untoggle → lands back in `/models/a` nested.

## Goals / Non-Goals

**Goals:**
- Toggling flat mid-navigation keeps the user headed where they asked to go.
- No behavior change when nothing is in flight.

**Goals (added in review):**
- Repeated `↑` presses during a slow listing ascend the ancestry.
- The path bar shows the newest requested target immediately, so mid-flight navigation reads as movement.

**Non-Goals:**
- Request cancellation or queuing — latest-wins stays as is.

## Decisions

### D1: Target state records the newest *requested* path; failure resets it

`fetchListing` writes `setTarget(target)` when it issues a request — beside the `requestRef` bump, so the value always names the newest request's destination. When the newest request fails, the `.catch` sets it back to `null`: the target never materialized, the user is looking at the committed listing, and later actions should relate to that. A superseded request's `.catch` is already guarded by the `req === requestRef.current` comparison and cannot reset the target for its successor. (Originally a ref; promoted to state by D4 so the path bar re-renders with it — the two writes sit beside `setPending` calls either way.)

### D2: `toggleFlat` re-requests `target ?? path`

The toggle's job is "same place, other view" — and "place" is the newest place the user asked for, in flight or committed. With nothing in flight (or after a failure) the fallback `path` is exactly today's behavior, so the quiet path is unchanged. The existing `onFail` revert (toggle returns to its prior state on error) is untouched.

### D3: `goUp` ascends from the newest requested target

Same defect class as the toggle, one more consumer: deriving the parent from the committed `path` makes a second `↑` during a slow listing re-request the same parent instead of the grandparent. `goUp` now starts from `target ?? path`; the zip-boundary logic (`!/` handling) is unchanged, merely operating on that string. The failure semantics come along for free from D1: after a failed navigation the target is null, so `↑` ascends from the listing actually on screen.

### D4: The path bar displays `target ?? path`

Without this, D3 is invisible: the second `↑` requests the grandparent, but the bar sits on the committed path until the walk lands, so consecutive presses read as a no-op. The target becomes `useState` (a ref write doesn't re-render — and can't be papered over by the adjacent `setPending(true)`, which React bails out on when already pending) and `App` passes `target ?? path` as `PathBar`'s `path` prop. `PathBar` already syncs its input from that prop only while the user isn't editing, so optimistic display costs no new logic there; on failure D1's reset makes the bar snap back to the committed path beside the surfaced error. The committed `path` state keeps its meaning everywhere else (recents, thumbnails, listing identity) — only the header display is optimistic. All header consumers read one hoisted `dest = target ?? path` — including the `↑` button's disabled predicate, which on the committed path alone deadens at the wrong moments (enabled but inert once `↑↑` reaches the root; disabled while a descent from the root is still in flight).

Noted limit of state over a ref: `goUp`/`toggleFlat` read `dest` from the render closure. Discrete clicks flush state between handlers, so `↑↑` works; two navigations issued within a single task (programmatic, or a future key-repeat `↑` shortcut) would see a stale target where a ref would not. If such a caller lands, thread the destination explicitly rather than reverting to a ref.

## Risks / Trade-offs

- [The toggle's re-request can itself fail for an in-flight target that would have succeeded] → the existing failure path already covers this: error surfaces over the committed grid, toggle reverts, the target resets to the fallback.
- [The target state duplicates information derivable from request bookkeeping] → accepted; a single nullable value written at the two spots that already touch `requestRef` is the minimal fix and keeps latest-wins untouched.
- [An optimistic path bar can briefly show a directory that turns out not to exist] → accepted; that is what "requested" means, and the failure path reverts the bar next to the surfaced error — the same moment the user learns the navigation failed.
