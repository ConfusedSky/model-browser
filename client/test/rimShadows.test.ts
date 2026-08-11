import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_LIGHT, RIM_LIGHT } from '../src/three/renderer'
import { rimShadowsEnabled, setRimShadowsEnabled } from '../src/viewer/rimShadows'
import { ViewerSession } from '../src/viewer/session'

// render() needs the shared renderer — stub only that, so the session keeps
// the real rig and the real stageModel shadow fit.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  getRenderer: () => ({ setSize: () => {}, render: () => {} }),
}))

function makeMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
}

function rimsOf(session: ViewerSession): THREE.DirectionalLight[] {
  return session.rig.children.filter(
    (l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight && l.name === RIM_LIGHT,
  )
}

afterEach(() => setRimShadowsEnabled(false))

describe('SCAFFOLDING rim-shadow toggle', () => {
  it('defaults off: a rendered live view casts from the key alone', () => {
    expect(rimShadowsEnabled()).toBe(false)
    const session = new ViewerSession(makeMesh())
    session.render(100, 100)
    expect(session.rig.children.filter((l) => l.castShadow).map((l) => l.name)).toEqual([KEY_LIGHT])
    // The rims are unaffected as lights — only their casting is in question.
    expect(rimsOf(session).every((l) => l.visible)).toBe(true)
  })

  it('adds the rims as casters on the next frame, and drops them again', () => {
    const session = new ViewerSession(makeMesh())
    setRimShadowsEnabled(true)
    session.render(100, 100)
    expect(rimsOf(session).every((l) => l.castShadow)).toBe(true)
    expect(rimsOf(session).every((l) => l.visible)).toBe(true)
    setRimShadowsEnabled(false)
    session.render(100, 100)
    expect(rimsOf(session).some((l) => l.castShadow)).toBe(false)
  })

  it('disposes the rims when a session that was casting from them closes', () => {
    const session = new ViewerSession(makeMesh())
    setRimShadowsEnabled(true)
    session.render(100, 100)
    const disposals = rimsOf(session).map((l) => vi.spyOn(l, 'dispose'))
    session.close()
    expect(disposals).toHaveLength(2)
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce()
  })
})
