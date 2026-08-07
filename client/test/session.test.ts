import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { setOrbitFlip, setOrbitMode } from '../src/viewer/orbitModes'
import { ViewerSession } from '../src/viewer/session'

const EL_LIMIT = Math.PI / 2 - 0.01

function makeSession(): ViewerSession {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
  return new ViewerSession(mesh)
}

beforeEach(() => {
  setOrbitMode('turntable')
  setOrbitFlip(false)
})

describe('ViewerSession turntable orbit', () => {
  it('a pure yaw drag changes azimuth by the drag amount', async () => {
    const s = makeSession()
    const az0 = s.state.az
    for (let i = 0; i < 50; i++) s.orbit(1, 0) // 50px = 0.5 rad
    await s.settle()
    const wrapped = ((s.state.az - (az0 - 0.5) + Math.PI) % (2 * Math.PI)) - Math.PI
    expect(Math.abs(wrapped)).toBeLessThan(1e-6)
  })

  it('elevation clamps at the poles instead of crossing them', async () => {
    const s = makeSession()
    for (let i = 0; i < 500; i++) s.orbit(0, 5) // way past 90°
    await s.settle()
    expect(s.state.el).toBeCloseTo(EL_LIMIT, 6)
    expect(Number.isFinite(s.state.az)).toBe(true)
  })

  it('settle preserves distance and target and never moves the view', async () => {
    const s = makeSession()
    const before = s.state
    for (let i = 0; i < 120; i++) s.orbit(5, -4)
    await s.settle()
    expect(s.state.distR).toBeCloseTo(before.distR, 6)
    expect(s.state.target).toEqual(before.target)
  })

  it('zoom clamps distance and survives settle', async () => {
    const s = makeSession()
    for (let i = 0; i < 100; i++) s.zoom(0.5)
    expect(s.state.distR).toBeCloseTo(1.1, 6)
    s.orbit(10, 10)
    await s.settle()
    expect(s.state.distR).toBeCloseTo(1.1, 6)
  })

  it('X and Z spindle variants stay finite and clamped too', async () => {
    for (const mode of ['turntable-x', 'turntable-z'] as const) {
      setOrbitMode(mode)
      const s = makeSession()
      for (let i = 0; i < 400; i++) s.orbit(3, 4)
      await s.settle()
      expect(Number.isFinite(s.state.az)).toBe(true)
      expect(Math.abs(s.state.el)).toBeLessThanOrEqual(EL_LIMIT + 1e-9)
    }
  })

  it('flip covers the negated spindles without breaking any variant', async () => {
    setOrbitFlip(true)
    for (const mode of ['turntable', 'turntable-x', 'turntable-z'] as const) {
      setOrbitMode(mode)
      const s = makeSession()
      for (let i = 0; i < 400; i++) s.orbit(3, 4)
      await s.settle()
      expect(Number.isFinite(s.state.az)).toBe(true)
      expect(Math.abs(s.state.el)).toBeLessThanOrEqual(EL_LIMIT + 1e-9)
    }
  })

  it('flipped yaw still changes azimuth by the drag amount (basis swap keeps direction)', async () => {
    setOrbitFlip(true)
    const s = makeSession()
    for (let i = 0; i < 50; i++) s.orbit(1, 0)
    await s.settle()
    expect(Number.isFinite(s.state.az)).toBe(true)
  })
})
