# Double-sided shading

## Why

Some STLs wind triangles inward, so after `parseModel` discards stored normals and recomputes from winding the visible surface is the back face, which `FrontSide` culls. Those models render as a hollow shell lit from inside. Issue #31 reported two Lady Dwarf files; those copies have since been rewritten in the corpus preprocessing step. The live inverted case on this machine is `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Crown_Alternate_28mm.stl` (kit name is spelled `Mounument` on disk). `stl-normals-from-winding` named this class of file and set it aside as theoretical; a corpus scan of 3,404 miniatures found 157 models with inward winding somewhere, mostly patches rather than a whole-body inversion. Corpus-side repair cannot reach a user's own disk, which is the case this change covers.

## What Changes

- **Materials shade both sides.** `makeMaterial` sets `side: THREE.DoubleSide`. Three.js already flips the fragment normal via `gl_FrontFacing`, so lighting is correct on the visible face of an inverted or mixed-winding mesh, not only on a clean inversion.
- **The GTAO normal prepass matches.** `GTAOPass` builds its own `MeshNormalMaterial` at the default `FrontSide`. On an inverted mesh that writes the far interior into the AO buffer. `aoPass.normalMaterial.side` is set to `DoubleSide` in `makeChain`.
- **Shadow maps follow.** `makeMaterial` also sets `shadowSide: THREE.DoubleSide` (explicit, not the null fallback). The nearest surface writes depth instead of the usual back-face acne dodge. The existing `SHADOW_NORMAL_BIAS_R` is re-judged on the live view; it is not retuned unless acne or peter-panning shows up.
- **`RIG_VERSION` bumps.** Pixels change on every model, inverted or not. Re-read the live constant before writing; `rig.test.ts` currently pins 7.
- **No winding repair, no inverted-file badge.** The viewer hides the defect. The corpus script keeps repairing what it is confident about. The two are complementary, not alternatives.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: **ADD** *Models shade double-sided* — materials, the GTAO normal prepass, and shadow maps all draw both sides, so an inverted or mixed-winding mesh no longer reads as a hollow shell. **MODIFY** *STL shading normals derive from winding*: the requirement body says a well-formed file "produces the same normal attribute" rather than "renders as before", and the well-formed scenario drops "and the rendered output is unchanged". Winding stays the source of the normal attribute; those pixel-identity claims have been false since later recipe bumps and would be false again here.

## Impact

Client only.

- `client/src/three/models.ts` — `makeMaterial` (shared by the STL, GLB, OBJ, and 3MF arms of `parseModel`).
- `client/src/three/renderer.ts` — `makeChain` (both live and thumbnail GTAO passes), `RIG_VERSION`.
- `client/test/models.test.ts`, `client/test/composer.test.ts`, `client/test/rig.test.ts`.
- Playwright E2E against `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Crown_Alternate_28mm.stl` (confirmed inverted) and `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Middle.stl` as the well-wound control. Unit tests pin `side`/`shadowSide` on the existing STL and GLB parses; they do not add an inverted-winding fixture. A crafted inward-wound STL is the Playwright fallback only, if the fountain gate is later repaired, and is not checked into the repo.
- No server, wire, cache schema, or UI change. The GLB delivery path is geometry-only; it picks up the material from `makeMaterial` the same way the STL arm does.
- **Demo box:** re-bake before deploy. `thumbWrites` is off, so a `RIG_VERSION` bump is a miss on every baked tile and `check-bake.sh` refuses the redeploy until the store matches (`deploy/demo/README.md`). Dev with writes on is still lazy.

**Ordering.** Independent of `adaptive-ao-default` (deferred, no `RIG_VERSION` bump, different files). Re-read `models.ts` and `renderer.ts` against main before applying: `RIG_VERSION` is shared and other sessions may have bumped it.
