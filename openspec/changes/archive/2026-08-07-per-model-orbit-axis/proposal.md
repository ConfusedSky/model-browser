## Why

The orbit-feel experiment landed on clamped turntables and found the root problem: print-world models are Z-up while the scene is Y-up, so the spindle never matched the model's true vertical. The Z-up conversion is now in the code but unspecced, the experiment left a global mode picker that should become a per-model setting, and camera persistence is currently only faithful for the default spindle. This change turns the experiment into the real feature and brings the specs back in line with reality.

## What Changes

- **Spec the upright-display convention** (already implemented): STL geometry is converted print-bed-Z-up → scene-Y-up at parse; 3MF via its loader; OBJ left Y-up.
- **Per-model orbit axis**: every model orbits as a clamped turntable around a spindle axis. Default is `+Y` (the model's natural up). A per-model override — one of ±X/±Y/±Z (flip is part of the override, not a separate control) — is set from a control in the lightbox.
- **Axis persisted server-side** in the same cache entry as camera state, keyed by path only, following the same maintenance rules (survives size-cap eviction, removed by the existence sweep).
- **Camera state becomes spindle-relative**: azimuth/elevation are stored relative to the model's spindle frame, so orientation round-trips exactly for every axis — not just +Y. Existing saved cameras are unaffected (all existing entries have the default +Y spindle, under which the representation is identical).
- **Retire the global experiment picker** (corner pill UI and localStorage orbit-mode/flip settings) in favor of the per-model lightbox control.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-viewer`: orbit is defined as a clamped turntable around the model's spindle axis (default +Y, per-model override set in the lightbox); new upright-display requirement for the Z-up conversion.
- `model-thumbnails`: cache entry gains the per-model axis; camera state is spindle-relative; maintenance rules extended to the axis.

## Impact

- `client/src/viewer/` (session, lightbox control, remove `orbitModes.ts` picker plumbing), `client/src/three/camera.ts` (spindle-frame state math), `client/src/three/models.ts` (already-landed Z-up conversion, now specced).
- `shared/types.ts`: `CameraState` documented as spindle-relative; new `OrbitAxis` type (`'x' | '-x' | 'y' | '-y' | 'z' | '-z'`); thumb API payloads carry the axis.
- `server/src/cache.ts` + `/api/thumb`: axis stored/served in the `{png, camera}` entry.
- No cache migration: existing entries implicitly have axis `+Y`, under which spindle-relative equals the current world-Y representation.
