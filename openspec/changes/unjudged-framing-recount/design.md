## Context

`noteFramingChanged` (client/src/App.tsx) computes the hand delta from the tile's thumbs-map
entry when its status is `ready`; a loading or errored tile carries no framing, so the
before-state is unknown and the function returned without moving anything (an earlier
review's finding: reading a loading tile as unframed miscounted an orbit on a framed
model). With an empty cache every tile is loading, so every early orbit went uncounted
until a job ended (`recountKey`) or the tab was reselected. Measured live 2026-09-11: on a
ready tile the count went 3 → 4 the instant the orbit released; the cells for the orbit
direction did not exist.

## Goals / Non-Goals

**Goals:** an orbit never goes uncounted; a known before-state still counts by hand.
**Non-Goals:** the writes-off case (`web-demo-backlog` 1.10), where the server's count is
not this browser's.

## Decisions

### D1: Ask the server when the before-state is unknown

The two silent exits in `noteFramingChanged` — no ready thumb entry, and an axis-only state
this session cannot judge — call `recount()` (`setJobsEnded(n => n + 1)`, the same key a
job's end moves), after the caller's PUT has landed so the re-derivation reads the write.
The hand path is byte-unchanged for a known before-state, since a re-derivation is what it
exists to avoid. No storm: `noteFramingChanged` is unreachable from a pixels-only persist
(App guards it on `opts.camera !== false`), bursts coalesce in one state update, and the
panel's effect returns early unless the library tab is open.

*(2026-09-11, later: `pose-rerender` D7 makes `resettable` read the camera and axis alone, so
the axis-only exit no longer exists — the pose no longer decides whether a stored axis
counts — and its D4/D6 remove `persist`'s `camera: false` option, so the "unreachable from
a pixels-only persist" sentence holds vacuously: every persist now writes a camera. The
not-landed exit and its recount are unchanged; the scenario in the delta names only that
case and stays true. Either change archives first.)*

## Risks / Trade-offs

- [One `/api/models` re-derivation per orbit on a not-yet-landed tile] → bounded by how
  many tiles a user orbits before they land; each is one listing read.
