import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { OrbitAxis } from '../../shared/types'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { AXIS_TWEEN_MS, ViewerSession } from '../src/viewer/session'

const EL_LIMIT = Math.PI / 2 - 0.01
const AXES: OrbitAxis[] = ['x', '-x', 'y', '-y', 'z', '-z']

function makeSession(axis?: OrbitAxis, now?: () => number): ViewerSession {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
  return new ViewerSession(mesh, axis, undefined, now)
}

/** Session with a hand-cranked clock for driving the axis tween. */
function makeClockedSession(axis?: OrbitAxis): { s: ViewerSession; tick: (ms: number) => void } {
  let t = 0
  const s = makeSession(axis, () => t)
  return { s, tick: (ms) => (t += ms) }
}

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

  it('every spindle orbits identically: yaw shifts azimuth, pitch clamps', async () => {
    for (const axis of AXES) {
      const s = makeSession(axis)
      const az0 = s.state.az
      for (let i = 0; i < 50; i++) s.orbit(1, 0)
      await s.settle()
      const wrapped = ((s.state.az - (az0 - 0.5) + Math.PI) % (2 * Math.PI)) - Math.PI
      expect(Math.abs(wrapped)).toBeLessThan(1e-6)

      for (let i = 0; i < 500; i++) s.orbit(3, 5)
      await s.settle()
      expect(Number.isFinite(s.state.az)).toBe(true)
      expect(Math.abs(s.state.el)).toBeLessThanOrEqual(EL_LIMIT + 1e-9)
    }
  })

  it('settle round-trips the orbited pose exactly under a non-default spindle', async () => {
    const s = makeSession('-z')
    for (let i = 0; i < 37; i++) s.orbit(3, -2)
    await s.settle()
    const first = s.state
    // Settling again without moving must be a fixed point — the stored state
    // reproduces the pose exactly (no world-Y approximation).
    await s.settle()
    expect(s.state.az).toBeCloseTo(first.az, 9)
    expect(s.state.el).toBeCloseTo(first.el, 9)
    expect(s.state.distR).toBeCloseTo(first.distR, 9)
  })
})

describe('ViewerSession axis change', () => {
  it('jumps the rest state to the new spindle default immediately', () => {
    const { s } = makeClockedSession('y')
    for (let i = 0; i < 30; i++) s.orbit(2, 3)
    s.setAxis('z')
    expect(s.axis).toBe('z')
    expect(s.state).toEqual(DEFAULT_CAMERA)
    expect(s.animating).toBe(true)
  })

  it('setAxis with the current axis is a no-op', () => {
    const { s } = makeClockedSession('y')
    s.setAxis('y')
    expect(s.animating).toBe(false)
  })

  it('the tween finishes at the new default view and stops animating', async () => {
    const { s, tick } = makeClockedSession('y')
    for (let i = 0; i < 30; i++) s.orbit(2, 3)
    s.setAxis('-x')
    tick(AXIS_TWEEN_MS + 1)
    s.advance()
    expect(s.animating).toBe(false)
    // The settled live pose equals the rest state the tween targeted.
    await s.settle()
    expect(s.state.az).toBeCloseTo(DEFAULT_CAMERA.az, 6)
    expect(s.state.el).toBeCloseTo(DEFAULT_CAMERA.el, 6)
    expect(s.state.distR).toBeCloseTo(DEFAULT_CAMERA.distR, 6)
  })

  it('settle during the tween keeps the end state (persist is not mid-pose)', async () => {
    const { s, tick } = makeClockedSession('y')
    for (let i = 0; i < 30; i++) s.orbit(2, 3)
    s.setAxis('z')
    tick(AXIS_TWEEN_MS / 2)
    s.advance()
    await s.settle()
    expect(s.state).toEqual(DEFAULT_CAMERA)
  })

  it('a drag mid-tween cancels it and orbits the new spindle from the current pose', async () => {
    const { s, tick } = makeClockedSession('y')
    s.setAxis('z')
    tick(AXIS_TWEEN_MS / 2)
    s.advance()
    s.orbit(1, 0)
    expect(s.animating).toBe(false)
    await s.settle()
    // The pose was rebased in the z-spindle frame and stays finite/clamped.
    expect(Number.isFinite(s.state.az)).toBe(true)
    expect(Math.abs(s.state.el)).toBeLessThanOrEqual(EL_LIMIT + 1e-9)
  })

  it('zoom mid-tween cancels the animation and settle rebases to the frozen pose', async () => {
    const { s, tick } = makeClockedSession('y')
    s.setAxis('z')
    tick(AXIS_TWEEN_MS / 2)
    s.advance()
    s.zoom(1.2)
    expect(s.animating).toBe(false)
    await s.settle()
    expect(Number.isFinite(s.state.az)).toBe(true)
    expect(s.state.distR).toBeCloseTo(DEFAULT_CAMERA.distR * 1.2, 6)
  })

  it('a further axis change retargets the tween', () => {
    const { s, tick } = makeClockedSession('y')
    s.setAxis('z')
    tick(AXIS_TWEEN_MS / 2)
    s.advance()
    s.setAxis('-y')
    expect(s.axis).toBe('-y')
    expect(s.state).toEqual(DEFAULT_CAMERA)
    expect(s.animating).toBe(true)
    tick(AXIS_TWEEN_MS + 1)
    s.advance()
    expect(s.animating).toBe(false)
  })
})
