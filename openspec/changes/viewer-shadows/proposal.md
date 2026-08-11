# Viewer Shadows

## Why

Models render shadowless: the key light shapes faces but casts nothing, so prints read as floating and their depth cues stop at surface shading. Shadow mapping from the existing key light — the model shadowing itself plus a soft contact shadow on an invisible floor beneath it — anchors the model and makes concavities and overhangs (things a 3D-print browser cares about) legible at thumbnail size. It rides entirely on the current rig and single-renderer design; no post-processing is involved.

## What Changes

- **Origin-centered scenes**: model geometry keeps arbitrary world coordinates today (STL coords are whatever the slicer exported); a per-scene wrapper group SHALL re-center the model's bounds on the scene origin. Camera state is bounds-relative (D4), so this changes no persisted state and no pixels on its own — it exists because a directional light's shadow camera must physically cover the model, which is only tractable (and precision-safe) with the model at the origin. Far-from-origin depth precision improves as a side effect.
- **Key-light shadow mapping**: the shared renderer enables PCF-soft shadow maps; the key light casts, model meshes cast and receive (self-shadowing). A per-scene fit scales the key light's distance, its ortho shadow frustum, and its normal bias by `bounds.radius`, so tiny and huge prints shadow equally well. The hemisphere, fill, and rim lights do not cast. Because the key stays in the rig, shadow direction inherits the lighting-mode semantics for free: fixed to the spindle frame in `axis` mode, following the viewer in `camera` mode.
- **Contact-shadow floor**: a `ShadowMaterial` plane — invisible except for the shadow it receives — sits perpendicular to the model's spindle axis at the model's lowest extent along it, sized to a multiple of the bounds radius. It renders in the overlay, lightbox, and thumbnails alike, composing over the transparent background. The floor is spindle-fixed (never in the rig) and snaps to the new spindle on an axis change.
- **Thumbnail refresh via `RIG_VERSION`**: shadows change every model's pixels. Per rim-lights D2, any pixel-changing render revision bumps the shared `RIG_VERSION` constant rather than growing a new cache field — this change bumps it (to `3` if rim-lights' `2` has landed). The existing lazy visit-time sweep re-renders stale thumbnails with camera state and axis preserved.
- **Rim-comparison toggle (verification scaffolding)**: a visible control in the viewer toggles the red/blue rim accents off and on in the live view, so key-light-only and key+rim renders can be compared under the new shadows. Live view only — thumbnails always render the full rig recipe, so the toggle never touches `RIG_VERSION` or the cache. It follows the lighting-mode pill precedent (client/src/viewer/lighting.ts), is not persisted, and is scaffolding: before this change is archived the comparison is judged and the toggle removed — or, if it earns its keep, promoted by a follow-up change that specs it properly.

Assumptions: shadows are always on in both lighting modes, not user-toggleable (same stance as the rim-light accents — the temporary rim toggle above is comparison scaffolding, not a reversal of that stance); exact intensities, frustum margins, bias, and shadow-map resolution are cosmetic and tuned at apply time; **this change is implemented after rim-lights lands** — it depends on the `RIG_VERSION` plumbing that change introduces and edits the same `makeScene` and renderer-mock files.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: ADDED requirement — shadowed model display (key-light self-shadowing plus a spindle-fixed contact floor, shadow direction per lighting mode, present in overlay/lightbox/thumbnails). Kept separate from the spindle-aligned-lighting requirement, which the in-flight rim-lights change is modifying.

(`model-thumbnails` is unchanged at the spec level — the rig-version invalidation requirement rim-lights adds already covers this change's `RIG_VERSION` bump. The rim-comparison toggle adds no spec delta: it is removed before archive; keeping it would be a follow-up change with its own spec.)

## Impact

- `client/src/three/renderer.ts` — shadow-map enable on the shared renderer; wrapper/centering, shadow fit, and floor construction shared by `makeScene` consumers; `RIG_VERSION` bump.
- `client/src/three/camera.ts` — `boundsOf` (or a sibling) exposes the box extent along a spindle axis for floor placement.
- `client/src/viewer/session.ts` — scene setup via the wrapper; floor snap in `setAxis`; `close()` disposes the floor's geometry/material (D5 spirit).
- `client/src/three/models.ts` — meshes flagged `castShadow`/`receiveShadow` at material/mesh setup.
- `client/src/viewer/lighting.ts` (or a sibling module) and `client/src/viewer/ViewerLayer.tsx` — the temporary rims-enabled flag and its toggle control (removed again before archive).
- Client tests — renderer-mock factories gain any new exports; unit tests for the fit and floor placement per spindle.
- No server, API, or shared-types changes — the cache field shipped with rim-lights.
