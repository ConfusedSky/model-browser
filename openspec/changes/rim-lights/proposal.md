# Red/Blue Rim Lights

## Why

The rig lights shape (hemisphere + key + fill) read well but leave silhouettes flat: edges facing away from the key melt into the background. A classic pair of colored rim lights — red from the left, blue from the right — separates the model from the dark backdrop and makes rotation legible. They should inherit the existing lighting-mode semantics rather than invent new ones: in `camera` mode the accents follow the viewer (screen-left stays red while orbiting), in `axis` mode they stay put in the model's spindle frame (the model's own left side stays red as it turns).

## What Changes

- **Rim lights in the rig**: two modest-intensity colored directional lights — red at rig-space left, blue at rig-space right, both slightly behind the subject — added to the existing orientable rig `Group`. Because the rig already carries the axis/camera orientation, the tween slerp, and the cancel snap, the rim lights inherit all of it with no new orientation code. Always on in both modes; intensities are accents, not floodlights (exact values tuned at apply).
- **Rig version in the thumbnail cache**: adding lights changes every model's pixels, and the recorded handoff guarantee (thumbnail matches live lighting, no shift) requires stale thumbnails to refresh. A rig version rides the cache meta exactly like the lighting mode does: the server stores and echoes it without interpreting; the client treats a hit with a different or absent version as needing re-render (camera state and axis preserved) — the same lazy one-time sweep that upgraded pre-lighting entries.
- **Spec amendment**: the "default `y` axis is identical to the historical rig" claim is re-scoped to the base rig's *orientation*; the rim accents are an intentional visual change for every model.

Assumptions: the accents are not user-toggleable and apply in both modes; "left/right" means screen left/right in `camera` mode and the spindle frame's yaw-plane left/right in `axis` mode; exact positions/intensities are cosmetic and decided at apply time.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: MODIFIED requirement — the rig gains red/blue rim lights that orient with it per the active lighting mode; the historical-identity claim is narrowed to the base rig's orientation.
- `model-thumbnails`: MODIFIED requirement — cache entries record the rig version they were rendered with; a version mismatch (or absence) invalidates the PNG, preserving camera state and axis.

## Impact

- `client/src/three/renderer.ts` — rim lights in `makeScene`'s rig; exported `RIG_VERSION` constant.
- `client/src/hooks/useThumbnails.ts`, `client/src/App.tsx` — staleness check extends to the rig version; thumb PUTs carry it.
- `shared/types.ts`, `client/src/api/client.ts`, `server/src/cache.ts`, `server/src/app.ts` — `rig` field on thumb GET/PUT and cache meta, mirroring `lighting` (including the "describes the pixels" clearing rule).
- No session/ViewerLayer changes — the rig group already carries orientation, tween, and snap.
