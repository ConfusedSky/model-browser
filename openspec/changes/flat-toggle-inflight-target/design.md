# Design — flat-toggle-inflight-target

## Context

Every listing request funnels through `fetchListing` in `App` (client/src/App.tsx), stamped by the monotonic `requestRef` so only the newest response writes state. The committed `path` state updates only in a request's `.then`. `toggleFlat` re-requests `path` — so while a navigation is in flight, it re-requests the directory the user just left, and as the newer request it (correctly) supersedes the navigation. Reproduced: flat on in `/models/a`, `↑` to `/models` still loading, untoggle → lands back in `/models/a` nested.

## Goals / Non-Goals

**Goals:**
- Toggling flat mid-navigation keeps the user headed where they asked to go.
- No behavior change when nothing is in flight.

**Non-Goals:**
- Request cancellation or queuing — latest-wins stays as is.
- Path-bar display changes; the input still reflects the committed path until a response lands.

## Decisions

### D1: A target ref records the newest *requested* path; failure resets it

`fetchListing` writes `targetRef.current = target` when it issues a request — beside the `requestRef` bump, so the ref always names the newest request's destination. When the newest request fails, the `.catch` sets `targetRef.current = null`: the target never materialized, the user is looking at the committed listing, and later actions should relate to that. A superseded request's `.catch` is already guarded by the `req === requestRef.current` comparison and cannot reset the ref for its successor.

### D2: `toggleFlat` re-requests `targetRef.current ?? path`

The toggle's job is "same place, other view" — and "place" is the newest place the user asked for, in flight or committed. With nothing in flight (or after a failure) the fallback `path` is exactly today's behavior, so the quiet path is unchanged. The existing `onFail` revert (toggle returns to its prior state on error) is untouched.

## Risks / Trade-offs

- [The toggle's re-request can itself fail for an in-flight target that would have succeeded] → the existing failure path already covers this: error surfaces over the committed grid, toggle reverts, `targetRef` resets to the fallback.
- [A ref duplicates information derivable from request bookkeeping] → accepted; a single nullable ref written at the two spots that already touch `requestRef` is the minimal fix and keeps latest-wins untouched.
