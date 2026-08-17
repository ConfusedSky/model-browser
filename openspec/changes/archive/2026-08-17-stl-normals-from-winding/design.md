# Design — stl-normals-from-winding

## Context

`parseModel` (client/src/three/models.ts) parses STL bytes with `STLLoader`, falls back to `computeVertexNormals()` only when the normal attribute is absent (models.ts:36 — for binary STLs it never is; the loader always builds one from the file's stored facet normals), then bakes the app's own Z-up → Y-up conversion with `geometry.rotateX(-π/2)`, which rotates positions and normals together. That last point matters: the app's axis handling is sound — the corruption in the affected files exists *inside* the file, where the stored normal field is rotated 90° about X relative to the vertex field (verified byte-level on both reported models: stored = `(x, z, −y)` of the winding normal, the Z-up/Y-up mismatch signature). Every downstream consumer — `MeshStandardMaterial` lighting, GTAO's normal prepass — reads the parsed attribute, so the corruption propagates to shading while silhouettes, shadow maps (depth-based), and camera framing stay correct.

## Goals / Non-Goals

**Goals:**
- STL shading normals always agree with the triangle geometry, regardless of what the file's normal field claims.
- A file whose stored normals agree with its winding renders as before, to within the precision it stored them at; the LRU/parse cost profile is unchanged in shape.

**Non-Goals:**
- Repairing winding itself (inside-out meshes): winding is treated as authoritative; both reported files have coherent winding (positive signed volume, 0% flipped), and winding repair is a mesh-processing problem out of scope for a browser.
- Touching 3MF/OBJ parsing: their normals are vertex-level format data, not a redundant facet field.
- Smooth shading: `STLLoader` output is non-indexed, so `computeVertexNormals()` yields flat facet normals — the current look.

## Decisions

### D1: Discard stored normals unconditionally, not conditionally

`parseModel`'s STL branch becomes: `geometry.deleteAttribute('normal')` then `geometry.computeVertexNormals()` (before the existing `rotateX`, though order is immaterial — `rotateX` transforms both attributes consistently). The absent-attribute fallback disappears into the unconditional path.

*Alternative — sample-and-validate (recompute only when ~200 sampled facets disagree with winding):* keeps byte-identical output for healthy files but adds a heuristic with a threshold to tune, a second code path to test, and a class of files that flips behavior when a sample lands badly. Rejected: the unconditional recompute is one pass over a buffer the parser just built (measured cost is a fraction of parse itself), `computeVertexNormals` on non-indexed geometry produces exactly the winding normal per face — which a healthy file's stored field matches to the precision it was stored at (measured mean deviation 0.0° on `Enforcer_Robot_Dog.stl`; 0.8° on `3DBenchy.stl`, whose field is slightly rounded and ~0.1% stale) — and trusting derived-from-geometry data over exporter-asserted data removes an input-trust dependency outright. The STL spec itself designates winding as authoritative and requires the stored normal to agree with it; when they disagree, the file is wrong, not ambiguous.

### D2: `RIG_VERSION` bumps 5 → 6

Recomputed normals change rendered pixels — materially for convention-mismatched models, slightly for healthy ones whose stored field was rounded (the proposal's measured deviations) — and the recorded rule makes no exception for "most models unchanged": the recipe changed, the constant bumps, cached PNGs re-render lazily. Mock/test sweep follows the established pattern (`rig.test.ts` pins the value; spread-based mocks track it automatically).

### D3: The regression test crafts the pathology, not a fixture file

A unit test builds a small binary STL in-memory (a tetrahedron suffices) whose stored normals are the winding normals rotated 90° about X — the exact signature measured in the wild — parses it through `parseModel`, and asserts the resulting normal attribute matches winding (dot ≈ 1 against computed facet normals, for every face). A second assertion parses a healthy twin (stored ≡ winding) and confirms identical normals, pinning the "unchanged where the file agreed" property. A third zeroes the stored normals: the other pathology this path fixes, and the one the repo already documents as rendering black. A fourth inverts a single facet's stored normal in an otherwise healthy file — the isolated-bad-facet case measured on 3DBenchy — and asserts it parses identically to the healthy twin. No binary fixture is checked in; the crafting helper documents the STL layout (80-byte header, uint32 count, 50-byte facets) in one place.

The wild-file measurements the test encodes are worth keeping next to it: stored-vs-winding deviation is 79.5° mean / 88.7% of facets past 60° on `Radroach_with_base.stl` and 66.9° / 67.4% on `Almenhier_body_32mm_unsupported.stl`, with **100.0%** of facets in both matching `(x, z, −y)` of the winding normal — the whole field is rotated, and the sub-100% "past 60°" figures are only where a rotation about X moves a normal that far (normals near ±X are invariant). `Almenhier_base_32mm_unsupported.stl`, in the same folder from the same set, is clean at 100% agreement: the corruption is per-export, not per-artist.

### D4: The ambient-occlusion verdict waits for this change

The complaint that started this — occlusion reading as dirt, lighting reading as "weird" — was raised against `Radroach_with_base.stl` and `Almenhier_body_32mm_unsupported.stl`, i.e. against models whose normals were rotated 90° away from their geometry. AO responds to exactly the normal discontinuities that a corrupt normal field maximizes, so any judgment of `AO_SCALE` or `AO_RADIUS_R` made on those models is evidence about this bug, not about the AO fit. viewer-ssao's constants therefore stay as tuned until this lands; re-judge them afterwards, on models that report their own surface honestly. Editing AO constants first would tune the recipe to compensate for corruption that is about to disappear — and would cost its own `RIG_VERSION` bump to undo.

## Risks / Trade-offs

- [A file whose *winding* is wrong (inside-out regions) previously shaded correctly via good stored normals; recomputing would break it] → accepted as theoretical: such a file prints wrong in any slicer, neither reported file has the property, and the STL spec's authority order (winding first) is the defensible default. If one surfaces, it becomes evidence for a winding-repair change, not a revert.
- [2M-facet models (Almenhier) pay a normals pass per parse] → one linear pass over data already resident, amortized by the mesh LRU exactly like parsing; if profiling ever shows it mattering, the sample-and-validate alternative from D1 is the escape hatch.
- [Colored/attribute-bearing STLs] → `deleteAttribute('normal')` touches only the normal field; `STLLoader`'s color attribute, when present, is preserved untouched.
- [Degenerate facets (duplicate or exactly-collinear vertices) now get zero normals where they previously carried the file's stored normal] → invisible by construction: a zero recomputed normal can only come from an exactly-zero cross product, and a zero-area facet rasterizes to no pixels. Measured across all seven scanned files: 563 such facets in `3DBenchy.stl`, 8 in `model-paint-rack.stl`, every one exactly zero-area; no other file has any.
