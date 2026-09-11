## Why

A thumbnail drawn without the index's orientation is supposed to be re-rendered once the
index has one for that model, and a thumbnail drawn under one orientation is supposed to
follow the index when its opinion changes. Neither holds today, measured live on
2026-09-11 (Masa's report, reproduced in cells and on the dev instance): a listing landed
while the index was absent got no poses, and when the index came up twenty seconds later
nothing re-asked — the client reads the index's availability once per landing and polls it
only while it is *warming*, and the pose wave is keyed on the landing, not on the index
becoming ready. Separately, a render made under a pose carries only the pose *mapping's*
version (`posed: 2`), not the pose itself, so a model the index later re-classifies keeps
its old picture forever: the staleness test has nothing to compare.

## What Changes

- The pose wave re-asks when the index becomes ready under a landed listing: the wave
  effects take the index's readiness as an input, and the preview wave's "already asked"
  set is cleared on that edge. An absent index is noticed while the tab stays open: the
  availability read repeats every 10 s while the index is absent (the server's own absent
  TTL; it answers from its probe cache), beside the existing 2 s poll while warming.
- A render made under a pose records the pose it was drawn under, as a key of what the
  pixels depended on — the spindle and the front angles `cameraForPose` derived — in a new
  optional label `poseKey` beside `posed`. The client's staleness test compares the key
  when the render carries one; a render without a key is judged on the mapping version
  alone, so the renders labelled before this change are not swept. The server stores and
  echoes the label like the others and includes it in the sibling-render comparison.

Out of scope: any change to what a pose is, how the index derives it, or `POSE_VERSION`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `semantic-search`: ADDED *The index becoming ready reaches a landed listing* — a listing
  on screen when the index turns ready is asked for its poses once, and an absent index
  is re-read at a slow cadence.
- `model-thumbnails`: MODIFIED *Recipe-labelled thumbnails* — a posed render records the
  orientation it was drawn under; a labelled render whose orientation the source has
  since changed needs re-render; a render labelled before the key existed is compared on
  the mapping version alone.

## Impact

- Client: `App.tsx` (the listing and preview wave effects' deps, the availability read's
  cadence), `hooks/useThumbnails.ts` (`usable`'s pose test, the render PUT's labels),
  `three/pose.ts` (`poseKeyOf`).
- Shared: `ThumbSave`, `ThumbRenderInfo`, `ThumbResult` gain `poseKey?: string`.
- Server: `cache.ts` (`RenderLabels`, `renderLabels`, `hasLabels`, `renderInfo`, `put`'s
  label carry-over, the sibling-invalidation compare), `app.ts` (PUT passthrough).
- Tests: `client/test/poseRerender.test.tsx` (new; the reproducing cells go green),
  `thumbnailQueue.test.tsx` (its "changed by value" cell stays green by the
  compare-when-present rule), server cache cells for the label.
- Data: the 92 posed sidecars on this machine carry no `poseKey` and are left alone.
