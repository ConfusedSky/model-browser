## Context

The post-process chain (`RenderPass → GTAOPass → OutputPass`, `three/renderer.ts`) is shared
by the live view and the thumbnail path; its `render` already takes an `ao` argument that
flips `aoPass.enabled`. Only `ViewerSession.render` passes it (`aoEnabled()`);
`renderThumbnail` never does, so thumbnails are always occluded and the cache stores one
PNG per path under `sha256(path)` with labels (`lighting`, `rig`, `posed`) that describe
its recipe. `useThumbnails` gates a hit on those labels. The AO preference lives in
`viewer/aoToggle.ts`, per browser profile.

Why the thumbnail ignores the preference is stated in `viewer-ssao`'s design: keeping the
cache independent of a per-profile toggle meant no `RIG_VERSION` bump and no re-render
sweep on toggle. That reasoning holds for a *label*; it does not require the preference to
be *invisible* to thumbnails. Making it a key dimension keeps both properties — no bump,
no sweep — and removes the handoff discontinuity.

## Goals / Non-Goals

**Goals:**

- A tile's thumbnail and its overlay at handoff are rendered under the same occlusion
  setting, whichever way the preference is set.
- Both renders of a model can be cached at once, so toggling back is a lookup.
- Zero migration and zero re-render for anyone who never turns occlusion off.

**Non-Goals:**

- Refreshing the grid in place when the pill is pressed (`ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`),
  re-targeted).
- Choosing the preference automatically (`adaptive-ao-default`).
- Generalising the cache to N recipe variants. Two, named.

## Decisions

### D1: The unoccluded render is a sibling file of the occluded one

Per entry: `<key>.json` (camera, axis, and the occluded render's labels, exactly today's
shape), `<key>.png` (the occluded render, today's file), and new `<key>.noao.png` with its
labels under a `noao: { mtime, rig, posed, lighting }` field on the same sidecar.

Why asymmetric rather than a `variants` map with `<key>.<variant>.png` for both: symmetry
would cost a migration of every existing PNG and sidecar for the sake of a shape with
exactly two members, one of which every existing cache already holds. The occluded render
is the primary because it is what exists; the unoccluded one is named for what it lacks.
If a third recipe dimension ever appears, that is the moment to generalise, with the
migration it then earns.

### D2: The request names the render; the entry shares the orientation

`GET /api/thumb?path&mtime&ao=on|off`. The response's `status`/`png`/labels are for the
requested render; `camera` and `axis` are the entry's, whichever render was asked for. A `stale` on the unoccluded render of a model with an occluded one and a camera still carries the camera —
the client re-renders under the stored orientation, exactly as a `stale` does today. `ao`
absent means `on`, so a client from before this change reads what it always read.

`PUT` carries `ao` beside `png`; absent means `on`. Labels on a PUT apply to the render it
carries: the sidecar's top-level labels for `on`, the `noao` field for `off`.

**One camera, two renders, so a write that moves the camera invalidates the render it did not draw.** The orientation
is shared by design (D4 in the v1 design: keyed by path, survives re-export), and an orbit
rewrites it together with the current render's pixels — `App.tsx`'s `persist` PUTs both.
Left alone, the *other* render would keep its `mtime` label, read as a hit, and show the
model at the pre-orbit angle the next time the preference flipped: two angles for one
camera, and browser A (occlusion on) disagreeing with browser B (off) about a model's
orientation, which the shipped "Orientation shared across browsers" scenario forbids. So
a PUT that **changes the shared orientation** invalidates the render it did not write — and,
when it carries no pixels, **both** (`resetFramingLive` in `entryActions.ts` PUTs `camera: null, axis: framing.posed ? null : undefined` with no PNG — the axis is discarded only when a usable pose exists; there is no "written render", and the first draft of this rule
would have invalidated the render on screen and left the other at the discarded angle). A
PUT that carries only a PNG and labels touches the other render **never**: both renders are
drawn under the stored orientation, so pixels alone cannot put them at two angles, and the
ordinary render PUT (`useThumbnails`' tail sends `png` and labels, no camera) must leave
the sibling a hit or "toggling back is a lookup" is unreachable.

**What counts as a change is a tolerance, not equality — and a first-ever camera is a change.** A camera the entry did not hold has nothing to be compared against and must invalidate: a posed model rendered under both settings, orbited, then closed writes its first camera while the sibling is still drawn at the pose. The axis is an enum and compares by equality. The cost of the first-camera rule, stated: an un-oriented, un-posed model's first unmoved lightbox close persists a first camera (`closeLightbox`'s `decided = everManipulated || !unowned` is true for it), and if both renders were already cached the sibling re-renders once to pixels identical to what it had. Once per model, and only when both renders exist — accepted over the alternative of the client deciding what the server should compare. `App.tsx`'s `persist` sends the
camera on every lightbox close whether or not the user moved it, and `closeLightbox`
settles through `captureState` — a round trip az/el → cartesian → `asin`/`atan2` → az/el
that is not bit-exact. Measured (the fourth reviewer's re-run, 2026-08-28: the `applyState` → `captureState` round
trip, y-frame, bounds pivoted to the origin, 200k random states at each of radius 0.01, 1
and 137): `DEFAULT_CAMERA` drifts by 1.1e-16, the **maximum** drift is 7.1e-15, and most
states differ. Under value equality every close of an oriented model would invalidate its
sibling — the first-draft failure moved from "every render" to "every close". So the
comparison is `|Δ| > CAMERA_EPSILON` per component of `CameraState` — every component is
O(1) and unit-free in the same sense (`az`/`el` radians, `distR` clamped to [1.1, 20],
`target` in bounding-sphere-radius units), the drift is scale-independent, and 1e-9 has
five orders of headroom. The probe lands as a **test beside the constant** (task 1.5)
asserting max round-trip drift ≪ `CAMERA_EPSILON`, so the number is re-runnable where it is
used rather than quoted from a session that is gone.

**Invalidate by clearing labels, not `mtime`.** A `stale` response carries no pixels
(`ThumbCache.get` returns labels and camera only when `mtime` mismatches), so clearing the
sibling's `mtime` would produce exactly the pixel-less answer that makes "shown until its
replacement exists" false as a server mechanism. Clearing the sibling's recipe labels
(`rig`, `lighting`, `posed`) instead leaves it a *hit* whose labels fail the client's check
— the path `Recipe-labelled thumbnails` already defines — so its pixels are served, shown,
and replaced. The per-render status is then simply: hit when this render's pixels are present at the
requested mtime; stale when it was written before or the entry holds a *camera* — `get`'s
predicate today is `meta.camera !== undefined || meta.mtime !== undefined`, camera only,
applied per render; an axis-only entry is a miss — miss otherwise. A PNG written at a newer
mtime supersedes the sibling's pixels as well: they are deleted then, or the unvisited render
would hold stale pixels until next rendered.

### D3: Each render is its own LRU file; the entry is one existence

`maintain` already sizes and sorts PNG files by their mtime (the LRU clock, bumped by
`utimes` on read). Both files join that list individually: an unoccluded render nobody has
looked at since is evicted before an occluded one read yesterday, and evicting one clears
only that render's `mtime` — the top-level one, or `noao.mtime`. Its recipe labels stay and
ride the stale read, exactly as the occluded render's have since eviction existed: they say
what recipe the evicted pixels were under, which is what a client asks a stale answer for.
The other render is untouched either way, a cap candidate on its own clock or not. The
existence sweep still removes the whole entry — both PNGs and the sidecar — when the source
is gone.

### D4: Thumbnails read the preference at render time, not at module load

`useThumbnails` and the two re-render commands call `aoEnabled()` when they build a
request or a render, and pass the value through `getThumb`, `renderThumbnail` and
`putThumb`. The live view already does this per frame. (Superseded for the hook by `ao-refreshes-thumbnails` 1.1, which passes the value from `App.tsx` and lets the dependency drive the re-run; the re-render commands and `persist` still read it themselves.) Reading once per render — not once per hook mount — is what lets `ao-refreshes-thumbnails`, re-targeted, re-run the
same sweep after a toggle and get the other render. Handoff parity follows from both paths
reading the same store: the thumbnail on screen and the overlay that opens over it were
rendered under the same answer.

### D4a: Every path that renders or persists a thumbnail passes the preference

Four sites call `renderThumbnail` — `useThumbnails`' tail, the two re-render commands in
`entryActions.ts`, and `ViewerSession.snapshot` — and `putThumb` is called from those plus
`App.tsx`'s `persist`. `snapshot` is the one that is easy to miss: it renders through
`renderThumbnail`, not the live chain, so with `ao = true` as the default every
orbit-release and lightbox-close snapshot would be occluded whatever the pill says and
PUT with `ao` absent. That is the standing behaviour today (thumbnails always shipped
recipe), and it is the mismatch this change exists to close; `persist` reads `aoEnabled()`
**once, before its await** — it already captures `state` and the label that way ("a rapid
toggle mid-snapshot must not pair this PNG with newer values in one PUT") — passes it into
`snapshot(ao)` and declares the same value on the PUT; two independent reads would let a
toggle between them file occluded pixels under the `noao` slot with matching labels, a
wrong-recipe hit nothing invalidates. `resetFramingLive` is the fifth `putThumb` site — `useThumbnails`' tail, both `entryActions` re-render commands, `persist`, and it (a `null` discard, no PNG) — and declares `ao` too, though with no pixels the value only names
the request.

### D5: No `RIG_VERSION` bump

The rule (CLAUDE.md, `viewer-ssao`) is that a change to thumbnail pixel output bumps the
version so stale entries re-render. Nothing here changes the pixels of any render that
exists: the occluded recipe is untouched, and the unoccluded render is a new key, not a
new version of an old one. A future change to either recipe bumps as before, and both
renders' `rig` labels are compared against it.

## Risks / Trade-offs

- [Cache size doubles for a user who toggles often] → Bounded by the same cap; each render
  is evicted on its own LRU, so the render the user has stopped using goes first.
- [A directory visited with the pill off re-renders every tile once] → This is the lazy
  rule every recipe input already follows, and the re-targeted refresh change makes it
  answer on the grid in front of the user rather than on the next visit. Renders without
  the AO passes are cheaper than the ones the cache was built with.
- [`library-root`'s migration must move the sibling file too] → It need not: a legacy
  absolute-keyed entry cannot carry a `.noao.png` — the sibling is born after this change,
  under a per-library key — so its 3.2 moving the PNG and sidecar is complete. Ordering is
  declared here; `library-root` does not mention this change and need not.
- [The demo needs both renders baked] → The bake is a sweep under each preference; the
  deployment change owns it. This change makes the second render *exist* to be baked.
- [An old client PUTs an unoccluded render without `ao`] → Impossible: an old client never
  renders unoccluded thumbnails. Absent-means-`on` is exactly what every old PUT was.

## Migration Plan

None required. Existing entries are complete occluded renders; the unoccluded sibling
appears on first render under the preference. Rollback: an older build ignores `ao` on
GET (reads the occluded render) and never sees `noao`; sibling files are orphaned bytes
until a sweep, which ignores unknown files today — acceptable.

## Open Questions

None.
