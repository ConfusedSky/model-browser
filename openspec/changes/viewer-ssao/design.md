# Design — viewer-ssao

## Context

Every pixel the app produces comes from two direct `renderer.render` calls on the shared singleton: `ViewerSession.render()` (client/src/viewer/session.ts) sizes the canvas and renders to screen, and `renderThumbnail` (client/src/three/renderer.ts) renders into a hand-built 512² `WebGLRenderTarget` (`samples: 4`), reads pixels back, applies `encodeSrgbInPlace` (client/src/three/srgb.ts) because target readback is linear while the canvas gets sRGB output encoding, flips rows, and encodes a PNG. The clear is transparent (`setClearColor(0x000000, 0)`); thumbnails composite over the app background. D2/D3 fix exactly one `WebGLRenderer` app-wide. Ambient occlusion is a screen-space post-process, so it forces this architecture's first `EffectComposer` — the design problem is introducing it without a second context, without breaking the readback path, and without violating the thumbnail/live handoff guarantee.

Ordering: implemented after `viewer-shadows` (itself after `rim-lights`); all three bump the shared `RIG_VERSION` sequentially and touch the same render entry points.

## Goals / Non-Goals

**Goals:**
- Crevice-darkening AO in the orbit overlay, lightbox, and thumbnails, visually consistent across all three.
- Bounds-scaled parameters: equal depth-cueing for a 5 mm miniature and a 300 mm bust.
- No dark halos where the model silhouette meets the transparent background — thumbnails composite cleanly.
- One WebGL context, unchanged (D2/D3); the render queue's suspend/resume behavior unchanged.

**Non-Goals:**
- Baked or per-vertex AO (STLs have no UVs; raycast bakes are a different, offline-shaped feature).
- Tone-mapping changes or any other new post effects — the composer chain is render → AO → output, nothing else.
- A user toggle; AO joins the rig recipe like rim lights and shadows.

## Decisions

### D1: Two long-lived composers on the shared renderer — live (host-sized) and thumbnail (fixed 512²)

Both live beside `getRenderer` in renderer.ts, created lazily, each with an explicitly constructed `samples: 4` color target so today's MSAA is preserved — `EffectComposer`'s own default target is single-sample *and* `HalfFloatType`, which is why neither composer may take it. The chain is `RenderPass → GTAOPass → OutputPass`. Per render, the passes' `scene`/`camera` references are re-pointed at the active session's (both passes expose them as mutable properties) — composers and their internal targets are renderer-scoped, not per-model, so opening an overlay allocates nothing. The live composer `setSize`s only when host dimensions actually change (a guard — `ViewerSession.render()` currently calls `renderer.setSize` every frame; resizing composer targets every frame would reallocate constantly). The thumbnail composer replaces the hand-built target: render via composer with `renderToScreen` off, read pixels back, keep the row flip and PNG encode. Two specifics the readback depends on, both easy to get wrong once and hard to see afterwards: its target must be `UnsignedByteType` (`readRenderTargetPixels` into a `Uint8Array` requires an 8-bit target — half-float, the composer default, is what the live composer may keep), and the buffer holding the finished frame is `composer.readBuffer`, since `OutputPass` leaves `needsSwap` at the `Pass` default and the composer swaps after it.

*Alternative — one composer resized per use:* thrashes target allocation on every thumbnail↔live alternation, which the render queue does constantly. *Alternative — composer per ViewerSession:* per-open allocation and VRAM churn for zero benefit; the singleton renderer already forces serialized use.

### D2: sRGB conversion moves into `OutputPass`; `encodeSrgbInPlace` leaves the thumbnail path

Today's manual encode exists because raw target readback is linear. `OutputPass` performs the linear→sRGB conversion in-shader (with tone mapping left at the renderer default, none), so the thumbnail composer's output buffer already holds sRGB pixels that match what the canvas shows — the readback uses them as-is. The live composer's `OutputPass` renders to screen, replacing the implicit canvas output encoding with the explicit same conversion; live and thumbnail pixels stay identical by construction, which is the handoff guarantee's foundation.

`renderThumbnail` is `encodeSrgbInPlace`'s only production caller (renderer.ts), so `client/src/three/srgb.ts` and `client/test/srgb.test.ts` are deleted with it rather than left as a module kept alive by its own test. The conversion it performed is not lost — `OutputPass` does it in-shader, and the handoff E2E is what proves the two agree. If AO is ever backed out, restoring the manual encode is a `git revert` of this change, not a reason to carry dead code.

*Alternative — keep raw readback + manual encode after the composer:* the composer's final swap buffer is not guaranteed linear once OutputPass runs; double-encoding is exactly the class of brightness-shift bug the handoff guarantee exists to prevent.

### D3: three's in-tree `GTAOPass`, parameters scaled by `bounds.radius`

`GTAOPass` (three/examples/jsm/postprocessing) over the older `SSAOPass`/`SAOPass` (noisier, deprecated-adjacent) and over N8AO (better tuned out of the box, but an external dependency this project otherwise avoids — revisit at apply if GTAO's quality disappoints at 512²). AO radius/thickness are world-space quantities, so the pass is tuned per staged model: radius and thickness proportional to `bounds.radius`, and the pass's scene clip box set from the staged (origin-centered, per viewer-shadows D1) bounds box — constants tuned visually at apply, then frozen in the unit test, exactly the shadow-fit precedent.

### D4: Transparent-edge safety is an acceptance criterion, not a hope

The clear is alpha-0 and thumbnails are PNGs composited over the app background; screen-space AO near silhouettes can darken partially-covered edge pixels into visible halos that would be baked into every cached thumbnail. Background pixels carry far-plane depth, for which GTAO produces no occlusion, so the expected steady state is clean — but this is verified, not assumed: the E2E pass samples silhouette-adjacent pixels in a produced thumbnail and asserts no darkening beyond tolerance versus a no-AO render. If halos appear, the AO application is masked by depth (background texels excluded from both occlusion and denoise blur) before any parameter tuning.

The check asserts **alpha as well as darkness**, because the two failure modes are independent and only one of them shows up as darkening. `GTAOPass` composites with `CustomBlending` that multiplies destination by source on the alpha channel too (`blendSrcAlpha: DstAlphaFactor`, `blendDstAlpha: ZeroFactor`); with the AO/denoise shaders writing `alpha = 1.0` the arithmetic preserves both ends — background `0 × 1 = 0`, model `1 × 1 = 1` — but a shader writing less than 1 erodes the model into translucency (the background, multiplied from 0, cannot be hurt by this blend — though the D4 depth-mask fallback replaces the blend, and this same assertion is what guards that path), and a *darkness* comparison over a transparent background can pass while that is happening. So the assertion is: background texels stay alpha 0, model-interior texels stay alpha 255, silhouette texels gain no darkening.

### D5: `RIG_VERSION` bumps to 5; mocks and ordering follow the established pattern

AO changes every model's pixels → the shared constant bumps once (4 → 5 after viewer-shadows, which ended at 4 via its floor-opacity tuning), riding the lazy re-render sweep; no cache-field or server changes. Renderer-mock factories gain whatever new exports the composer introduces (same sweep as rim-lights 2.3 / viewer-shadows 4.1). Screen-space AO is resolution-dependent, so a 512² thumbnail and a differently-sized live host can disagree subtly at handoff even with identical world-space parameters; world-space radius scaling keeps the difference below perception in practice, and the handoff E2E (no-shift check) is the arbiter — if it fails, AO resolution is pinned per-axis to the host's smaller dimension rather than weakening the guarantee.

## Risks / Trade-offs

- [GTAO adds depth/normal pre-passes plus AO+denoise per frame — a multiple of today's cost on million-triangle STLs] → the queue is already async and suspends during interaction; AO output scale is the single knob if weak GPUs struggle; N8AO swap is the escape hatch for quality-per-cost.
- [MSAA color target with a non-MSAA AO depth pass can shimmer at geometric edges] → GTAO's own targets are single-sample by design in three; denoise blurs the residue; verified visually at apply.
- [Composer buffers add VRAM (host-sized ×2 + 512² ×2 + GTAO internals)] → renderer-scoped constants, not per-model growth; the mesh LRU budget (D5) is untouched.
- [Halo edges bake into cached PNGs before anyone notices] → D4's E2E assertion runs before the `RIG_VERSION` bump lands, so no sweep re-caches halos.
- [Three changes serially rewrite the same render entry points while parallel sessions run] → hard ordering rim-lights → viewer-shadows → viewer-ssao; re-read renderer.ts/session.ts against main at apply start (recorded workflow rule).
- [`GTAOPass` API drift across three versions (it is examples/, not core)] → pin exact usage at apply against the repo's three version; the pass wraps cleanly behind the composer helper in renderer.ts, so a swap (e.g. to N8AO) touches one file.

## Open Questions

- Whether GTAO's denoiser reads acceptably at 512² thumbnail scale, where a blurred AO can look like dirt — judged at apply; the N8AO fallback is pre-approved by D3 if not.
