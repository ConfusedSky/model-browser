# Tasks — viewer-ssao

> Ordering: implement after `viewer-shadows` lands (which follows `rim-lights`) — sequential `RIG_VERSION` bumps and the same render entry points. Re-read renderer.ts and session.ts against main before starting (parallel sessions).

## 1. Composer infrastructure

- [ ] 1.1 Build the composer pair in client/src/three/renderer.ts beside `getRenderer`: lazy live composer (host-sized, resize-guarded) and fixed 512² thumbnail composer, each `RenderPass → GTAOPass → OutputPass` over a `samples: 4` target; per-render re-pointing of pass `scene`/`camera` (D1)
- [ ] 1.2 Switch `renderThumbnail` to the thumbnail composer: `renderToScreen` off, pixel readback from the composer output buffer, drop `encodeSrgbInPlace` from this path (OutputPass now owns sRGB), keep row flip + PNG encode (D2)
- [ ] 1.3 Switch `ViewerSession.render()` to the live composer, preserving the per-frame canvas sizing behavior with the resize guard
- [ ] 1.4 Unit tests: composer chains constructed once and reused across sessions/thumbnails; thumbnail output remains 512² RGBA; no direct `renderer.render` calls remain in either path

## 2. GTAO tuning

- [ ] 2.1 Scale GTAO radius/thickness by staged `bounds.radius` and set the pass's scene clip box from the staged bounds box; tune constants visually on small and large fixtures, then freeze in a unit test (D3)
- [ ] 2.2 Bump `RIG_VERSION` 4 → 5 in renderer.ts (D5)
- [ ] 2.3 Update every full-factory renderer mock with new exports (re-check the file list post-viewer-shadows)

## 3. Verification

- [ ] 3.1 Silhouette-halo check *before* the version bump ships: render a fixture thumbnail with and without AO, assert silhouette-adjacent pixels show no darkening beyond tolerance; if it fails, depth-mask the AO application and re-verify (D4)
- [ ] 3.2 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.3 Manual E2E via Playwright MCP: crevices visibly darkened in tiles and lightbox; overlay handoff shows no AO or brightness pop (D5's arbiter); thumbnails re-render once (rig 5) and hit thereafter; orbiting stays smooth with the queue suspended
