# STL Normals From Winding

## Why

Some binary STLs in the wild carry facet normals in a different up-axis convention than their vertices — a Z-up/Y-up export mismatch where a tool rotated the geometry but not the normal field, leaving every stored normal rotated 90° about X. Two library models measure 88.7% (`Radroach_with_base.stl`, 196k facets) and 67.4% (`Almenhier_body_32mm_unsupported.stl`, 2.08M facets) of facets with stored normals more than 60° off their own triangle plane; healthy models measure 0%. `STLLoader` hands those normals straight to the material (the existing `computeVertexNormals` fallback in `parseModel` fires only when the attribute is *absent*, which for binary STLs is never), so lighting is evaluated against wrong directions: the models read inexplicably bright and shift oddly under orbit while their silhouettes, shadows, and AO stay correct — geometry winding in both files is coherent (0% degenerate, 0% flipped, positive signed volume).

## What Changes

- **STL parsing ignores stored facet normals**: `parseModel` discards the normal attribute `STLLoader` builds from the file and recomputes flat facet normals from triangle winding via `computeVertexNormals()` — winding is the authoritative orientation data per the STL spec, and it is what slicers actually print from. Files whose stored normals agree with winding render as before; convention-mismatched files become correct.
- **Two more pathologies fall out of the same path**: zero-length stored normals (`facet normal 0 0 0`, which some exporters write and which render unlit today — the trap recorded in client/test/CLAUDE.md), and isolated stale or inverted facet normals inside otherwise healthy files. The latter is not hypothetical: `3DBenchy.stl`, a well-formed fixture in this repo, carries ~0.1% of facets more than 60° off their own plane, some exactly inverted.
- **Thumbnail refresh via `RIG_VERSION`**: recomputed normals change rendered pixels — materially for convention-mismatched models, slightly for healthy ones whose stored field was rounded (measured mean deviation 0.8° on `3DBenchy.stl`, 0.0° on `Enforcer_Robot_Dog.stl`) — so the shared constant bumps 6 after viewer-ssao's 5, riding the existing lazy re-render sweep.
- Non-STL formats (3MF, OBJ) are untouched: their normals are vertex-level, format-validated data, not a redundant facet field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: ADDED requirement — shading normals for STL models come from triangle winding, never from the file's stored facet normals, so exporter normal-convention mismatches cannot corrupt lighting.

## Impact

- `client/src/three/models.ts` — `parseModel`'s STL branch: delete the loader-provided normal attribute, then `computeVertexNormals()` (the existing absent-attribute fallback becomes the unconditional path for STL).
- `client/src/three/renderer.ts` — `RIG_VERSION` 5 → 6 (with `client/test/rig.test.ts`).
- `client/test/` — unit coverage parsing crafted binary STLs (stored normals rotated 90° about X, stored normals zeroed, and a healthy twin), asserting the parsed geometry's normals match winding, not the file.
- `client/test/CLAUDE.md` — its STL-fixture bullet ("zero normals render black, inverted normals mirror lighting") describes behavior this change removes; after it, only winding direction can mislead a lighting assertion.
- No server, API, cache-schema, or UI changes; the mesh LRU amortizes the recompute cost exactly as it does the parse.
