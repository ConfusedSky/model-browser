# Viewer SSAO

## Why

Surface shading plus shadows still under-sells cavities, recesses, and part seams — exactly what a 3D-print browser needs legible at thumbnail size. Screen-space ambient occlusion darkens crevices view-dependently and is the missing depth cue. It is also the first feature that needs post-processing, so this change carries the architectural cost of introducing an `EffectComposer` pipeline onto the shared single renderer without breaking the thumbnail readback path or the handoff guarantee.

## What Changes

- **Composer-based render paths**: both the live view (`ViewerSession.render`) and `renderThumbnail` stop calling `renderer.render` directly and go through an `EffectComposer` chain (render → GTAO → output) on the existing shared renderer — still exactly one WebGL context (D2/D3 hold). The live path uses one composer resized to the host; thumbnails use a fixed 512² composer whose output buffer replaces today's hand-rolled MSAA target + `readRenderTargetPixels` + manual sRGB encode (the `OutputPass` performs the sRGB conversion, so `encodeSrgbInPlace` leaves the thumbnail path).
- **GTAO tuned per model bounds**: three's in-tree `GTAOPass` (no new dependency), with its world-space radius and thickness scaled by `bounds.radius` so occlusion depth-cues equally on miniatures and busts. Always on, both lighting modes, no user toggle — same stance as rim lights and shadows.
- **Transparent-background safety**: the app composites over a transparent clear; AO must darken only model pixels, never bake halos into thumbnail PNG edges. Edge behavior is an explicit acceptance criterion (E2E samples silhouette pixels), with the AO application depth-masked away from empty background.
- **Thumbnail refresh via `RIG_VERSION`**: AO changes every model's pixels; per rim-lights D2 the shared constant bumps once more (to `4` after viewer-shadows' `3`), riding the existing lazy re-render sweep.

Assumptions: GTAO over N8AO/SSAO because it is the current in-tree pass and adds no dependency (revisit at apply if quality disappoints); AO parameters are cosmetic and tuned at apply; **implemented after `viewer-shadows`** (which itself follows `rim-lights`) — the version bumps are sequential and both changes restructure the same render entry points.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: ADDED requirement — ambient-occlusion shading (composer pipeline on the single shared renderer, bounds-scaled GTAO, halo-free transparent edges, identical in overlay/lightbox/thumbnails).

(`model-thumbnails` is unchanged at the spec level — capture remains a 512² aspect-1 PNG and the rig-version requirement covers invalidation; only the internal readback mechanics move to the composer.)

## Impact

- `client/src/three/renderer.ts` — composer construction/ownership beside `getRenderer`; `renderThumbnail` reads pixels from the composer's output target; `encodeSrgbInPlace`/`srgb.ts` retired from this path; `RIG_VERSION` bump.
- `client/src/viewer/session.ts` — `render()` drives the live composer (resize + AO params per stage) instead of `renderer.render`.
- `client/src/three/queue.ts` / LRU interplay — none expected; composer targets are renderer-owned, not per-model.
- Client tests — renderer mocks gain new exports; unit tests for bounds-scaled AO params and composer sizing; E2E edge-pixel assertions.
- No server, API, or shared-types changes.
