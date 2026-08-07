## Why

Pressing a tile should feel like the thumbnail comes alive under your cursor. Today the handoff is jarring: the live view is lit/colored differently than the PNG, framed at a different zoom, and the file name vanishes the moment the overlay appears. Each is a small defect; together they make the core interaction feel unpolished.

## What Changes

- **Color-pipeline parity**: thumbnails and the live view render through the same output color pipeline, so the PNG and the canvas are pixel-comparable (today the offscreen render-target path skips the sRGB output conversion the visible canvas gets, leaving thumbnails darker).
- **Framing parity**: the orbit overlay covers the tile's thumbnail image area (not the whole tile) with matching camera framing, so the model neither jumps nor changes size when the overlay opens.
- **Label persistence**: the file name stays visible while orbiting — a consequence of the overlay covering only the image area.
- Lightbox checked against the same color pipeline (it shares the visible-canvas path, so it should already match once thumbnails are fixed).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-viewer`: overlay geometry (image-area coverage, framing continuity, label visibility) added to the drag-to-orbit requirement.
- `model-thumbnails`: the existing "thumbnails match the orbit view" clause strengthened to explicitly include the output color pipeline.

## Impact

- `client/src/three/renderer.ts` (render-target color space / readback), `client/src/viewer/ViewerLayer.tsx` and `client/src/App.tsx` (overlay rect = image content box), `client/src/components/Grid.tsx` (expose the image box), camera framing math.
- Cached thumbnails re-render lazily as they're orbited (color fix changes pixels; no forced invalidation — mismatched brightness self-heals per model on next persist). Optionally clear the cache once at rollout.
