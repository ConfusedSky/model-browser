## Context

Three continuity defects between the static thumbnail and the live view, with likely mechanisms identified from the code:

1. **Lighting/color mismatch.** Both paths use the same `makeScene()` lights and materials, so the difference is almost certainly the output pipeline, not the lighting rig: the visible canvas gets the renderer's sRGB output conversion, while `renderThumbnail` renders into a `WebGLRenderTarget` and reads raw pixels — a path that skips output color-space encoding in three.js unless explicitly configured. Linear values written into a PNG display darker. (Verify at implementation; if it turns out to be tone mapping instead, same fix site.)
2. **Zoom mismatch.** The overlay is positioned at the tile's full `getBoundingClientRect()` — including padding and the label row — while the thumbnail `<img>` sits `object-contain` inside the tile's inner content box. Same camera distance rendered into a larger, differently-proportioned canvas ⇒ the model visibly grows on press.
3. **Label disappears.** Same root cause as 2: the overlay covers the entire tile, label included.

## Goals / Non-Goals

**Goals:**
- The press-to-orbit handoff is visually seamless: no brightness shift, no size jump, label stays.
- Lightbox shares the corrected pipeline (it renders to the visible canvas, so parity should follow from the thumbnail fix — verify).

**Non-Goals:**
- Changing the lighting rig, materials, or thumbnail resolution.
- Animating the tile→lightbox transition (separate polish, not this change).

## Decisions

### D1: Fix color at the render-target boundary, not by re-lighting
The thumbnail path is made to produce the same encoded output as the visible canvas — configure the render target/readback for sRGB output (or equivalently apply the encoding during readback) rather than compensating with brighter lights, which would fork the scene setup the specs require to be shared. Acceptance is comparative: a thumbnail and a same-camera live frame should be visually indistinguishable.

### D2: Overlay covers the image content box
The tile exposes its thumbnail image box; the overlay positions there instead of the tile rect. This fixes framing and label visibility in one move: the canvas replaces exactly the pixels the `<img>` occupied, and the label row below is simply never covered. Camera aspect uses that box, with framing math matching how `object-contain` fit the square PNG into it — the model's on-screen size is identical at the moment of handoff.

### D3: Stale-brightness thumbnails self-heal
The color fix changes what a correct thumbnail looks like, so existing cached PNGs are slightly "wrong" (dark). They are not invalidated wholesale: every orbit release re-persists, and any model the user never touches keeps a thumbnail whose brightness error was already the status quo. A one-time manual cache clear at rollout is optional.

## Risks / Trade-offs

- [Color-space root cause is a hypothesis until verified] → first implementation task is a minimal A/B (same camera, target vs canvas); the fix lands wherever the difference actually is.
- [Image content box changes with layout/DPR] → the overlay reads the live `<img>` rect at press time, the same way it reads the tile rect today; dismiss-on-scroll/resize already guards drift.

## Migration Plan

None — client-only rendering/geometry changes; cache entries unaffected structurally (see D3).

## Open Questions

- None blocking.
