## 1. Color-Pipeline Parity

- [ ] 1.1 Verify the root cause with a minimal A/B: render the same model+camera to the render target and to the visible canvas, compare pixels (expected: missing sRGB output encoding on the target path)
- [ ] 1.2 Fix the thumbnail path so its output encoding matches the visible canvas (render-target color space or encode-on-readback); confirm the lightbox/overlay path needs no change
- [ ] 1.3 Regression test: rendered thumbnail pixels are sRGB-encoded (not linear), or equivalent assertion at the readback boundary

## 2. Framing Parity & Label

- [ ] 2.1 Expose the tile's thumbnail image content box (the `<img>` rect) alongside the tile rect; overlay positions and sizes to it
- [ ] 2.2 Match camera framing to how `object-contain` fits the square PNG into that box, so model size/position are identical at handoff
- [ ] 2.3 Verify the label row stays visible during drag (falls out of 2.1 — assert it in the manual pass)
- [ ] 2.4 Update the outside-release dismissal and pointer-leave bounds to the image box

## 3. Verification

- [ ] 3.1 Client tests: overlay rect derivation from image box, framing math (square PNG in a non-square box)
- [ ] 3.2 Manual pass: press a tile — no brightness shift, no size jump, label visible mid-drag; lightbox color matches thumbnails; optionally clear the thumbnail cache once so all thumbnails regenerate at correct brightness
