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

const { getThumbChain, makeScene, renderThumbnail } = await import('../src/three/renderer')

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
    expect(() => renderThumbnail(mesh)).toThrow('2d context unavailable')

    // Not just today's caster: whichever lights stageModel switched on, none
    // leaks its 2048² depth texture.
    expect(dispose).toHaveBeenCalledTimes(expected)
    expect(new Set(dispose.mock.contexts).size).toBe(expected)
  })
})
