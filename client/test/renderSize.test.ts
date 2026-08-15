import { describe, expect, it } from 'vitest'
import { liveRenderSize } from '../src/viewer/renderSize'

/** Frozen live-canvas constants: 1.5× supersample, 6M-pixel ceiling. */
const SUPERSAMPLE = 1.5
const MAX_PIXELS = 6_000_000

describe('live canvas render size', () => {
  it('supersamples a tile-sized overlay to the density a thumbnail already has', () => {
    // The orbit overlay is tile-sized: 176 CSS px. A thumbnail is 512² shown in
    // that box — ~1.45× device pixels at DPR 2, which is what this matches.
    const { width, height } = liveRenderSize(176, 176, 2)
    expect(width).toBe(Math.round(176 * 2 * SUPERSAMPLE))
    expect(height).toBe(width)
    expect(width / (176 * 2)).toBeCloseTo(SUPERSAMPLE, 6)
  })

  it('supersamples at DPR 1 too — the aliasing is shading, not device pixels', () => {
    const { width } = liveRenderSize(400, 300, 1)
    expect(width).toBe(600)
    expect(liveRenderSize(400, 300, 1).height).toBe(450)
  })

  it('never renders below device resolution, whatever the ceiling says', () => {
    // Well past the ceiling: the factor gives up rather than inverting into a
    // downscale, which would trade aliasing for blur.
    const { width, height } = liveRenderSize(3000, 2000, 2)
    expect(width).toBe(6000)
    expect(height).toBe(4000)
  })

  it('holds the pixel ceiling where supersampling would cross it', () => {
    // 1400² CSS at DPR 2 = 7.84M device px: already over, so scale is 1.
    expect(liveRenderSize(1400, 1400, 2).width).toBe(2800)
    // 900² CSS at DPR 2 = 3.24M device px; ×1.5² would be 7.29M, so the scale
    // lands between 1 and 1.5 and pins the total at the ceiling.
    const capped = liveRenderSize(900, 900, 2)
    expect(capped.width * capped.height / MAX_PIXELS).toBeCloseTo(1, 2)
    expect(capped.width).toBeGreaterThan(1800)
    expect(capped.width).toBeLessThan(1800 * SUPERSAMPLE)
  })

  it('treats a sub-1 or absent device pixel ratio as 1', () => {
    expect(liveRenderSize(200, 200, 0.5)).toEqual(liveRenderSize(200, 200, 1))
    expect(liveRenderSize(200, 200, Number.NaN).width).toBeGreaterThan(0)
  })
})
