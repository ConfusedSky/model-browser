# Tasks — viewer-shadows

> Ordering: implement only after `rim-lights` lands — this change bumps the `RIG_VERSION` it introduces and edits the same `makeScene`/mock files. Re-read renderer.ts, session.ts, and the mock factories against main before starting (parallel sessions).

## 1. Geometry & staging

- [x] 1.1 Extend `boundsOf` (client/src/three/camera.ts) to also return the measured `Box3`; update the `Bounds` interface and existing call sites
- [x] 1.2 Add `stageModel(lit, object, axis)` to client/src/three/renderer.ts: pivot group, raw-bounds measure, `pivot.position = −center`, centered bounds returned with the translated box (D1, D4)
- [x] 1.3 Rework `renderThumbnail` and the `ViewerSession` constructor to stage via `stageModel`; restore/detach paths use the pivot (`originalParent?.add` reparent, `pivot.remove` when parentless; `close()` detaches from the pivot)
- [x] 1.4 Unit tests: staged bounds center at origin regardless of raw geometry offset; thumbnail borrow of a live-session object still restores its original parent

## 2. Shadow mapping

- [x] 2.1 Enable PCF-soft `shadowMap` in `getRenderer`; set `castShadow`/`receiveShadow` on meshes in client/src/three/models.ts
- [x] 2.2 In `stageModel`, fit the key light: `position.setLength(k·radius)` (direction preserved), ortho frustum ≈ ±2·radius, near/far spanning, `normalBias` ∝ radius, ~2048 map — tune constants visually on small and large fixtures, then freeze (D2)
- [x] 2.3 Bump `RIG_VERSION` 2 → 3 in renderer.ts (D4)
- [x] 2.4 Unit tests: only the key casts; frustum/bias scale linearly between a radius-1 and radius-100 stage; key direction unchanged by the fit

## 3. Contact floor

- [x] 3.1 In `stageModel`, build the `ShadowMaterial` floor: perpendicular to `frameFor(axis).s`, at the box face minimizing `dot(p, s)` minus ε·radius, sized ≈ 8·radius, `receiveShadow` only, added to the scene after bounds measurement (D3)
- [x] 3.2 `ViewerSession.setAxis` snaps the floor to the new spindle via the floor handle; `close()` disposes floor geometry and material
- [x] 3.3 Unit tests: floor position/orientation correct for all six spindles on an asymmetric box; disposed on close; absent from bounds

## 4. Rim-comparison toggle (verification scaffolding, D5)

- [ ] 4.1 Add an in-memory rim-shadows flag (lighting.ts pattern, not persisted, default OFF — the shipped recipe casts from the key alone); `ViewerSession` applies it per render as `castShadow` on the two rim lights, and `stageModel` fits the rim shadow cameras alongside the key's so enabled rim shadows are well-formed at any model size — `renderThumbnail` never consults the flag
- [ ] 4.2 Add the toggle control to the viewer UI (lighting-pill precedent, App.tsx) labeled as a shadow toggle ("rim shadows"), wired to the render-on-toggle effect so the change shows without a drag
- [ ] 4.3 With shadows tuned (2.2), compare key-only vs. key+rim shadow casting on a small and a large fixture in both lighting modes; record the verdict in design.md (Open Questions)
- [ ] 4.4 After the verdict: remove the toggle (flag, UI control, session hook) before archive — rim removal or toggle promotion, if chosen, each become their own follow-up change

## 5. Mocks & verification

- [x] 5.1 Add `stageModel` (and any other new exports) to every full-factory renderer mock (`thumbnailQueue`, `flatToggle`, `listingSkeleton`, `orbitHandoff`, `sessionLighting` test files — re-check the list post-rim-lights)
- [x] 5.2 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 5.3 Manual E2E via Playwright MCP (rims at default/on except where noted): contact shadow visible under a model in tile thumbnails and the lightbox; orbiting in `camera` mode sweeps the shadow, in `axis` mode it stays put; axis change relocates the floor; cached thumbnails re-render once (rig 3) and hit thereafter; overlay handoff shows no shadow pop; rim-shadow toggle flips rim shadow casting in the live view only (cached thumbnail unchanged)
