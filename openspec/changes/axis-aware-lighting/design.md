# Design — axis-aware-lighting

## Context

`makeScene()` bakes a world-fixed rig: `HemisphereLight` (sky along +Y), key directional at (1,2,1.5), fill at (−1.5,−0.5,−1). Every render path shares it — `ViewerSession` for the overlay/lightbox and `renderThumbnail` for the offscreen queue. Since per-model-orbit-axis, a model's spindle can be any of ±X/±Y/±Z (`frameFor(axis)` gives its `{s, a, b}` frame, camera up locked to `s`), so non-Y models render side-lit. The recorded handoff guarantees (no brightness shift between thumbnail and live view — model-viewer "Seamless handoff", model-thumbnails "same lighting as the live viewer") constrain any lighting change to apply identically to both paths.

## Goals / Non-Goals

**Goals:**
- Rig "up" follows the model's spindle; identical to today for the default `y` axis.
- A global camera-relative (headlight) mode as an experimental alternative.
- Thumbnails always lit the same way the live view will be at handoff, across mode switches and legacy cache entries.
- Smooth rig rotation during the lightbox axis tween (axis mode).

**Non-Goals:**
- Per-model lighting mode or server-persisted lighting preference — the mode is a global aesthetic experiment (localStorage), like the retired orbit-feel picker; promote later if a winner emerges.
- New rig design (light count, colors, intensities stay exactly as they are — only orientation changes).
- Relighting other browsers' caches eagerly — legacy/mismatched thumbs re-render lazily on visit.

## Decisions

### D1: Orient the rig by the spindle frame's basis, not a shortest-arc quaternion

Extract the three lights into a `Group` (the rig) and set its quaternion from the rotation matrix with columns (a, s, b) — mapping x̂→a, ŷ→s, ẑ→b. `frameFor` maintains a×b = −s, which makes (a, s, b) a proper rotation for all six spindles, and for `y` it is exactly the identity: default-axis models keep today's pixels, thumbnail caches for them stay valid.

*Alternative — `setFromUnitVectors(+Y, s)`:* degenerate for `-y` (antipodal — arbitrary roll), and the roll it picks for ±X/±Z is incidental rather than tied to the drag frame. The frame basis is already the app's canonical answer to "which way is around" per spindle.

### D2: Camera mode sets the rig quaternion from the camera each render

In `camera` mode the rig is defined in view space: `rig.quaternion.copy(camera.quaternion)` after the camera is posed (session `render()`; `renderThumbnail` after `applyState`). Key then always shines from the viewer's upper front-left, hemisphere sky is screen-up. No parenting games — the rig stays a scene child with its quaternion set explicitly, keeping one code path for both modes.

*Alternative — `camera.add(rig)`:* requires adding the camera to the scene per three.js semantics and splits the update model between modes; explicit quaternion assignment is one line and uniform.

### D3: Mode is a module-level store with localStorage persistence

`client/src/viewer/lighting.ts` exports `getLightingMode()/setLightingMode()` (`'axis' | 'camera'`, default `'axis'`), persisted in localStorage — same shape as the retired orbitModes store. UI: a small fixed pill marked experimental (the orbit-feel picker precedent), not a lightbox control, since the mode is global rather than per-model. Session reads the mode per render (cheap), so a toggle mid-orbit takes effect immediately.

### D4: Axis-tween lighting slerps between frame quaternions on the tween clock

In axis mode, `setAxis` records the rig's from/to quaternions (old/new frame basis); `advance()` slerps the rig with the same `easeInOutCubic` clock as the camera. A drag cancelling the tween snaps the rig to the new frame, matching the camera snap. In camera mode nothing extra is needed — the rig follows the camera through the tween for free.

### D5: Lighting mode rides the thumb cache meta; mismatch means stale

Mirror the `axis` field end-to-end: `lighting?: 'axis' | 'camera'` on `ThumbPutRequest`, `ThumbGetResponse`, and the server `Meta`. The server compares nothing — it stores and echoes. The *client* treats a `hit` whose `lighting` differs from the active mode as a render-needed case (keep camera/axis, drop the PNG), reusing the existing stale path in `useThumbnails`. An absent field (legacy entry) reads as mismatch → one-time lazy re-render sweep; for default-axis models in axis mode the new render is pixel-identical, merely refreshing the cache.

*Alternative — client-only invalidation on toggle:* can't work; a `hit` response without the field gives the client no way to know how a cached PNG was lit, and other directories/browsers would keep mismatched thumbs indefinitely.

## Risks / Trade-offs

- [Mode toggle triggers a re-render sweep per directory visit] → Renders go through the existing bounded queue and only replace PNGs (camera preserved); toggling is an explicit, rare act during the experiment.
- [Legacy-entry re-render on first visit after upgrade] → Same bounded-queue path; for `y`-axis models output is identical so the swap is invisible.
- [Two thumbnails PUT with different modes fight across two browsers set differently] → Accepted for an experimental global setting; each browser lazily re-renders to its own mode on read, and the camera state is never touched. Promoting a winning mode ends the churn.
- [Rig identity depended on by tests/snapshots] → Keep light parameters byte-identical; only a Group wrapper and quaternion are added.

## Open Questions

None — remaining freedom (exact pill copy/placement) is cosmetic and decided at apply time.
