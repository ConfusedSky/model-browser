# Tasks — viewer-shadows

> Ordering: implement only after `rim-lights` lands — this change bumps the `RIG_VERSION` it introduces and edits the same `makeScene`/mock files. Re-read renderer.ts, session.ts, and the mock factories against main before starting (parallel sessions).

## 1. Geometry & staging

- [ ] 1.1 Extend `boundsOf` (client/src/three/camera.ts) to also return the measured `Box3`; update the `Bounds` interface and existing call sites
- [ ] 1.2 Add `stageModel(lit, object, axis)` to client/src/three/renderer.ts: pivot group, raw-bounds measure, `pivot.position = −center`, centered bounds returned with the translated box (D1, D4)
- [ ] 1.3 Rework `renderThumbnail` and the `ViewerSession` constructor to stage via `stageModel`; restore/detach paths use the pivot (`originalParent?.add` reparent, `pivot.remove` when parentless; `close()` detaches from the pivot)
- [ ] 1.4 Unit tests: staged bounds center at origin regardless of raw geometry offset; thumbnail borrow of a live-session object still restores its original parent

## 2. Shadow mapping

- [ ] 2.1 Enable PCF-soft `shadowMap` in `getRenderer`; set `castShadow`/`receiveShadow` on meshes in client/src/three/models.ts
- [ ] 2.2 In `stageModel`, fit the key light: `position.setLength(k·radius)` (direction preserved), ortho frustum ≈ ±2·radius, near/far spanning, `normalBias` ∝ radius, ~2048 map — tune constants visually on small and large fixtures, then freeze (D2)
- [ ] 2.3 Bump `RIG_VERSION` 2 → 3 in renderer.ts (D4)
- [ ] 2.4 Unit tests: only the key casts; frustum/bias scale linearly between a radius-1 and radius-100 stage; key direction unchanged by the fit

## 3. Contact floor

- [ ] 3.1 In `stageModel`, build the `ShadowMaterial` floor: perpendicular to `frameFor(axis).s`, at the box face minimizing `dot(p, s)` minus ε·radius, sized ≈ 8·radius, `receiveShadow` only, added to the scene after bounds measurement (D3)
- [ ] 3.2 `ViewerSession.setAxis` snaps the floor to the new spindle via the floor handle; `close()` disposes floor geometry and material
- [ ] 3.3 Unit tests: floor position/orientation correct for all six spindles on an asymmetric box; disposed on close; absent from bounds

## 4. Mocks & verification

- [ ] 4.1 Add `stageModel` (and any other new exports) to every full-factory renderer mock (`thumbnailQueue`, `flatToggle`, `listingSkeleton`, `orbitHandoff`, `sessionLighting` test files — re-check the list post-rim-lights)
- [ ] 4.2 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.3 Manual E2E via Playwright MCP: contact shadow visible under a model in tile thumbnails and the lightbox; orbiting in `camera` mode sweeps the shadow, in `axis` mode it stays put; axis change relocates the floor; cached thumbnails re-render once (rig 3) and hit thereafter; overlay handoff shows no shadow pop
