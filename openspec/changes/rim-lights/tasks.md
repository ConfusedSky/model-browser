# Tasks — rim-lights

## 1. Shared types & server

- [x] 1.1 Add `rig?: number` to `ThumbPutRequest` / `ThumbGetResponse` in `shared/types.ts` and to `ThumbResult` / `ThumbSave` in `client/src/api/client.ts` (wire mapping both directions)
- [x] 1.2 Store/echo `rig` in `server/src/cache.ts` `Meta` under the same describes-the-pixels rule as `lighting` (PNG-replacing put without it clears, partial put preserves), echoed on hit and both stale branches like `lighting`; validate it is a number in `server/src/app.ts`
- [x] 1.3 Server tests: `rig` round-trips on put/get, survives camera-only puts, cleared by a png put without it, absent on legacy entries, rides along on stale reads; API rejects a non-numeric `rig`

## 2. Client rig

- [x] 2.1 Add the red (rig-left, slightly behind) and blue (rig-right, mirrored) rim `DirectionalLight`s to the rig in `makeScene`, tuned visually as accents; export `RIG_VERSION = 2` from `client/src/three/renderer.ts` (D1, D2)
- [x] 2.2 Unit test: the rig contains the two accents with the expected colors, mirrored positions, equal intensities — and the base three lights' parameters are untouched
- [x] 2.3 Update every test factory that mocks `three/renderer` to export `RIG_VERSION` (`thumbnailQueue`, `flatToggle`, `listingSkeleton`, `orbitHandoff`, `sessionLighting` test files) — full-factory mocks throw on the missing export

## 3. Staleness & persistence

- [x] 3.1 `useThumbnails`: the render-needed test also requires `cached.rig === RIG_VERSION`; render PUTs carry `rig: RIG_VERSION` (D2)
- [x] 3.2 `App.tsx` persist PUT carries `rig: RIG_VERSION` (captured with the other pre-await values)
- [x] 3.3 Client tests: a hit with an old/absent `rig` re-renders preserving camera/axis and PUTs the current version; a matching hit serves directly; apiClient wire fixtures carry `rig`

## 4. Verification

- [x] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 4.2 Manual E2E via Playwright MCP: in `camera` mode, thumbnail edge sampling shows red tint at the left edge and blue at the right, and the tints stay screen-fixed through an orbit; in `axis` mode the tinted sides turn with the model during an orbit; existing cached thumbnails re-render once on revisit and hit thereafter
