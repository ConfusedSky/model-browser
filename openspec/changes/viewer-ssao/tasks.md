# Tasks — viewer-ssao

> Ordering: implement after `viewer-shadows` lands (which follows `rim-lights`) — sequential `RIG_VERSION` bumps and the same render entry points. Re-read renderer.ts and session.ts against main before starting (parallel sessions).

## 1. Composer infrastructure

- [x] 1.1 Build the composer pair in client/src/three/renderer.ts beside `getRenderer`: lazy live composer (host-sized, resize-guarded) and fixed 512² thumbnail composer, each `RenderPass → GTAOPass → OutputPass` over an explicitly constructed `samples: 4` target — never `EffectComposer`'s default, which is single-sample half-float — with the thumbnail composer's target pinned to `UnsignedByteType` for readback; per-render re-pointing of pass `scene`/`camera` (D1)
- [x] 1.2 Switch `renderThumbnail` to the thumbnail composer: `renderToScreen` off, pixel readback from `composer.readBuffer` (`OutputPass` swaps), keep row flip + PNG encode; drop `encodeSrgbInPlace` from this path and delete `client/src/three/srgb.ts` with `client/test/srgb.test.ts` — `renderThumbnail` is its only production caller and OutputPass now owns the conversion (D2)
- [x] 1.3 Switch `ViewerSession.render()` to the live composer, preserving the per-frame canvas sizing behavior with the resize guard
- [x] 1.4 Unit tests: composer chains constructed once and reused across sessions/thumbnails; thumbnail output remains 512² RGBA; no direct `renderer.render` calls remain in either path

## 2. GTAO tuning

- [x] 2.1 Scale GTAO radius/thickness by staged `bounds.radius` and set the pass's scene clip box from the staged bounds box; tune constants visually on small and large fixtures, then freeze in a unit test (D3) — *tuned 2026-08-14 on all six e2e fixtures: `AO_SCALE` 1 → 1.5 (crevices now read at thumbnail size — the test cube's embossed digits resolve through AO alone); reach/thickness/falloff/samples kept at the defaults (0.15/0.3/1/16) — the reach doubles as the clip-box feather, and the edge gate stayed clean without widening it. Frozen in composer.test.ts* — **code landed, visual tuning outstanding**: the bounds-scaled fit and clip box are wired through `AO_RADIUS_R`/`AO_THICKNESS_R`/`AO_SCALE`/`AO_DISTANCE_EXPONENT`/`AO_SAMPLES` in renderer.ts and frozen at pre-tuning defaults in test/composer.test.ts; tuning is a constants-only edit plus a re-freeze
- [x] 2.2 Bump `RIG_VERSION` 4 → 5 in renderer.ts (D5)
- [x] 2.3 Update every full-factory renderer mock with new exports (re-check the file list post-viewer-shadows)

## 3. Verification

- [x] 3.1 Silhouette and transparency check *before* the version bump ships: render a fixture thumbnail with and without AO, assert silhouette-adjacent pixels show no darkening beyond tolerance, background texels stay alpha 0, and model-interior texels stay alpha 255 — the alpha half is separate from the darkness half, since GTAO's blend multiplies the alpha channel too; if any of it fails, depth-mask the AO application and re-verify (D4) — *ran 2026-08-14 as an AO_SCALE=0 vs tuned A/B over all six fixture PNGs: zero background-alpha violations, zero silhouette-adjacent alpha gain, zero interior translucency, interior AO darkening 1.2–7.8% (proof the effect was live); passed at both scale 1 and 1.5*
- [x] 3.2 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 3.3 Manual E2E via Playwright MCP: crevices visibly darkened in tiles and lightbox; overlay handoff shows no AO or brightness pop (D5's arbiter); thumbnails re-render once (rig 5) and hit thereafter; orbiting stays smooth with the queue suspended — *verified 2026-08-14: tile↔overlay handoff clips are pixel-indistinguishable (no AO/brightness pop); lightbox shows crevice AO live; thumbnails re-rendered once at rig 5 and hit thereafter; orbit sweeps cleanly with no console errors*

## 4. AO-comparison toggle (verification scaffolding, D6)

- [x] 4.1 In-memory AO flag (`viewer/aoToggle.ts`, rim-shadows pattern, not persisted, default ON — the shipped recipe includes AO); `ViewerSession.render` forwards it to the live chain, whose `render` gains a scaffolding `ao` argument flipping the GTAO pass's `enabled`; `renderThumbnail` never passes it. Scaffolding test `aoToggle.test.ts` pins: default on, the pass skip, live-view forwarding, thumbnails ignoring the flag
- [x] 4.2 "ssao" pill beside the lighting modes (App.tsx, lighting-pill precedent), wired through a ViewerLayer prop to the render-on-toggle effect so the change shows without a drag
- [ ] 4.3 After the verdict: remove the toggle (flag module, pill, ViewerLayer prop, the `ao` render argument, aoToggle.test.ts) before archive — an adverse verdict (no-AO preferred) becomes its own change, not a silent removal
