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
  always — a posed render that carries none is stale, as one missing its lighting or rig
  label is; the server stores and echoes it like the other labels and includes it in the
  sibling-render comparison.
- The missing key is the one sweep: every posed render already on disk — keyless, and so
  unable to say what it was drawn under — is re-rendered once, lazily on its next visit,
  and carries its key from then on. `POSE_VERSION` stays 2 (a bump to 3 was tried and
  reverted the same day; the mapping did not change).
- No polling for the index (Masa): a navigation remains the trigger, and the server's
  five-minute pose memo is the bound on how long a changed opinion takes to reach it.
  The first finding above stands as a finding only.

- Added 2026-09-11 after the second live test: closing the lightbox without having
  orbited or zoomed writes nothing — no camera, no thumbnail — where before it stored
  whatever camera the lightbox opened at, which with the index down was the default, and
  a stored camera then withheld the pose forever. And a thumbnail drawn under a pose is
  re-rendered at the default framing when the source is settled to hold none for the
  model (the index answered none, or is known to be absent), so the tile shows what the
  lightbox will open at; while nobody knows yet (the index warming, the ask unanswered)
  the render stands. The wave's answer carries `null` for the paths it settled as none,
  the shape the listing already uses.

Out of scope: any change to what a pose is, how the index derives it, or the server's
pose layer beyond the wave route's answer shape.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-thumbnails`: MODIFIED *Recipe-labelled thumbnails* — a posed render records the
  orientation it was drawn under; a labelled render whose orientation the source has
  since changed needs re-render; a render labelled before the key existed is stale and
  re-rendered once, gaining its key; a render drawn under an orientation the source is
  settled to no longer hold is re-rendered at the default framing.
- `model-viewer`: MODIFIED *Lightbox expanded view* — a close persists only after the
  user manipulated the view; an untouched close writes nothing.

## Impact

- Client: `viewer/ViewerLayer.tsx` (`closeLightbox`), `App.tsx` (`persist` loses its
  `posed` option; `carriedPoses` files `null`; the wave files every answer), `state/reducer.ts`
  and the pose map's type (`IndexPose | null`), `hooks/useThumbnails.ts` (`usable`'s pose test, the render PUT's labels),
  `lib/entryActions.ts` (the re-render command's PUT and `isCurrentRender`),
  `three/pose.ts` (`poseKeyOf`; `POSE_VERSION` stays 2), `api/client.ts` (the two client
  types).
- Shared: `ThumbRenderInfo`, `ThumbGetResponse`, `ThumbPutRequest` gain `poseKey?: string`.
- Server: `cache.ts` (`RenderLabels`, `renderLabels`, `hasLabels`, `renderInfo`, `put`'s
  label carry-over, the sibling-invalidation compare), `app.ts` (PUT passthrough; the
  `POST /api/semantic/poses` answer carries `null` for settled negatives).
- Tests: `client/test/poseRerender.test.tsx` (new; the reproducing cells go green),
  `thumbnailQueue.test.tsx` (its two by-value cells' posed fixtures carry the key, since
  a keyless posed hit is now stale), server cache cells for the label.
- Data: the 92 posed sidecars on this machine carry `posed: 2` and no key; each re-renders
  once on its next visit because the key is missing, and gains one.
