# Tasks — rim-lights

## 1. Shared types & server

- [ ] 1.1 Add `rig?: number` to `ThumbPutRequest` / `ThumbGetResponse` in `shared/types.ts` and to `ThumbResult` / `ThumbSave` in `client/src/api/client.ts` (wire mapping both directions)
- [ ] 1.2 Store/echo `rig` in `server/src/cache.ts` `Meta` under the same describes-the-pixels rule as `lighting` (PNG-replacing put without it clears, partial put preserves); validate it is a number in `server/src/app.ts`
- [ ] 1.3 Server tests: `rig` round-trips on put/get, survives camera-only puts, cleared by a png put without it, absent on legacy entries; API rejects a non-numeric `rig`

## 2. Client rig

- [ ] 2.1 Add the red (rig-left, slightly behind) and blue (rig-right, mirrored) rim `DirectionalLight`s to the rig in `makeScene`, tuned visually as accents; export `RIG_VERSION = 2` from `client/src/three/renderer.ts` (D1, D2)
- [ ] 2.2 Unit test: the rig contains the two accents with the expected colors, mirrored positions, equal intensities — and the base three lights' parameters are untouched

## 3. Staleness & persistence

- [ ] 3.1 `useThumbnails`: the render-needed test also requires `cached.rig === RIG_VERSION`; render PUTs carry `rig: RIG_VERSION` (D2)
- [ ] 3.2 `App.tsx` persist PUT carries `rig: RIG_VERSION` (captured with the other pre-await values)
- [ ] 3.3 Client tests: a hit with an old/absent `rig` re-renders preserving camera/axis and PUTs the current version; a matching hit serves directly; apiClient wire fixtures carry `rig`

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Manual E2E via Playwright MCP: thumbnail edge sampling shows red tint at left, blue at right; in `camera` mode the tints stay screen-fixed through an orbit, in `axis` mode they turn with the model; existing cached thumbnails re-render once on revisit and hit thereafter
