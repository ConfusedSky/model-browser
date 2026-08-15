# Tasks — stl-normals-from-winding

> Ordering: implement after `viewer-ssao` archives (sequential `RIG_VERSION` bumps: this change takes 5 → 6 only if ssao's 5 has landed — re-check the current value in renderer.ts before starting). Re-read models.ts and renderer.ts against main first (parallel sessions).

## 1. Parse

- [ ] 1.1 `parseModel`'s STL branch (client/src/three/models.ts): `geometry.deleteAttribute('normal')` then `geometry.computeVertexNormals()` unconditionally, replacing the absent-attribute fallback; the existing `rotateX(-π/2)` and material/shadow wiring stay as they are (D1)
- [ ] 1.2 Bump `RIG_VERSION` 5 → 6 in client/src/three/renderer.ts, extend the version-list doc comment ("6 = STL normals from winding"), update client/test/rig.test.ts (title + pinned value) (D2)

## 2. Tests

- [ ] 2.1 Unit test with an in-memory binary-STL crafting helper (80-byte header, uint32 count, 50-byte facets — documented in the helper): a tetrahedron whose stored normals are winding rotated 90° about X parses to normals matching winding (per-face dot ≈ 1 vs computed facet normals); a healthy twin (stored ≡ winding) parses to identical normals, pinning the no-change property (D3)
- [ ] 2.2 Confirm no renderer-mock updates are needed (no new exports); run the full-factory-mock test files to be sure

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual E2E via Playwright MCP: `Radroach_with_base.stl` and `Almenhier_body_32mm_unsupported.stl` shade consistently with neighboring healthy models (no more over-bright, orbit-shifting lighting) in tiles and the lightbox; a healthy fixture (Enforcer) is visually unchanged; thumbnails re-render once (rig 6) and hit thereafter
