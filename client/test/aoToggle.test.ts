// @vitest-environment happy-dom
// The AO toggle: a persisted preference every render path consults — the live
// view per frame, thumbnails per render via their callers (ao-as-recipe-dimension).
import * as THREE from 'three'
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bounds } from '../src/three/camera'

// Same seam as composer.test.ts: a fake WebGLRenderer lets the real chains be
// built without a GL context.
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

const { getLiveChain, getThumbChain, makeScene, renderThumbnail, stageModel } = await import(
  '../src/three/renderer'
)
const { aoEnabled, setAoEnabled } = await import('../src/viewer/aoToggle')
const { ViewerSession } = await import('../src/viewer/session')

afterEach(() => {
  setAoEnabled(true)
  vi.restoreAllMocks()
})

function makeMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
}

function stagedArgs(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; bounds: Bounds } {
  const lit = makeScene()
  const { bounds } = stageModel(lit, makeMesh(), 'y')
  return { scene: lit.scene, camera: new THREE.PerspectiveCamera(40, 1), bounds }
}

const gtaoOf = (chain: { composer: { passes: unknown[] } }): GTAOPass =>
  chain.composer.passes[1] as GTAOPass

describe('AO toggle', () => {
  it('defaults off: a fresh profile renders unoccluded (ao-default-off)', async () => {
    // Fresh module over empty storage — the demo visitor's first load.
    localStorage.removeItem('model-browser:ao-enabled')
    vi.resetModules()
    const fresh = await import('../src/viewer/aoToggle')
    expect(fresh.aoEnabled()).toBe(false)
  })

  it('render(ao: false) skips the GTAO pass; the default re-enables it', () => {
    const chain = getLiveChain(100, 100)
    vi.spyOn(chain.composer, 'render').mockImplementation(() => {})
    const { scene, camera, bounds } = stagedArgs()

    chain.render(scene, camera, bounds, false)
    expect(gtaoOf(chain).enabled).toBe(false)
    chain.render(scene, camera, bounds)
    expect(gtaoOf(chain).enabled).toBe(true)
  })

  it('the live view follows the flag per render', () => {
    const chain = getLiveChain(100, 100)
    vi.spyOn(chain.composer, 'render').mockImplementation(() => {})
    const session = new ViewerSession(makeMesh())

    setAoEnabled(false)
    session.render(100, 100)
    expect(gtaoOf(chain).enabled).toBe(false)

    setAoEnabled(true)
    session.render(100, 100)
    expect(gtaoOf(chain).enabled).toBe(true)
    session.close()
  })

  it('persists the preference per profile', () => {
    setAoEnabled(false)
    expect(localStorage.getItem('model-browser:ao-enabled')).toBe('off')
    setAoEnabled(true)
    expect(localStorage.getItem('model-browser:ao-enabled')).toBe('on')
  })

  it('reads the persisted preference back at module init — the reload half', async () => {
    // A fresh module instance must honor what a previous session stored; this
    // is the "across sessions" half of the spec scenario, distinct from the
    // write path above.
    localStorage.setItem('model-browser:ao-enabled', 'off')
    vi.resetModules()
    const fresh = await import('../src/viewer/aoToggle')
    expect(fresh.aoEnabled()).toBe(false)

    localStorage.setItem('model-browser:ao-enabled', 'on')
    vi.resetModules()
    const again = await import('../src/viewer/aoToggle')
    expect(again.aoEnabled()).toBe(true)

    // Absent key (first run) defaults off since `ao-default-off`.
    localStorage.removeItem('model-browser:ao-enabled')
    vi.resetModules()
    const first = await import('../src/viewer/aoToggle')
    expect(first.aoEnabled()).toBe(false)
  })

  it('renderThumbnail draws the recipe its caller names — occluded when none is named', () => {
    // Retitled with `ao-as-recipe-dimension`: thumbnails DO follow the
    // preference now, through their callers' captured reads — what this pins
    // is only that the bare call's default argument is the occluded recipe,
    // whatever the store says at the moment of the render.
    const chain = getThumbChain()
    vi.spyOn(chain.composer, 'render').mockImplementation(() => {})

    setAoEnabled(false)
    // happy-dom has no 2d canvas; the throw is after the render this asserts.
    expect(() => renderThumbnail(makeMesh())).toThrow('2d context unavailable')
    expect(gtaoOf(chain).enabled).toBe(true)
  })
})
