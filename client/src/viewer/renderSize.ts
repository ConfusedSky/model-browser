/**
 * Backing-store size for the live canvas.
 *
 * The live canvas renders above device resolution because of shading aliasing;
 * it no longer renders above it to *match a thumbnail*, which is what this
 * comment used to say. That premise was `THUMB_SIZE` 512 in a ~176 px tile —
 * 1.45 samples per device pixel at DPR 2, so the tile was supersampled for free
 * and the live view at 1:1 was the more aliased of the two. `webp-thumbnails`
 * made thumbnails 256², and in a ~161 px tile that is 0.80 samples per device
 * pixel at DPR 2 and 1.59 at DPR 1: the tile is now the softer surface at high
 * density, and matching it would mean supersampling *below* device resolution,
 * which is not a thing worth matching. So the factor stays where it is on the
 * argument that never depended on thumbnails — and the handoff mismatch now
 * runs the safe way round, a model sharpening when the user takes hold of it
 * rather than blurring.
 *
 * What the factor is for: shading aliasing — high-frequency normals on dense
 * sculpts, amplified by ambient occlusion — which MSAA cannot touch, because
 * multisampling resolves geometric edge coverage and not the shader result
 * inside a fragment. Only more samples per
 * displayed pixel fix it, so the canvas renders above device resolution and the
 * browser downsamples it — the canvas keeps its CSS box (`style.width/height`
 * are 100%; `setSize` is called with `updateStyle: false`).
 */
const LIVE_SUPERSAMPLE = 1.5

/**
 * Ceiling on the backing store. Supersampling multiplies every per-pixel cost
 * in the chain — depth/normal prepass, GTAO, denoise, output — so a lightbox
 * already rendering millions of device pixels gives the factor up rather than
 * quadruple that work; it is also where each displayed pixel already gets the
 * most samples, so it needs the help least.
 */
const LIVE_MAX_PIXELS = 6_000_000

/**
 * CSS box + device pixel ratio → render size. Never below device resolution
 * (that would trade aliasing for blur), never above the pixel ceiling.
 */
export function liveRenderSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  // Math.max(1, NaN) is NaN, so the ratio is validated rather than clamped.
  const ratio = Number.isFinite(dpr) && dpr > 1 ? dpr : 1
  const deviceWidth = Math.max(1, cssWidth * ratio)
  const deviceHeight = Math.max(1, cssHeight * ratio)
  const room = Math.sqrt(LIVE_MAX_PIXELS / (deviceWidth * deviceHeight))
  const scale = Math.min(LIVE_SUPERSAMPLE, Math.max(1, room))
  return {
    width: Math.max(1, Math.round(deviceWidth * scale)),
    height: Math.max(1, Math.round(deviceHeight * scale)),
  }
}
