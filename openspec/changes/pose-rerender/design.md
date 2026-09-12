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

3. **Second live test, 2026-09-11 (after D2 landed): a camera nobody chose.** Masa reset
   every framing, stopped the index, restarted the server, loaded the root and opened one
   model. The tile showed its posed render (a front view); the lightbox opened at the
   default three-quarter view, because the viewer takes its pose from the wave and the
   wave had none; and closing the lightbox untouched **stored the default camera** and
   re-rendered the tile under it. With the index back, the next load re-rendered nothing:
   a stored camera wins over the pose (*Recipe-labelled thumbnails*: "a model the user
   has oriented is a hit whatever the source holds"). Reproduced headless: pointer-up on
   the tile at 4.5 s, lightbox open at 9.8 s, Escape at 9.8 s, `PUT /api/thumb` at
   11.0 s carrying `camera {az 0.785, el 0.524, distR 2.4}` — `DEFAULT_CAMERA` — and
   `axis z`. The writer is `closeLightbox` (`ViewerLayer`): `decided = everManipulated ||
   !unowned`, and `unowned` is only "opened from a pose" or "framing discarded", so with
   no pose in hand an untouched close records a decision the user never made. The sidecars
   Masa reset at 17:48:56 were the five models he had opened. Two rules change (D4, D5)
   and one writer is corrected (D6).

## Goals / Non-Goals

**Goals:**
- A posed render records what it was drawn under, so a changed opinion is detectable and
  re-rendered on the next visit after the server re-asks.
- The posed renders already on disk, which carry no key, are re-rendered once — lazily,
  on their next visit, because the missing key itself is stale — since a changed opinion
  is what Masa's stale tiles were.

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

### D2: A pose key beside the mapping version, compared always: an absent key is stale, the other labels' rule

A new optional label `poseKey?: string` on the wire (`ThumbRenderInfo`,
`ThumbGetResponse`, `ThumbPutRequest`) and on the client's `ThumbSave`/`ThumbResult`,
stored and echoed by `cache.ts` like `posed` and included in the sibling-render
comparison, passed through by the PUT route (a non-string is a 400, the `rig` shape). Its
value is what the pixels depended on and nothing else: `poseKeyOf` =
`${axis}:${az.toFixed(4)}:${el.toFixed(4)}` from `cameraForPose`'s answer — `source` and
`confidence` are excluded because they do not touch pixels, and the raw
`up`/`azimuth_zero`/`front` because two poses that derive the same camera should not
re-render. `usable` adds `labels.poseKey !== poseKeyFor(pose)` to `poseStale`, and both posed
writers — the sweep's render and `entryActions`' re-render/reset command (whose
`isCurrentRender` delegates to `usable`) — send the key. Compared always: an absent key
is not equal to the key, so a posed render that carries none is stale, exactly as a hit
missing its lighting or rig label is (*Recipe-labelled thumbnails*: "including entries
where either value is absent"). Masa, 2026-09-11: "Wouldn't it be better to rerender if
the key doesn't exist instead of ignoring it. I don't like the compare when present
rule." So the renders already on disk are re-rendered once, lazily, on their next visit,
and the version needs no bump. The by-value cells in `thumbnailQueue` and the other
fixtures that meant "already drawn at this pose" now carry the key, since a keyless
posed hit means the opposite.

### D4: An untouched lightbox close writes nothing

`model-viewer`'s "Esc or clicking outside SHALL close it, persisting camera state and
thumbnail like an orbit release" predates poses; the one carve-out since
(`pose-for-every-model`: opened from a pose and never touched → pixels only) left every
other untouched close storing whatever camera the lightbox happened to open at. Masa,
2026-09-11: "An untouched close should not store a camera." The rule becomes: a close
persists — camera, axis and thumbnail, like an orbit release — only after the user
manipulated the view (`ViewerSession.everManipulated`: an orbit or a zoom); a close that
follows no manipulation writes nothing at all, neither camera nor pixels. Nothing is lost
by writing no pixels: the view an untouched lightbox shows is either the tile's own
framing (a stored camera, or the pose in hand — the same picture) or the default (no pose
in hand), and D5 makes the tile follow that case through the grid's own queue. The axis
control keeps its immediate persist (`changeAxis` → `onPersist`), which is a decision by
itself and is unchanged. The reset-from-panel path keeps its guarantee for free: a reset
clears `everManipulated`, so a close after it writes nothing, which is what "SHALL NOT
have that discarded orientation written back" always meant. `openedFromPoseRef` and the
`posed` option of `App.tsx`'s `persist` lose their only reader (D6).

### D5: No pose in hand is a pose state — the thumbnail shows what the lightbox would

Masa, 2026-09-11: "the thumbnail should be redrawn in the default camera if there is no
pose." Today a posed render with no pose in hand is a hit (`usable`'s `pose !==
undefined` guard), on the theory that a posed picture beats none while the index is
down. The theory loses to the lightbox: the viewer opens at the default when no pose is
in hand, so the tile and the view disagree, and D4's untouched close no longer papers
over it. The rule becomes: where the source is **settled** to hold no orientation for a
model it would otherwise frame, a render drawn under an orientation (`posed` or
`poseKey` present) is stale and is re-rendered at the default framing, recording no
orientation; where the ask is **unsettled** the render stands.

Settled means the index answered, or is known not to be there; unsettled means nobody
knows yet. On the wire the two roads already share one shape for the positive case, and
now share it for the negative: a listing entry carries `pose: null` when the server asked
and the index had none (listing-tree-cache §6.9), and the wave's `PosesResponse.poses`
becomes `Record<string, IndexPose | null>` — `null` for every asked path the index
settled as none, and for every asked path when the server's status memo says the index
is `absent`, `wedged` or `volume-gone` (the lightbox shows the default in all three);
paths are **omitted** — unsettled — when the index is `warming` or its status is not
known (a cold memo, a failed ask), so a startup's warm-up does not redraw a folder at the
default and again posed sixteen seconds later. `posesListingAsked`'s `answered` is the
server's existing knowledge of the first case; the status memo (`memoisedStatus`) is the
second. The client files the whole map, nulls included: `carriedPoses` stops skipping
`null`, the wave's "empty answer is not filed" guard goes (an all-`null` answer is an
answer — that cell's semantics are the point), `usable` reads `pose === null` as "no pose:
a render labelled `posed` or carrying a key is stale", `undefined` as "unknown: the
render stands", and the re-render site already writes no `posed`/`poseKey` when
`cameraForPose` answers nothing — so the default render is unlabelled and is a hit until
the source holds an orientation again, when *An image that predates the source's current
mapping is re-rendered* takes over. `cameraForPose`, `poseKeyFor`, `resettable` and the
viewer's `pose` prop accept `null` as they accept `undefined`. `wavePaths`' `===
undefined` filter is unchanged: a `null` stays settled and is not re-asked.

Accepted cost (Masa's call): an index that goes away and comes back redraws each posed
tile twice — once at the default, once posed — per folder visited in each state. That is
the price of the tile always showing what the lightbox will open at.

### D6: The lightbox's persist was a third posed writer, keyless — retired by D4

D2 named two posed writers, the sweep's render and `entryActions`' command; there was a
third: `App.tsx`'s `persist` with `posed: true`, reached only by the untouched close of
a lightbox opened from a pose, and it never sent `poseKey`. Under D2 such a render is
stale on its next visit — one wasted re-render per such close, not a loop. D4 removes the
only caller that set `posed`, so the option and `openedFromPoseRef` go rather than gain a
key: `persist` writes a camera or nothing.

### D7: A reset gives up the axis too

Masa's step-by-step, 2026-09-11: index off, server restarted, three lightboxes opened
(and closed untouched — D4's writer, storing a default camera and `axis: z` on each),
framings reset, index on, server restarted, and "the framings were back". A cache
watcher over the reproduction saw both writes: the three closes at 18:14:59–18:15:00
(camera + axis z + pixels, no pose labels), then the reset at 18:15:04 clearing the
camera and **keeping** `axis: z` on each. That is `entry-actions`' rule as written —
"where the view supplies none … discard the camera alone and leave the axis" — and
`resettable`'s companion: an axis with no usable pose is not counted. With the index
off the count read zero; with it on, the same leftover axis had a pose to be replaced
by, so it was counted again and, being a stored axis, withheld that pose from the
tile. A reset that has to be run twice, and a stored `z` that says nothing an STL's
own default does not say (`file-frame-spindle`).

The rule becomes: a reset discards the axis with the camera, always. The model then
resolves to the pose where one is in hand, else the default about the file's own axis
(`defaultAxisFor`). `resettable` becomes `camera !== undefined || axis !== undefined`
— the wire's `framed` — shared by the count, the bulk derivation and the hand delta as
before. `framingAfterDiscard` returns the pose's axis or the file default, never the
kept one; the bulk reset and both per-model discards send `axis: null`
unconditionally. The chosen-axis case this rule used to protect (a user's axis surviving
a reset when no pose could replace it) is given up on purpose: reset means "as if the
user had never set one", and a chosen axis is something the user set.

Considered and set aside (Masa, 2026-09-11): keep the leftover axis but let a pose whose
axis matches it apply anyway. It would have closed this reproduction — the pose's axis
was `z` and so was the leftover — but not the general case (a leftover `x` against a
`z` pose still withholds, still counts), and it makes a stored axis mean two things:
"withholds the pose" when it differs, "does not" when it matches. Discarding it is one
rule.

### D3: ~~`POSE_VERSION` 2 → 3 re-renders the keyless posed renders once~~ — struck

Considered and reverted the same day (2026-09-11) — the version bump was the
compare-when-present rule's crutch: with a keyless posed render judged on the version
alone, only a new version could sweep the 92 `posed: 2` sidecars on this machine. Under
D2 as it now stands the missing key is the staleness, so the same one sweep happens
lazily, per visit, with `POSE_VERSION` at 2 and its meaning unchanged (the mapping's
version, bumped only when the mapping changes the picture).

## Risks / Trade-offs

- [A pose whose derived camera differs in the fifth decimal re-renders] → `toFixed(4)`
  rounds below what a 256² render can show; a real re-classification moves degrees.
- [Every posed thumbnail on disk re-renders once, its key missing] → lazily, per listing
  visited, through the queue that already paces renders; the pixels are the same where
  the opinion is unchanged, so nothing visible flickers — each image is kept until its
  replacement.
- [A pose that resolves to no camera re-renders every visit] → pre-existing and untouched:
  `cameraForPose` answers null for a malformed pose, the render is written with no
  `posed`, and `usable` reads it as stale on every visit. Rare (the index emits only the
  six unit axes), recorded beside `poseKeyFor`; the fix is a "framed by no pose on
  purpose" label and belongs with the index's faults, not here.
- [A changed opinion takes up to five minutes plus a navigation to show] → the server's
  pose TTL, the recorded convergence bound; a library reload drops the layer at once.
- [An index that flaps redraws every posed tile twice per folder] → D5, accepted; warming
  is unsettled, so the common flap — a restart — costs nothing until the index is ready.
- [A model with a stored camera from an earlier untouched close never re-poses] → the
  cameras already stored this way are indistinguishable from chosen ones; the global
  reset (thumbnail-jobs) is the way out, and Masa ran it on 2026-09-11 for the five
  affected. Nothing migrates.

## Migration Plan

None for data: the label is optional on the wire, and its absence on a posed render is
what does the one sweep that is wanted — lazily, per visit. Nothing is run by hand.

## Open Questions

- None. Masa rejected polling on 2026-09-11 and, the same day, the compare-when-present
  rule (with the version bump that propped it up): an absent key is stale. Later the same
  day: an untouched close stores no camera (D4), and no pose in hand redraws at the
  default (D5).
