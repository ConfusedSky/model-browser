// @vitest-environment happy-dom
import * as THREE from 'three'
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import type { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bounds } from '../src/three/camera'

// The chains are internal to the renderer module, so the seam is three itself
// — a fake WebGLRenderer lets the real composers be built (and the real
// staging run) without a GL context, exactly as in thumbnailTeardown.test.ts.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeWebGLRenderer {
    shadowMap = { enabled: false, type: 0 }
    setClearColor(): void {}
    setSize(): void {}
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

const { getLiveChain, getRenderer, getThumbChain, makeScene, renderThumbnail, stageModel, THUMB_SIZE } =
  await import('../src/three/renderer')
const { ViewerSession } = await import('../src/viewer/session')

afterEach(() => vi.restoreAllMocks())

/** A cube whose bounding-sphere radius is exactly `radius`. */
function makeMesh(radius = 1): THREE.Mesh {
  const side = (2 * radius) / Math.sqrt(3)
  return new THREE.Mesh(new THREE.BoxGeometry(side, side, side), new THREE.MeshBasicMaterial())
}

/** Stage a cube the way every view does, and hand back what a chain render needs. */
function staged(radius: number): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; bounds: Bounds } {
  const lit = makeScene()
  const { bounds } = stageModel(lit, makeMesh(radius), 'y')
  return { scene: lit.scene, camera: new THREE.PerspectiveCamera(40, 1), bounds }
}

describe('post-process chains', () => {
  it('builds one chain per path and reuses it across sessions and thumbnails', () => {
    const first = getLiveChain(200, 100)
    // A different host size resizes the chain; it never builds a second one.
    expect(getLiveChain(300, 150)).toBe(first)
    expect(getThumbChain()).toBe(getThumbChain())
    expect(getThumbChain()).not.toBe(first)
  })

  it('runs RenderPass → GTAOPass → OutputPass in both paths', () => {
    for (const chain of [getLiveChain(64, 64), getThumbChain()]) {
      expect(chain.composer.passes.map((p) => p.constructor.name)).toEqual([
        'RenderPass',
        'GTAOPass',
        'OutputPass',
      ])
    }
  })

  it('never takes the composer default target: 4× MSAA on both, bytes for readback', () => {
    // EffectComposer's own default is single-sample half-float, which would
    // drop today's antialiasing and break the thumbnail readback (D1).
    const live = getLiveChain(320, 240)
    expect(live.composer.renderTarget1.samples).toBe(4)
    expect(live.composer.renderTarget2.samples).toBe(4)

    const thumb = getThumbChain()
    expect(thumb.composer.renderTarget1.samples).toBe(4)
    expect(thumb.composer.renderTarget2.samples).toBe(4)
    expect(thumb.composer.renderTarget1.texture.type).toBe(THREE.UnsignedByteType)
    expect(thumb.composer.renderTarget2.texture.type).toBe(THREE.UnsignedByteType)
    // Fixed 512², never resized, and never pointed at the visible canvas.
    expect(thumb.composer.renderTarget1.width).toBe(THUMB_SIZE)
    expect(thumb.composer.renderTarget1.height).toBe(THUMB_SIZE)
    expect(thumb.composer.renderToScreen).toBe(false)
  })

  it('resizes the live chain only when the host dimensions actually change', () => {
    const live = getLiveChain(400, 300)
    const setSize = vi.spyOn(live.composer, 'setSize')
    getLiveChain(400, 300)
    expect(setSize).not.toHaveBeenCalled()
    getLiveChain(401, 300)
    expect(setSize).toHaveBeenCalledExactlyOnceWith(401, 300)
  })

  it('re-points both passes at the caller on every render', () => {
    const chain = getThumbChain()
    vi.spyOn(chain.composer, 'render').mockImplementation(() => {})
    for (const radius of [1, 100]) {
      const { scene, camera, bounds } = staged(radius)
      chain.render(scene, camera, bounds)
      const scenePass = chain.composer.passes[0] as RenderPass
      const aoPass = chain.composer.passes[1] as GTAOPass
      for (const pass of [scenePass, aoPass]) {
        expect(pass.scene).toBe(scene)
        expect(pass.camera).toBe(camera)
      }
    }
  })
})

describe('render paths go through the chains, never renderer.render', () => {
  it('drives the live view through the live chain', () => {
    const live = getLiveChain(200, 200)
    const composed = vi.spyOn(live.composer, 'render').mockImplementation(() => {})
    const direct = vi.spyOn(getRenderer(), 'render')

    const session = new ViewerSession(makeMesh())
    session.render(200, 200)

    expect(composed).toHaveBeenCalledOnce()
    // The chain's own render is stubbed, so any renderer.render left here
    // would be a direct call from session.render().
    expect(direct).not.toHaveBeenCalled()
    session.close()
  })

  it('reads the thumbnail back from the chain readBuffer as 512² RGBA', () => {
    const chain = getThumbChain()
    const composed = vi.spyOn(chain.composer, 'render').mockImplementation(() => {})
    const r = getRenderer()
    const direct = vi.spyOn(r, 'render')
    const read = vi.spyOn(r, 'readRenderTargetPixels')

    // happy-dom has no 2d canvas context, so the PNG encode at the very end
    // throws — well after the readback this test is about.
    expect(() => renderThumbnail(makeMesh())).toThrow('2d context unavailable')

    expect(composed).toHaveBeenCalledOnce()
    expect(direct).not.toHaveBeenCalled()
    const [target, x, y, width, height, buffer] = read.mock.calls[0]!
    // OutputPass leaves needsSwap at the Pass default, so the composer swaps
    // after it and the finished frame is the readBuffer (D1).
    expect(target).toBe(chain.composer.readBuffer)
    expect([x, y, width, height]).toEqual([0, 0, THUMB_SIZE, THUMB_SIZE])
    expect(buffer).toBeInstanceOf(Uint8Array)
    expect(buffer!.length).toBe(THUMB_SIZE * THUMB_SIZE * 4)
  })
})

// Frozen AO fit (D3), in radius units and pure exponents — tuned visually
// 2026-08-14 on the six e2e fixtures (task 2.1): reach/thickness/falloff kept
// at the principled defaults (edge gate clean, no halos); strength raised
// 1 → 1.5 so crevices read at thumbnail size (the cube's embossed text
// resolves through AO alone) without surfaces muddying. Changing any value
// changes every model's pixels and needs a RIG_VERSION bump.
const AO_RADIUS_R = 0.15
const AO_THICKNESS_R = 0.3
const AO_SCALE = 1.5
const AO_DISTANCE_EXPONENT = 1
const AO_SAMPLES = 16

/** The chain's GTAO pass, fitted to a freshly staged cube of this radius. */
function fitFor(radius: number): { ao: GTAOPass; bounds: Bounds } {
  const chain = getThumbChain()
  vi.spyOn(chain.composer, 'render').mockImplementation(() => {})
  const { scene, camera, bounds } = staged(radius)
  chain.render(scene, camera, bounds)
  return { ao: chain.composer.passes[1] as GTAOPass, bounds }
}

/** The fitted scalars, copied out — the shared chain overwrites its uniforms. */
function uniformFit(ao: GTAOPass): {
  radius: number
  thickness: number
  scale: number
  distanceExponent: number
} {
  const u = ao.gtaoMaterial.uniforms
  return {
    radius: u.radius!.value,
    thickness: u.thickness!.value,
    scale: u.scale!.value,
    distanceExponent: u.distanceExponent!.value,
  }
}

describe('GTAO fit', () => {
  it('scales reach and thickness with the staged radius, freezing the multiples', () => {
    const small = fitFor(1)
    // float32 vertices: 1 to within ~1e-8
    expect(small.bounds.radius).toBeCloseTo(1, 6)
    // Snapshots, not the live uniforms: one shared chain means the next fit
    // overwrites them in place.
    const smallFit = uniformFit(small.ao)
    expect(smallFit.radius).toBeCloseTo(AO_RADIUS_R * small.bounds.radius, 9)
    expect(smallFit.thickness).toBeCloseTo(AO_THICKNESS_R * small.bounds.radius, 9)
    expect(smallFit.scale).toBe(AO_SCALE)
    expect(smallFit.distanceExponent).toBe(AO_DISTANCE_EXPONENT)
    expect(small.ao.gtaoMaterial.defines!.SAMPLES).toBe(AO_SAMPLES)

    // A model 100× bigger gets the same occlusion 100× out: equal depth-cueing
    // for a miniature and a bust is the whole point of scaling by the radius.
    const big = fitFor(100)
    expect(big.bounds.radius / small.bounds.radius).toBeCloseTo(100, 4)
    const bigFit = uniformFit(big.ao)
    expect(bigFit.radius / smallFit.radius).toBeCloseTo(100, 4)
    expect(bigFit.thickness / smallFit.thickness).toBeCloseTo(100, 4)
  })

  it('clips occlusion to the staged bounds box, so the floor and background stay clean', () => {
    const { ao, bounds } = fitFor(3)
    expect(ao.gtaoMaterial.defines!.SCENE_CLIP_BOX).toBe(1)
    const min: THREE.Vector3 = ao.gtaoMaterial.uniforms.sceneBoxMin!.value
    const max: THREE.Vector3 = ao.gtaoMaterial.uniforms.sceneBoxMax!.value
    expect(min.distanceTo(bounds.box.min)).toBeLessThan(1e-9)
    expect(max.distanceTo(bounds.box.max)).toBeLessThan(1e-9)
  })

  it('re-fits per render, because the chain is shared between models', () => {
    const first = fitFor(1).ao.gtaoMaterial.uniforms.radius!.value
    const second = fitFor(50).ao.gtaoMaterial.uniforms.radius!.value
    expect(second).not.toBeCloseTo(first, 6)
  })
})
