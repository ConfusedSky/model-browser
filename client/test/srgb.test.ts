import { describe, expect, it } from 'vitest'
import { encodeSrgbInPlace, linearByteToSrgbByte } from '../src/three/srgb'

describe('linear → sRGB readback encoding', () => {
  it('preserves black and white exactly', () => {
    expect(linearByteToSrgbByte(0)).toBe(0)
    expect(linearByteToSrgbByte(255)).toBe(255)
  })

  it('brightens midtones per the sRGB transfer curve', () => {
    // Measured in the A/B: linear 42 displayed as ~111 on the sRGB canvas.
    expect(linearByteToSrgbByte(42)).toBeGreaterThanOrEqual(111)
    expect(linearByteToSrgbByte(42)).toBeLessThanOrEqual(114)
  })

  it('is monotonic', () => {
    for (let i = 1; i < 256; i++) {
      expect(linearByteToSrgbByte(i)).toBeGreaterThanOrEqual(linearByteToSrgbByte(i - 1))
    }
  })

  it('encodes RGB in place and leaves alpha untouched', () => {
    const px = new Uint8Array([42, 49, 59, 128, 0, 255, 42, 7])
    encodeSrgbInPlace(px)
    expect([...px.subarray(0, 3)].every((v, i) => v > [42, 49, 59][i]!)).toBe(true)
    expect(px[3]).toBe(128)
    expect(px[4]).toBe(0)
    expect(px[5]).toBe(255)
    expect(px[7]).toBe(7)
  })
})
