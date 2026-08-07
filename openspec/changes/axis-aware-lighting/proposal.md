# Axis-Aware Lighting

## Why

The light rig (`makeScene`) is world-fixed with sky = +Y, built before per-model orbit axes existed. A model whose spindle is ±X/±Z is now lit from the side: "top-lit" no longer matches the model's actual up. Lighting should follow the spindle — and while we're in the lighting rig, add the classic alternative for comparison: a camera-relative (headlight) rig where shading stays constant as you orbit.

## What Changes

- **Axis-aligned lighting (new default)**: the existing rig (hemisphere + key + fill) is oriented per model so its "up" is the model's spindle axis. For the default `y` axis this is exactly today's lighting — only overridden-axis models change appearance.
- **Camera-relative option (headlight)**: an alternate mode fixing the rig in camera space, so the lit side always faces the viewer while orbiting. Global, client-persisted (localStorage), experimental toggle in the same spirit as the retired orbit-feel picker; default `axis`.
- **Axis-change animation**: in axis mode, the lightbox axis tween rotates the rig in step with the camera animation (no lighting snap).
- **Thumbnail consistency**: thumbnails render with the same mode and rig orientation as the live view (axis mode → model's spindle frame; camera mode → the rest camera's frame), so the no-brightness-shift handoff guarantee keeps holding. The server stores the lighting mode a PNG was rendered with; a cached thumbnail whose mode differs from the active mode is treated as stale (camera preserved) and re-rendered, including pre-change legacy thumbnails.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: ADDED requirement — lighting follows the model's spindle axis, with a global camera-relative option; axis changes animate the rig.
- `model-thumbnails`: ADDED requirement — thumbnails record their lighting mode; mode mismatch invalidates the PNG (not the camera state).

## Impact

- `client/src/three/renderer.ts` — extract the light rig from `makeScene` into an orientable group; `renderThumbnail` orients it from mode + axis/camera.
- `client/src/viewer/session.ts` — orient the rig per render: spindle frame (slerping during the axis tween) or camera quaternion.
- `client/src/App.tsx` / new `client/src/viewer/lighting.ts` — mode store (localStorage) + experimental toggle UI.
- `client/src/hooks/useThumbnails.ts`, `shared/types.ts`, `server/src/cache.ts`, `server/src/app.ts` — `lighting` field on thumb GET/PUT and cache meta, mirroring the existing `axis` field; mismatch → stale.
