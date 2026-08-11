import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyState, boundsOf, DEFAULT_CAMERA, rigQuaternion } from '../src/three/camera'
import { setLightingMode } from '../src/viewer/lighting'
import { AXIS_TWEEN_MS, ViewerSession } from '../src/viewer/session'

// render() needs the shared renderer — stub it so the session's rig
// orientation can be asserted without WebGL.
vi.mock('../src/three/renderer', () => ({
  getRenderer: () => ({ setSize: () => {}, render: () => {} }),
  makeScene: () => ({ scene: new THREE.Scene(), rig: new THREE.Group() }),
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
  RIG_VERSION: 2,
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

afterEach(() => setLightingMode('axis'))

describe('ViewerSession render orients the rig per lighting mode', () => {
  it('axis mode holds the spindle frame orientation', () => {
    const s = new ViewerSession(makeMesh(), 'z')
    s.render(100, 100)
    expect(s.rig.quaternion.angleTo(rigQuaternion('z'))).toBeLessThan(1e-6)
  })

  it('camera mode copies the camera quaternion instead', () => {
    setLightingMode('camera')
    const mesh = makeMesh()
    const s = new ViewerSession(mesh, 'z')
    s.render(100, 100)
    const expected = restCameraQuaternion(mesh, 'z')
    expect(s.rig.quaternion.angleTo(expected)).toBeLessThan(1e-6)
    // and that is genuinely different from the axis-mode orientation
    expect(s.rig.quaternion.angleTo(rigQuaternion('z'))).toBeGreaterThan(0.1)
  })

  it('a mode toggle between renders takes effect immediately', () => {
    const mesh = makeMesh()
    const s = new ViewerSession(mesh, 'y')
    s.render(100, 100)
    expect(s.rig.quaternion.angleTo(rigQuaternion('y'))).toBeLessThan(1e-6)
    setLightingMode('camera')
    s.render(100, 100)
    expect(s.rig.quaternion.angleTo(restCameraQuaternion(mesh, 'y'))).toBeLessThan(1e-6)
  })

  it('camera mode follows the camera through an axis tween, not the frame slerp', () => {
    setLightingMode('camera')
    let t = 0
    const s = new ViewerSession(makeMesh(), 'y', undefined, () => t)
    s.setAxis('z')
    t = AXIS_TWEEN_MS / 2 // eased midpoint: e = 0.5
    s.render(100, 100)
    const frameSlerp = new THREE.Quaternion().slerpQuaternions(
      rigQuaternion('y'),
      rigQuaternion('z'),
      0.5,
    )
    // advance() slerps the rig between frames, but the camera branch must
    // overwrite it — a camera-space rig tracks the (view-offset) camera.
    expect(s.rig.quaternion.angleTo(frameSlerp)).toBeGreaterThan(0.1)
  })

  it('axis mode mid-tween is exactly the eased frame slerp', () => {
    let t = 0
    const s = new ViewerSession(makeMesh(), 'y', undefined, () => t)
    s.setAxis('z')
    t = AXIS_TWEEN_MS / 2
    s.render(100, 100)
    const frameSlerp = new THREE.Quaternion().slerpQuaternions(
      rigQuaternion('y'),
      rigQuaternion('z'),
      0.5,
    )
    expect(s.rig.quaternion.angleTo(frameSlerp)).toBeLessThan(1e-6)
  })
})
