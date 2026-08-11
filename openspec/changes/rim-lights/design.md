# Design — rim-lights

## Context

`makeScene` (client/src/three/renderer.ts) returns `{ scene, rig }` — a `Group` holding the hemisphere, key, and fill lights. Every render path orients that one group: `ViewerSession.render()` sets its quaternion per lighting mode (spindle frame or camera), `advance()` slerps it through the axis tween, `orbit()`/`zoom()` snap it on cancel, and `renderThumbnail` orients it identically for the offscreen path. The thumbnail cache records the `lighting` mode a PNG was rendered with; a mismatched or absent value is treated as stale pixels over good camera state (model-thumbnails "Lighting-mode-aware thumbnails").

## Goals / Non-Goals

**Goals:**
- Red rim from the left, blue from the right, in both lighting modes, overlay and lightbox and thumbnails alike.
- `camera` mode: accents fixed to the screen while the model orbits. `axis` mode: accents fixed to the spindle frame, turning with it.
- Every cached thumbnail refreshes lazily to the new rig, keeping the no-brightness-shift handoff guarantee.

**Non-Goals:**
- A toggle for the accents — they are part of the rig, not a new mode.
- Rebalancing the existing three lights; their parameters stay untouched.
- Eager cache invalidation — the lazy visit-time sweep is the recorded pattern.

## Decisions

### D1: Rim lights are children of the existing rig Group

Two `DirectionalLight`s added in `makeScene` beside the current three: red at rig-space −X and slightly behind the subject (negative x, negative z), blue mirrored at +X, both aimed at the origin like the key and fill (default target). Because the rig's quaternion is the single orientation authority, the accents inherit the axis/camera split, the tween slerp, and the drag-cancel snap with zero new code.

"Left/right" is exact only in `camera` mode, where rig space is camera space by construction: −x̂ is screen-left and −ẑ is behind the subject, at every orbit angle. In `axis` mode the accents are model-fixed — rig-space −X maps to the frame's −a, an arbitrary-but-deterministic direction the model turns through — so their screen position depends on the view: at the default azimuth (π/4) the red accent reads as a back rim and the blue as a right rim, and orbiting swings them around the model. That is the intended semantic (the accents "stay in place" on the model), not a defect; no single rig-space placement can read as left/right in both a 45°-yawed axis view and the camera frame.

Intensities are chosen as accents so they tint edges without shifting overall exposure; exact values were tuned visually at apply time and frozen in the unit test: red `0xff4444` at 1.4, blue `0x3355ff` at 2.5 — blue carries more raw intensity because the hemisphere's cool ground color already tints the scene blue, so equal intensities read as red-dominant.

*Alternative — separate rim group oriented independently:* nothing needs independent orientation; a second group would duplicate the mode/tween/snap logic the rig already centralizes.

### D2: A rig version rides the cache meta, mirroring `lighting` end-to-end

`RIG_VERSION` (exported from renderer.ts, now `2`; the pre-rim rig is implicitly `1`) names the pixel recipe a PNG was rendered with — nominally the rig, but any future render change that alters thumbnail pixels (materials, tone mapping, FOV) SHALL bump the same constant rather than grow a sibling field. `rig?: number` is added to `ThumbPutRequest`/`ThumbGetResponse`/server `Meta`; the server validates it is a number on PUT, stores it under the same "describes the pixels" rule as `lighting` (a PNG-replacing put without it clears it, a partial put preserves it), and echoes it on reads without interpreting it. The client's render-needed test becomes: hit AND png present AND `lighting === active mode` AND `rig === RIG_VERSION`; anything else takes the existing re-render path (camera/axis kept, stale PNG held as fallback until the replacement lands). Absent covers every pre-rim entry, so the first visit after upgrade sweeps a directory once and subsequent visits are hits again — exactly the lighting-mode precedent.

*Alternative — new `lighting` values like `'axis2'`:* conflates a user choice with a client implementation detail and breaks the stored mode's meaning; a separate integer stays orthogonal and covers future rig revisions.

### D3: The historical-identity spec claim narrows to orientation

"Default `y` axis is pixel-identical to the historical rig" was load-bearing while only orientation changed; rim lights intentionally change pixels for every model. The model-viewer requirement is amended: the *base* rig (hemisphere, key, fill) keeps its historical parameters and its identity orientation under the default spindle, and the rim accents are an acknowledged addition on top. The handoff guarantee (thumbnail matches live view) is unchanged and is what D2 protects.

## Risks / Trade-offs

- [Every directory re-renders its thumbnails once after upgrade] → the bounded render-queue sweep is the recorded pattern (pre-lighting entries did the same); PNGs only, camera state untouched.
- [Colored accents may look wrong on strongly colored models] → intensities are low and the accents are uniform across the app; if the experiment displeases, removing the lights and bumping `RIG_VERSION` rolls every thumbnail forward again.
- [Two browsers on different app versions fight over `rig`] → same accepted churn as the `lighting` field; each lazily re-renders to its own rig on read, camera state never touched.
