# Design — double-sided shading

## Context

See proposal.md for why. `parseModel` already discards stored STL normals and recomputes from winding (`stl-normals-from-winding` D1). That is the right parse. The remaining failure is rasterization: `makeMaterial` builds a `MeshStandardMaterial` at the default `FrontSide`, so an inward-wound facet is culled and the viewer sees the interior of the far side.

Three.js already lights the visible face when both sides draw. `normal_fragment_begin.glsl.js` multiplies the normal by `gl_FrontFacing ? 1.0 : -1.0` under `DOUBLE_SIDED`. Setting `side: THREE.DoubleSide` is therefore a lighting fix, not just a culling fix.

Two other pipelines still use `FrontSide` even after the material change:

- `GTAOPass` constructs `this.normalMaterial = new MeshNormalMaterial()` with no `side` argument. The AO prepass is an `overrideMaterial` render, so it ignores the mesh material's `side`. On an inverted mesh it culls the near surface and writes the far interior into the normal buffer.
- Shadow maps. With `material.shadowSide === null`, `WebGLShadowMap` maps `{[FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide}`. Today's front-side material therefore renders back faces into the shadow map (the usual acne dodge). After DoubleSide, the nearest surface writes depth instead. `withShadows` already sets `castShadow`/`receiveShadow` on every mesh. The contact floor is a separate `ShadowMaterial` plane and stays FrontSide.

`RIG_VERSION` is 7 (`rig.test.ts`). Re-read it before bumping.

## Goals / Non-Goals

**Goals:**

- Inverted and mixed-winding meshes read as solid in thumbnails, overlay, and lightbox, with lighting, AO, and shadows taken from the visible surface.
- Well-wound meshes stay solid. Pixel shift from double-siding is accepted and versioned.
- The GTAO prepass and the shadow map use the same side rule as the colour pass.

**Non-Goals:**

- Repairing winding in the browser. No vertex-order rewrite, no signed-volume test, no "this file is inverted" badge. The corpus script keeps doing that job for the miniatures tree.
- STL-only double-siding. `makeMaterial` is the one factory; the GLB delivery path uses it too.
- Retuning `AO_*` or `SHADOW_*` constants unless the visual pass shows a real regression.
- A performance toggle for double-siding. The occlusion pill already exists for the GPU path that feels GTAO.

## Decisions

### D1: Double-side in `makeMaterial`, every format

`makeMaterial` gains `side: THREE.DoubleSide` and `shadowSide: THREE.DoubleSide`. STL, GLB, OBJ, and 3MF all go through it. The GLB arm exists so a cached STL delivery shades identically to the STL arm (`parseModel glb arm matches the stl arm`); splitting the material by format would break that and leave inverted OBJ/3MF hollow.

*Alternative — STL and GLB only:* a second factory or a flag on `parseModel`. Rejected: one factory is the point of `makeMaterial`, and inverted 3MF/OBJ is the same visual bug.

*Alternative — detect inverted meshes and double-side those:* needs a heuristic (signed volume, or a sample of `gl_FrontFacing`). The issue's 157 files are mostly patches, not whole-body inversions, so a volume test misses the mixed case that DoubleSide handles per fragment. Rejected.

`shadowSide` is set explicitly rather than left `null`. The null fallback currently maps DoubleSide → DoubleSide, but a test that pins `material.shadowSide === THREE.DoubleSide` does not depend on `WebGLShadowMap` keeping that table. The floor's `ShadowMaterial` is untouched.

### D2: Set `aoPass.normalMaterial.side` in `makeChain`

After `new GTAOPass(...)`, set `aoPass.normalMaterial.side = THREE.DoubleSide`. `makeChain` builds both the live and thumbnail composers, so one assignment covers both. `GTAOPass` does not take a normal material in its constructor (three 0.172); this is the supported hook.

*Alternative — disable AO on inverted meshes:* no detector exists, and it would desync the `ao` recipe from the colour pass.

Do not pass `distanceFallOff` into `updateGtaoMaterial`. That still flags a shader rebuild per frame.

### D3: Do not retune shadow bias unless the visual pass shows acne

`SHADOW_NORMAL_BIAS_R = 0.02` was tuned for back-face shadow maps (`viewer-shadows`). Double-sided shadow maps write the nearest surface, which is the case that bias exists to protect. Re-judge on a flat-faced print and an organic miniature, overlay and lightbox, occlusion on and off. Change the constant only if speckling or a detached contact shadow shows up; a change is another `RIG_VERSION` bump on top of D4, so do not preempt it.

### D4: `RIG_VERSION` bumps one step

Pixels change for every model. Re-read the live constant in `renderer.ts` and bump from whatever is there. `rig.test.ts` pins the value; spread-based mocks track it. Same rule as `stl-normals-from-winding` D2.

### D5: Unit tests craft the pathology; Playwright uses a confirmed inverted file

Unit tests assert material state, not pixels (vitest has no WebGL). `models.test.ts` already parses a one-triangle STL; extend it to pin `side` and `shadowSide` on the STL and GLB arms. `composer.test.ts` already reaches `GTAOPass` on both chains; pin `normalMaterial.side`. `stlNormals.test.ts` stays: winding is still the source of the normal attribute. No binary fixture is checked in.

Playwright is the pixel proof. The Lady Dwarf copies named in issue #31 have already been rewritten by corpus preprocessing and are not a gate. The confirmed inverted file on this machine is the demo-corpus copy at library path `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Crown_Alternate_28mm.stl` (directory spelled `Mounument`). Open it in overlay and lightbox, occlusion on and off; it must read as a solid near surface. Control: `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Middle.stl` (outward-wound; do not use `FOUNTAIN_Crown_52mm.stl`, which is inverted too). If the fountain gate is later repaired, fall back to a crafted inward-wound STL in a temp `MODEL_BROWSER_ROOT` (swap two vertices per facet on the `craftStl` layout in `stlNormals.test.ts`). Rewrite the CLAUDE.md Testing bullet that currently says inverted winding "mirrors lighting left/right"; after this change it does not.

### D6: Frame time is recorded, not a ship gate

Double-siding doubles rasterised fragments on opaque geometry, and the AO prepass alongside it. Time a lightbox orbit on a heavy miniature with occlusion on, after the persist settle (~5s, CLAUDE.md). Write the number on the tasks line. Do not add a toggle and do not block the change on the 780M's 17→56 fps GTAO figure; that figure is the occlusion pill's reason to exist, and the pill still turns GTAO off. Revisit only if the unoccluded path is the one that becomes unusable.

### D7: One change, one PR

`RIG_VERSION` versions the material, the AO prepass, and the shadow map as one recipe. Splitting them would ship a bump that does not match the pixels, or pixels that do not match the bump. Implementation is one worker, one commit. Review can fan out; coding should not.

## Risks / Trade-offs

- [Double fragment cost on every model, including healthy ones] → accepted. Recorded under D6. The occlusion pill remains the GPU escape hatch.
- [Hollowed-print cavities that *should* read as open shells now shade on the back face] → accepted. A correctly wound hollow mesh already has inner-wall fronts facing the cavity; DoubleSide only adds the back of each wall, which an opaque material hides unless the camera is inside. The corpus repair already left 322 such components alone; this change does not try to tell them apart from inverted solids.
- [Shadow acne or peter-panning on flat beds after the map stops using back faces] → D3. Visual pass on a flat-faced model before the tasks line closes.
- [A well-wound model's pixels shift slightly] → that is why D4 bumps `RIG_VERSION`. The winding spec's "renders as before" / "rendered output is unchanged" wording is dropped in this change's MODIFIED block because it has been false since every later recipe bump, and it would be false again here.
- [Hides the defect] → accepted, as the issue stated. Corpus repair stays. No in-viewer marker.
- [Active `adaptive-ao-default` is deferred and does not bump `RIG_VERSION`] → no file collision. Re-read `renderer.ts` anyway; the constant is shared.

## Migration Plan

Lazy. Existing cache entries carry the old `rig` and re-render on next display. No bake, no server restart, no config key. Rollback is revert; the previous `RIG_VERSION` is then current again and old renders start hitting.

## Open Questions

None. The issue named the three sites (material, GTAO prepass, shadows) and the version bump. D1–D7 pin the rest.
