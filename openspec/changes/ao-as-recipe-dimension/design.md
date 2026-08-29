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
requested render; `camera` and `axis` are the entry's, whichever render was asked for. A
`miss` on the unoccluded render of a model with an occluded one still carries the camera —
the client re-renders under the stored orientation, exactly as a `stale` does today. `ao`
absent means `on`, so a client from before this change reads what it always read.

`PUT` carries `ao` beside `png`; absent means `on`. Labels on a PUT apply to the render it
carries: the sidecar's top-level labels for `on`, the `noao` field for `off`. A PUT with no
PNG (camera/axis only) touches neither render's labels, as today.

### D3: Each render is its own LRU file; the entry is one existence

`maintain` already sizes and sorts PNG files by their mtime (the LRU clock, bumped by
`utimes` on read). Both files join that list individually: an unoccluded render nobody has
looked at since is evicted before an occluded one read yesterday, and evicting one clears
only its labels (the top-level `mtime`, or `noao`). The existence sweep still removes the
whole entry — both PNGs and the sidecar — when the source is gone.

### D4: Thumbnails read the preference at render time, not at module load

`useThumbnails` and the two re-render commands call `aoEnabled()` when they build a
request or a render, and pass the value through `getThumb`, `renderThumbnail` and
`putThumb`. The live view already does this per frame. Reading once per render — not once
per hook mount — is what lets `ao-refreshes-thumbnails`, re-targeted, re-run the
same sweep after a toggle and get the other render. Handoff parity follows from both paths
reading the same store: the thumbnail on screen and the overlay that opens over it were
rendered under the same answer.

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
- [`library-root`'s migration must move the sibling file too] → Its tasks move every file
  of a key (`<key>.*`); called out in its 3.2. Ordering declared in both proposals.
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
