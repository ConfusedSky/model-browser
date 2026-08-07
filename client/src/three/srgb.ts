/**
 * Linear → sRGB encoding for render-target readbacks. The visible canvas gets
 * this conversion from the renderer's output color space; pixels read from a
 * WebGLRenderTarget are linear and must be encoded manually or thumbnails
 * come out dark (spec: thumbnail output SHALL match the visible canvas).
 */

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

const TABLE = new Uint8ClampedArray(256)
for (let i = 0; i < 256; i++) {
  TABLE[i] = Math.round(linearToSrgb(i / 255) * 255)
}

export function linearByteToSrgbByte(b: number): number {
  return TABLE[b & 0xff]!
}

/** Encode RGB channels in place; alpha is left untouched. */
export function encodeSrgbInPlace(pixels: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = TABLE[pixels[i]!]!
    pixels[i + 1] = TABLE[pixels[i + 1]!]!
    pixels[i + 2] = TABLE[pixels[i + 2]!]!
  }
}
