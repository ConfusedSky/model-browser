## Why

The library tab's reset count moves by hand on an orbit — unless the tile's own thumbnail
has not landed yet, in which case the count said nothing, deliberately: a loading tile
carries no framing and reading it as unframed once miscounted an orbit on a framed model.
After the caches were emptied on 2026-09-11 every tile was loading for a while, so Masa's
orbits stored framings the count did not move for until a job ended or the tab was
reopened. The fix landed as a point commit (caa00be) ahead of this record; the
`thumbnail-jobs` scenario it changes said re-derivation happens *only* on tab open or a
job's end, so this change is the spec's owner for that third moment.

## What Changes

- When a framing write's before-state cannot be judged in this session, the count is
  re-derived once after the write lands, instead of staying silent. A known before-state
  still moves the count by hand without a re-derivation.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `thumbnail-jobs`: *Jobs are launched with their cost stated, and watched from one chip*
  — the scenario *The count follows the user's own hand* admits the unjudgeable case.

## Impact

- Client: `App.tsx`'s `noteFramingChanged` (`recount()` on the two unknown paths) and the
  `jobsEnded` doc; two cells in `client/test/bulkJobSurfaces.test.tsx` — the orbit-direction
  regression test that was missing, and the loading-tile re-derivation.
- Already on main as caa00be; this change records and specifies it.
