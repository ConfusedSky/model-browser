## Context

`axis-aware-lighting` (archived 2026-08-11) gave the rig two orientations and a
localStorage-backed mode (`viewer/lighting.ts`, default `axis`) read at five sites: the
live view (`ViewerSession.render` copies the camera quaternion in `camera` mode, else the
spindle frame's `rigQuaternion`, slerping through the axis tween), the thumbnail path
(`renderThumbnail` does the same for the rest camera), the two re-render commands in
`entryActions.ts`, `App.tsx`'s `persist` (which labels every orbit-release and
lightbox-close snapshot), and the hit test in `useThumbnails` (`cached.lighting ===
getLightingMode()`). `rim-lights` added a `rig` version label beside `lighting` in the
cache meta, "mirroring `lighting` end-to-end". The server stores and echoes both without
interpreting them.

The cache on this machine says which mode is used: 1,758 sidecars labelled `camera`, none
`axis`. The decision to remove `axis` is recorded in `docs/web-demo-notes.md` item 9.

## Goals / Non-Goals

**Goals:**

- One rig orientation — camera space — everywhere: overlay, lightbox, thumbnails.
- No lighting preference to store, show, or keep out of the URL.
- Every thumbnail already rendered under camera lighting stays a hit; anything rendered
  under axis lighting re-renders lazily, as a mode mismatch did.
- Leave the ground clear for `ao-as-recipe-dimension` and the re-targeted refresh change.

**Non-Goals:**

- Changing what camera-mode pixels look like. No rig parameter moves; no `RIG_VERSION`
  bump.
- Removing the `lighting` label from the cache or the wire.
- Touching the ambient-occlusion requirement or toggle.

## Decisions

### D1: The rig follows the camera, unconditionally

`ViewerSession.render` copies `camera.quaternion` into the rig every frame; `renderThumbnail`
copies the rest camera's. That is today's `camera` branch with the condition removed. The
axis tween no longer needs a rig slerp: the camera tweens, and the rig copies it each
frame, so lighting is continuous through the tween by construction — the scenario the
spec keeps is that continuity, not a rig animation. `rigQuaternion` in `camera.ts` loses
its last caller and goes; `frameFor` stays — the contact floor is laid perpendicular to
the spindle, which is geometry, not lighting.

### D2: Keep the label, narrow what can be written

Three options for the `lighting` field the cache stores and echoes:

1. Drop it and bump `RIG_VERSION`. Simple; re-renders every thumbnail on every machine,
   including the 1,758 here that are already correct.
2. Drop it and bump nothing. An `axis`-rendered PNG would then be indistinguishable from a
   camera one and stay wrong while looking fresh — the failure `rig` versioning exists to
   prevent.
3. **Keep it as a label with one producible value.** Every render writes `'camera'`; the hit
   test requires it; a stored `axis` is stale and re-renders on the next visit through
   the queue that already handles a mode mismatch. Zero re-renders on a camera-only cache,
   correct on an axis-rendered one.

Option 3. `LightingMode` stays the label's type in `shared/types.ts`, documented as legacy
— a stored `axis` must remain readable — and the server's PUT validation accepts only the
value a client can produce. `ao-as-recipe-dimension` will restructure the labels when it
makes occlusion a cache-key dimension; retiring `lighting` belongs there or later, with a
`RIG_VERSION` bump if it ever means re-rendering.

### D3: The requirements are renamed to what they now describe

*Lighting-mode-aware thumbnails* is about labels and staleness, and after this change no
lighting mode exists. It is RENAMED to *Recipe-labelled thumbnails* and MODIFIED under the
new title: the rig version and the lighting label are the recipe inputs the key does not
carry; a mismatch on either is stale; the scenarios about switching modes go, the ones
about legacy entries and rig revisions stay. `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`) MODIFIES the
old title and is re-targeted after this lands (proposal, ordering). *Spindle-aligned
lighting with camera-relative option* is renamed for the same reason — its body now says
there is no option — to *Camera-fixed lighting rig*; and *Shadowed model display*, whose
shadow-direction clause and one scenario name both modes, is MODIFIED to camera-only,
every scenario title kept.

### D4: The URL requirement stops naming a preference that no longer exists

`url-navigation`'s *The URL names the committed view* lists "lighting mode" among the
preferences kept out of the URL and has a scenario that switches it. Both are rewritten
against `library-root`'s delta text (which MODIFIES the same requirement), naming only the
ambient-occlusion preference. Hard ordering: after `library-root` archives.

## Risks / Trade-offs

- [Someone preferred axis lighting for a ±X/±Z-spindle model] → Camera lighting lights
  every spindle from the viewer's side; the lit-from-the-side failure that motivated
  `axis` cannot occur. The cache says nobody used it here; the demo never offered it.
- [A stored `axis` label on another machine's cache] → Stale on read, re-rendered lazily,
  camera and axis preserved — the existing mismatch path, now with one side constant.
- [Two active changes collide on the requirements this rewrites] → Declared hard ordering
  in the proposal; `ao-refreshes-thumbnails` is being re-targeted regardless, and
  `library-root` lands first.
- [Sixteen test files mention lighting] → Most assert the label round-trips or the hit
  test; those keep passing against the constant — except where a mock *chooses* `'axis'`
  as a stand-in for "the current mode": `semanticSearch.test.tsx`'s pose-loop regression
  mocks `getThumb` with `lighting: 'axis'` and asserts a hit with no render, which this
  change would silently invert into a stale re-render. Such mocks switch to the constant
  so the tests keep meaning what they mean. The mode-switch and axis-orientation
  cases (`lighting.test.ts`, `sessionLighting.test.ts`, parts of `orbitHandoff` and
  `viewerLayer`) are deleted with the behaviour, not rewritten to pass.

## Migration Plan

Nothing to migrate: the change is a deletion plus a constant. A cache with `axis` entries
converges on first visit of each directory. `localStorage`'s `model-browser:lighting-mode`
key is simply never read again.

## Open Questions

None.
