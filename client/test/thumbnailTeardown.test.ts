// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The per-call thumbnail scene is internal to renderThumbnail, so the seam is
// three itself: a fake WebGLRenderer lets the real makeScene/stageModel run
// without a GL context.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeWebGLRenderer {
    shadowMap = { enabled: false, type: 0 }
    setClearColor(): void {}
    getPixelRatio(): number {
      return 1
    }
    getRenderTarget(): null {
      return null
    }
    setRenderTarget(): void {}
    render(): void {}
    readRenderTargetPixels(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
})

const { getRenderer, getThumbChain, makeScene, renderThumbnail, renderThumbnailCanvas, THUMB_QUALITY, THUMB_SIZE } =
  await import('../src/three/renderer')
const { THUMB_MIME } = await import('../../shared/types')

afterEach(() => vi.restoreAllMocks())

/** Directional lights the rig carries — the ones that can own a shadow map. */
function directionalCount(): number {
  return makeScene().rig.children.filter((l) => l instanceof THREE.DirectionalLight).length
}

describe('renderThumbnail teardown', () => {
  it('disposes every directional light of its per-call scene', () => {
    const expected = directionalCount()
    expect(expected).toBeGreaterThan(1)
    const dispose = vi.spyOn(THREE.DirectionalLight.prototype, 'dispose')
    // The chain's passes want a real GL context to run; this file is about
    // teardown, so only the composer's own render is stubbed out.
    vi.spyOn(getThumbChain().composer, 'render').mockImplementation(() => {})

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    // happy-dom has no 2d canvas context, so the encode step at the very end
    // throws — after the finally block that owns teardown, which is the point
    // of this test.
    expect(() => renderThumbnail(mesh, undefined, 'y')).toThrow('2d context unavailable')

    // Not just today's caster: whichever lights stageModel switched on, none
    // leaks its 2048² depth texture.
    expect(dispose).toHaveBeenCalledTimes(expected)
    expect(new Set(dispose.mock.contexts).size).toBe(expected)
  })
})

describe('renderThumbnailCanvas', () => {
  it('is the canvas renderThumbnail encodes: the same flipped readback, then toBlob as WebP', async () => {
    vi.spyOn(getThumbChain().composer, 'render').mockImplementation(() => {})
    // A deterministic readback — byte i of the GL buffer is i mod 251 — so a
    // row flip (or a missing one) shows in the bytes.
    vi.spyOn(getRenderer(), 'readRenderTargetPixels').mockImplementation((...args) => {
      const buf = args[5] as Uint8Array
      for (let i = 0; i < buf.length; i++) buf[i] = i % 251
    })
    // happy-dom has no 2d context: a fake that keeps what each canvas was painted with.
    const painted = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this
      const ctx = {
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: ImageData) => painted.set(canvas, image.data),
      }
      return ctx as unknown as CanvasRenderingContext2D
    })
    const encoded: { canvas: HTMLCanvasElement; type: string | undefined; quality: unknown }[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: unknown,
    ) {
      encoded.push({ canvas: this, type, quality })
      callback(new Blob())
    })

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    const canvas = renderThumbnailCanvas(mesh, undefined, 'y')
    await renderThumbnail(mesh, undefined, 'y')

    // One encode, of a canvas painted with exactly the bytes the lossless path hands out.
    expect(encoded).toHaveLength(1)
    expect(encoded[0]!.type).toBe(THUMB_MIME)
    expect(encoded[0]!.quality).toBe(THUMB_QUALITY)
    const direct = painted.get(canvas)
    const viaBlob = painted.get(encoded[0]!.canvas)
    expect(direct).toHaveLength(THUMB_SIZE * THUMB_SIZE * 4)
    expect(viaBlob).toEqual(direct)
    // And those bytes are the readback flipped: the canvas's first row is GL's last.
    const rowBytes = THUMB_SIZE * 4
    const lastGlRow = (THUMB_SIZE - 1) * rowBytes
    for (let i = 0; i < rowBytes; i++) expect(direct![i]).toBe((lastGlRow + i) % 251)
  })
})
