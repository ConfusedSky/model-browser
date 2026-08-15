/**
 * Backing-store size for the live canvas.
 *
 * A thumbnail is a fixed 512² render displayed in a ~176 px tile — roughly 1.5×
 * device pixels at DPR 2, i.e. supersampled for free. The live canvas has always
 * rendered 1:1 with device pixels, so at handoff the live view is the *more*
 * aliased of the two even though it is the interactive one. What separates them
 * is shading aliasing (high-frequency normals on dense sculpts, amplified by
 * ambient occlusion), which MSAA cannot touch: multisampling resolves geometric
 * edge coverage, not the shader result inside a fragment. Only more samples per
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
