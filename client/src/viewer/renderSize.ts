/** For shading aliasing, which MSAA cannot touch: multisampling resolves edge
 *  coverage, not the shader result inside a fragment. The canvas renders above
 *  device resolution and keeps its CSS box (`updateStyle: false`). */
const LIVE_SUPERSAMPLE = 1.5;

/** Supersampling multiplies every per-pixel cost in the chain, so a lightbox
 *  already rendering millions of device pixels gives the factor up — and it is
 *  where a displayed pixel needs the help least. */
const LIVE_MAX_PIXELS = 6_000_000;

/** Never below device resolution, which trades aliasing for blur. */
export function liveRenderSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  // `Math.max(1, NaN)` is NaN, so this validates rather than clamps.
  const ratio = Number.isFinite(dpr) && dpr > 1 ? dpr : 1;
  const deviceWidth = Math.max(1, cssWidth * ratio);
  const deviceHeight = Math.max(1, cssHeight * ratio);
  const room = Math.sqrt(LIVE_MAX_PIXELS / (deviceWidth * deviceHeight));
  const scale = Math.min(LIVE_SUPERSAMPLE, Math.max(1, room));
  return {
    width: Math.max(1, Math.round(deviceWidth * scale)),
    height: Math.max(1, Math.round(deviceHeight * scale)),
  };
}
