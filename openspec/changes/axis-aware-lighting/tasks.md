# Tasks — axis-aware-lighting

## 1. Shared types & server

- [ ] 1.1 Add `LightingMode = 'axis' | 'camera'` and a `lighting?` field to `ThumbPutRequest` / `ThumbGetResponse` in `shared/types.ts`
- [ ] 1.2 Store/echo `lighting` in `server/src/cache.ts` `Meta` (preserve-on-partial-put like `camera`/`axis`) and plumb it through `server/src/app.ts`
- [ ] 1.3 Server tests: `lighting` round-trips on put/get, survives camera-only puts, absent on legacy entries

## 2. Light rig (client)

- [ ] 2.1 Refactor `makeScene` in `client/src/three/renderer.ts`: wrap the three lights in a rig `Group` (identical light params) and return access to it
- [ ] 2.2 Add rig-orientation helper: quaternion from a spindle frame's (a, s, b) basis (design D1) — identity for `y`; unit-test all six spindles for proper rotation + y-identity
- [ ] 2.3 Add `client/src/viewer/lighting.ts`: `getLightingMode`/`setLightingMode`, localStorage-persisted, default `'axis'` (D3)
- [ ] 2.4 `ViewerSession.render()`: orient the rig per active mode — frame quaternion in `axis` mode, `camera.quaternion` in `camera` mode (D2)
- [ ] 2.5 Axis tween: slerp the rig between old/new frame quaternions on the tween clock in `advance()`; snap on drag-cancel (D4); session tests with the injectable clock
- [ ] 2.6 `renderThumbnail`: orient the rig from mode + axis (axis mode) or from the posed rest camera (camera mode)

## 3. Mode toggle & thumbnail staleness

- [ ] 3.1 Experimental lighting pill in `client/src/App.tsx` (`axis` / `camera`), styled after the retired orbit-feel picker
- [ ] 3.2 `useThumbnails`: treat a hit with `lighting !== active mode` (or absent) as render-needed — keep camera/axis, re-render and PUT with `lighting`; include `lighting` in the orbit-release persist PUT
- [ ] 3.3 Client tests: hit-with-mismatched-mode re-renders while preserving camera; PUTs carry the active mode

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Manual E2E via Playwright MCP: override a model's axis to X/Z — tile thumbnail and lightbox show top-lit shading relative to the new spindle; axis change animates lighting smoothly
- [ ] 4.3 Manual E2E: switch to `camera` mode — orbiting keeps the lit side facing the viewer; revisit the directory and confirm thumbnails re-render once, keeping orientation; overlay handoff shows no brightness shift in either mode
