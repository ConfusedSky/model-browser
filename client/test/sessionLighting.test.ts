import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { applyState, boundsOf, DEFAULT_CAMERA } from '../src/three/camera'
import { AXIS_TWEEN_MS, ViewerSession } from '../src/viewer/session'

// render() needs the shared renderer — stub it so the session's rig
// orientation can be asserted without WebGL.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  getRenderer: () => ({ setSize: () => {}, render: () => {} }),
  // The live post-process chain needs a GL context of its own; render() reaches
  // it through this export, so stubbing it here keeps the seam WebGL-free.
  getLiveChain: () => ({ render: () => {} }),
  makeScene: () => ({ scene: new THREE.Scene(), rig: new THREE.Group() }),
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
}))

function makeMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
}

/** The world orientation the session's camera has at the rest state. */
function restCameraQuaternion(mesh: THREE.Mesh, axis: 'y' | 'z' | '-x'): THREE.Quaternion {
  const cam = new THREE.PerspectiveCamera(40, 1)
  applyState(cam, DEFAULT_CAMERA, boundsOf(mesh), axis)
  return cam.quaternion.clone()
}

describe('ViewerSession render fixes the rig in camera space', () => {
  it('rig equals the camera quaternion after render, whatever the spindle', () => {
    for (const axis of ['y', 'z', '-x'] as const) {
      const mesh = makeMesh()
      const s = new ViewerSession(mesh, axis)
      s.render(100, 100)
      expect(s.rig.quaternion.angleTo(restCameraQuaternion(mesh, axis))).toBeLessThan(1e-6)
    }
  })

  it('follows the camera through an axis tween, with no lighting snap', () => {
    // The rig is no longer animated — it copies whatever the camera is at this
    // frame — so continuity through the tween is a property of that copy, not
    // of a slerp. Assert it the way the spec states it: mid-tween the rig sits
    // strictly between the two rest orientations, and lands on the new one
    // exactly. (`ViewerSession`'s camera is private, so the endpoints are
    // rebuilt with `applyState` — the same placement render() performs.)
    const mesh = makeMesh()
    let t = 0
    const s = new ViewerSession(mesh, 'y', undefined, () => t)
    const from = restCameraQuaternion(mesh, 'y')
    const to = restCameraQuaternion(mesh, 'z')

    s.render(100, 100)
    expect(s.rig.quaternion.angleTo(from)).toBeLessThan(1e-6)

    s.setAxis('z')
    t = AXIS_TWEEN_MS / 2 // eased midpoint: e = 0.5
    s.render(100, 100)
    expect(s.rig.quaternion.angleTo(from)).toBeGreaterThan(0.05)
    expect(s.rig.quaternion.angleTo(to)).toBeGreaterThan(0.05)

    t = AXIS_TWEEN_MS
    s.render(100, 100)
    expect(s.animating).toBe(false)
    expect(s.rig.quaternion.angleTo(to)).toBeLessThan(1e-6)
  })
})
