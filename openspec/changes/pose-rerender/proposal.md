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

- A render made under a pose records the pose it was drawn under, as a key of what the
  pixels depended on — the spindle and the front angles `cameraForPose` derived — in a new
  optional label `poseKey` beside `posed`. The client's staleness test compares the key
  when the render carries one; the server stores and echoes it like the other labels and
  includes it in the sibling-render comparison.
- `POSE_VERSION` goes 2 → 3, so every posed render already on disk — keyless, and so
  unable to say what it was drawn under — is re-rendered once, lazily on its next visit,
  and carries its key from then on.
- No polling for the index (Masa): a navigation remains the trigger, and the server's
  five-minute pose memo is the bound on how long a changed opinion takes to reach it.
  The first finding above stands as a finding only.

Out of scope: any change to what a pose is, how the index derives it, or the server's
pose layer.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-thumbnails`: MODIFIED *Recipe-labelled thumbnails* — a posed render records the
  orientation it was drawn under; a labelled render whose orientation the source has
  since changed needs re-render; a render labelled before the key existed is compared on
  the mapping version alone.

## Impact

- Client: `hooks/useThumbnails.ts` (`usable`'s pose test, the render PUT's labels),
  `lib/entryActions.ts` (the re-render command's PUT and `isCurrentRender`),
  `three/pose.ts` (`poseKeyOf`, `POSE_VERSION` 3), `api/client.ts` (the two client types).
- Shared: `ThumbRenderInfo`, `ThumbGetResponse`, `ThumbPutRequest` gain `poseKey?: string`.
- Server: `cache.ts` (`RenderLabels`, `renderLabels`, `hasLabels`, `renderInfo`, `put`'s
  label carry-over, the sibling-invalidation compare), `app.ts` (PUT passthrough).
- Tests: `client/test/poseRerender.test.tsx` (new; the reproducing cells go green),
  `thumbnailQueue.test.tsx` (its "changed by value" cell stays green by the
  compare-when-present rule), server cache cells for the label.
- Data: the 92 posed sidecars on this machine carry `posed: 2` and no key; each re-renders
  once on its next visit under version 3 and gains a key.
