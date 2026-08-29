## Why

The light rig has two orientations: `axis` — up along the model's spindle, so an
overridden-axis model is lit from its own top — and `camera` — fixed in camera space, so
the lit side follows the viewer. `axis` is the code's default; `camera` is the one that
gets used. Of the 1,758 thumbnail sidecars in this machine's cache, 1,758 say `camera` and
none say `axis`, and the judgement behind that is simple: camera lighting almost always
looks better. The bug `axis` was built to fix — a world-fixed +Y rig lighting a ±X/±Z
spindle from the side (`axis-aware-lighting`) — has no counterpart in camera mode, where
the rig follows the view whatever the spindle is.

Two things make this worth doing now rather than leaving a dormant option. Every fresh
browser profile gets `axis`, the mode nobody chose — which on a public demo means every
visitor. And an active change, `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`), exists only to make the
mode toggle refresh the grid; with one mode, its trigger has nothing to fire on and its
mechanism is wanted by the ambient-occlusion toggle instead. Removing the mode first lets
that change be re-targeted cleanly. `docs/web-demo-notes.md` item 9 records the decision.

## What Changes

- **Axis lighting mode is removed.** The rig is always camera-fixed: the lit side follows
  the viewer, the red and blue rim accents stay at screen-left and screen-right, and an
  axis change in the lightbox keeps lighting continuous because the rig follows the camera
  through the tween. Light colours, intensities and relative geometry are unchanged.
- **The lighting pill goes.** No global lighting preference, nothing in localStorage for it,
  nothing for the URL requirement to keep out.
- **Thumbnails rendered under camera lighting stay valid; axis-rendered ones re-render
  lazily.** The `lighting` label the cache already stores and echoes is kept as a label,
  now with one producible value; a cached entry labelled `axis` reads as stale exactly as
  a mode mismatch did. No `RIG_VERSION` bump: camera-mode pixels are byte-identical to
  what the current rig produces.
- The thumbnail requirement that was about *lighting modes* is renamed to what it is
  about now — the recipe labels a thumbnail carries and when they make it stale.
- **Explicitly not in this change:** ambient occlusion becoming a recipe dimension, the
  re-targeting of `ao-refreshes-thumbnails`, and dropping the `lighting` label
  from the wire. Each follows this.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: **RENAME** *Spindle-aligned lighting with camera-relative option* →
  *Camera-fixed lighting rig* and **MODIFY** it — rewritten as camera-relative lighting only; the axis-mode scenarios go, the camera-mode
  and rim-accent scenarios stay, the axis-change scenario becomes continuity through the
  tween. **MODIFY** *Shadowed model display* — its shadow-direction clause and its "Shadows
  follow the lighting mode" scenario name both modes; they become camera-only (the floor's
  spindle-frame placement is unchanged). The *Ambient-occlusion shading* requirement's "in
  both lighting modes" is left for `ao-as-recipe-dimension`, which rewrites that
  requirement anyway.
- `model-thumbnails`: **RENAME** *Lighting-mode-aware thumbnails* → *Recipe-labelled
  thumbnails*, and **MODIFY** it: the labels are the rig version and the lighting label;
  a stored lighting label other than the one the client renders is stale; no mode
  switch exists. `ao-refreshes-thumbnails` MODIFIES this requirement under its old
  title — hard ordering below.
- `url-navigation`: **MODIFY** *The URL names the committed view* — "lighting mode" leaves
  the list of preferences kept out of the URL, and the appearance-preference scenario
  names only ambient occlusion. `library-root` MODIFIES the same requirement — hard
  ordering below.

## Impact

**Client**

- `viewer/lighting.ts` deleted; `LIGHTING_MODES`, `getLightingMode`, `setLightingMode`
  gone from `App.tsx` (the corner pill's lighting buttons **and `persist`**, which PUTs
  the label with every orbit-release and lightbox-close snapshot), `hooks/useThumbnails.ts`,
  `lib/entryActions.ts` (both re-render commands), `viewer/session.ts`,
  `three/renderer.ts` (`renderThumbnail`), `viewer/ViewerLayer.tsx` (the `lighting` prop).
- `viewer/session.ts`: the rig copies the camera quaternion every render; the axis-tween's
  rig slerp (`fromRigQ`/`toRigQ`) and the initial `rigQuaternion(axis)` copy go.
  `three/camera.ts` `rigQuaternion` is deleted if nothing else reads it.
- A single constant names the label every render writes (`'camera'`); the hit test in
  `useThumbnails` compares against it.
- Sixteen test files reference lighting; the mode-switch and axis-orientation cases are
  deleted, the label-staleness cases are kept against the constant.

**Server and shared**

- `shared/types.ts`: `LightingMode` stays as the label's type — a stored `axis` must still
  be readable and echoed — documented as legacy with one producible value.
- `server/src/app.ts`: PUT validation accepts only the producible value.
- `server/src/cache.ts`: unchanged; it stores and echoes.

**Ordering against other changes (hard)**

- After `library-root` archives: this change's `url-navigation` delta is written against
  library-root's text; if that text changes, re-derive this delta before archiving.
- Before `ao-refreshes-thumbnails` is updated or applied: its `model-thumbnails`
  delta MODIFIES *Lighting-mode-aware thumbnails*, which this change renames. That change
  is re-targeted to the ambient-occlusion toggle (`opsx:update`) on top of this one and
  `ao-as-recipe-dimension`; its delta must be rewritten under the new title.
- Before `ao-as-recipe-dimension`, which rewrites the ambient-occlusion requirement and
  the recipe labels this change leaves in place.
