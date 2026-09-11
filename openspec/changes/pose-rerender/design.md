## Context

Two findings from Masa's live test on 2026-09-11, each reproduced in a cell that fails on
main and confirmed against the dev instance by the investigating worker:

1. **The index becoming ready does not reach a landed listing — a finding, not the bug.**
   `App`'s listing-wave effect has deps `[waveId, wavePaths, libraryReady, api, dispatch]`
   and availability is re-read on mount, on a path change, and on a 2 s timer only while
   the index is `warming`; an index started after the page landed is seen on the next
   navigation, not before. Live: index killed, page landed, index restarted, the server
   read `ready` 20 s later, and through 80 s nothing re-asked. Masa's call (2026-09-11):
   **no polling** — a navigation is the trigger, and his tiles had not updated *even on a
   navigation*, so this was not what he hit. The mechanism stays as it is.

2. **A render made under one pose is never stale under another.** `usable`'s pose test
   (`useThumbnails`) is `pose !== undefined && camera === undefined && axis === undefined
   && labels.posed !== POSE_VERSION`: the label is the mapping recipe's version, not the
   pose. `samePose` retires the slot and re-looks-up when the pose changes by value, but
   the hit then passes `usable`. Cell: a hit labelled `posed: 2` rendered under pose A
   (front az 225°), a second landing whose wave says pose B (az 45°): two waves, zero
   renders. On this machine the index's poses have not changed since the renders were
   made as far as the cache can tell — but a re-classification is the index's normal
   life, nothing would show it, and a render that never updates even on a navigation is
   exactly what this hole produces. The server side cannot pin it: the pose layer
   (`server/src/layers.ts`) ages every recorded pose out after `POSE_ANNOTATION_TTL_MS`
   (5 min) and the next listing's fill re-asks the index, so a changed opinion reaches the
   client's wave on the next navigation after that; what was missing is the client's
   ability to see that the picture it holds was drawn under a different one.

Not a hole: a pose carried at emission, or arriving by wave, over a hit labelled without
`posed` — the reload case — re-renders (three passing cells), which is the mechanism
`pose-for-every-model` built.

## Goals / Non-Goals

**Goals:**
- A posed render records what it was drawn under, so a changed opinion is detectable and
  re-rendered on the next visit after the server re-asks.
- The posed renders already on disk, which carry no key, are re-rendered once — lazily,
  on their next visit — since a changed opinion is what Masa's stale tiles were.

**Non-Goals:**
- Any polling for the index becoming ready, or any readiness input to the pose waves
  (Masa, 2026-09-11): a navigation is the trigger, and the server's 5-minute pose TTL is
  the convergence bound.
- Any change to the pose itself, its derivation, or the server's pose layer.

## Decisions

### D1: No polling — a navigation is the trigger

Considered and rejected: the index's readiness as an input of the wave effects plus a
10 s availability read while absent. Masa: "I don't want it to poll to see if the index
is ready." The pose waves stay keyed on the landing; the availability read stays on
mount, on a path change and while warming. A user who starts the index after landing
navigates once.

### D2: A pose key beside the mapping version, compared only when present

A new optional label `poseKey?: string` on the wire (`ThumbRenderInfo`,
`ThumbGetResponse`, `ThumbPutRequest`) and on the client's `ThumbSave`/`ThumbResult`,
stored and echoed by `cache.ts` like `posed` and included in the sibling-render
comparison, passed through by the PUT route (a non-string is a 400, the `rig` shape). Its
value is what the pixels depended on and nothing else: `poseKeyOf` =
`${axis}:${az.toFixed(4)}:${el.toFixed(4)}` from `cameraForPose`'s answer — `source` and
`confidence` are excluded because they do not touch pixels, and the raw
`up`/`azimuth_zero`/`front` because two poses that derive the same camera should not
re-render. `usable` adds `labels.poseKey !== undefined && labels.poseKey !==
poseKeyFor(pose)` to `poseStale`, and both posed writers — the sweep's render and
`entryActions`' re-render/reset command — send the key. Compared only when present, so a
keyless render is judged on the mapping version alone; that is what keeps
`thumbnailQueue`'s "changed by value … keeping its image" cell true, and it is why D3 is
needed for the renders already on disk.

### D3: `POSE_VERSION` 2 → 3 re-renders the keyless posed renders once

The 92 posed sidecars on this machine carry `posed: 2` and no key. Under D2 alone they
stay hits whatever the index now says — the very failure reported. The recorded mechanism
for "the posed recipe changed" is the version: a `posed: 2` render is not current under
version 3, so each is re-rendered once, lazily on its next visit, through the normal
queue with camera and axis preserved, and every render from then on carries its key.
Cost: one render pass over posed thumbnails per listing visited; on the demo the tiles
render locally anyway. Chosen over "treat a missing key as stale", which would be the
same sweep expressed as a second rule beside the version and would have broken the two
by-value cells that pin "an unchanged opinion issues nothing".

## Risks / Trade-offs

- [A pose whose derived camera differs in the fifth decimal re-renders] → `toFixed(4)`
  rounds below what a 256² render can show; a real re-classification moves degrees.
- [Every posed thumbnail re-renders once after the bump] → lazily, per listing visited,
  through the queue that already paces renders; the pixels are the same where the opinion
  is unchanged, so nothing visible flickers — each image is kept until its replacement.
- [A changed opinion takes up to five minutes plus a navigation to show] → the server's
  pose TTL, the recorded convergence bound; a library reload drops the layer at once.

## Migration Plan

None for data: the label is optional, and the version bump does the one sweep that is
wanted, lazily. Nothing is run by hand.

## Open Questions

- None. Masa rejected polling on 2026-09-11; the compare-when-present rule and the
  version bump were the coordinator's calls the same day.
