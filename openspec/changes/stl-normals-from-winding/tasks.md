# Tasks — stl-normals-from-winding

> Ordering: `RIG_VERSION` is shared, so **re-read its current value in renderer.ts before starting** and bump from whatever is there — ssao's 5 is already in main, and its AO re-tune (if it happens) would take a bump of its own. Archiving order does not matter; the constant does. Re-read models.ts and renderer.ts against main first (parallel sessions). Per D4, the AO constants stay frozen until this lands: they cannot be judged on models whose normals are rotated.

## 1. Parse

- [ ] 1.1 `parseModel`'s STL branch (client/src/three/models.ts): `geometry.deleteAttribute('normal')` then `geometry.computeVertexNormals()` unconditionally, replacing the absent-attribute fallback; the existing `rotateX(-π/2)` and material/shadow wiring stay as they are (D1)
- [ ] 1.2 Bump `RIG_VERSION` 5 → 6 in client/src/three/renderer.ts, extend the version-list doc comment ("6 = STL normals from winding"), update client/test/rig.test.ts (title + pinned value) (D2)

## 2. Tests

- [ ] 2.1 Unit test with an in-memory binary-STL crafting helper (80-byte header, uint32 count, 50-byte facets — documented in the helper): a tetrahedron whose stored normals are winding rotated 90° about X parses to normals matching winding (per-face dot ≈ 1 vs computed facet normals); a healthy twin (stored ≡ winding) parses to identical normals, pinning the no-change property; a third with stored normals zeroed parses to winding normals rather than zeros — the unlit-facet pathology (D3)
- [ ] 2.2 Rewrite the STL-fixture bullet in `client/test/CLAUDE.md`: once parsing ignores stored normals, zero normals no longer render black and inverted *stored* normals no longer mirror lighting — only inverted **winding** can, so that is what a generated fixture has to get right
- [ ] 2.3 Confirm no renderer-mock updates are needed (no new exports); run the full-factory-mock test files to be sure

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual E2E via Playwright MCP: `Radroach_with_base.stl` and `Almenhier_body_32mm_unsupported.stl` lose the over-bright, orbit-shifting lighting in tiles and the lightbox. The sharpest comparison is `Almenhier_base_32mm_unsupported.stl` — same set, same folder, same sculpting pipeline, but a clean normal field — so body and base should finally read as one model under one light; a healthy fixture (Enforcer, 100% agreement) is visually unchanged; thumbnails re-render once (rig 6) and hit thereafter
