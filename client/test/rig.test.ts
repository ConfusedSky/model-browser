import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { makeScene, RIG_VERSION } from '../src/three/renderer'

describe('light rig contents', () => {
  const { rig } = makeScene()
  const directionals = rig.children.filter(
    (l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight,
  )
  const white = directionals.filter((l) => l.color.getHex() === 0xffffff)
  const rims = directionals.filter((l) => l.color.getHex() !== 0xffffff)

  it('is at pixel-recipe version 2 (bump deliberately, with the test mocks, when pixels change)', () => {
    expect(RIG_VERSION).toBe(2)
  })

  it('keeps the base three lights with their historical parameters', () => {
    const hemi = rig.children.find((l) => l instanceof THREE.HemisphereLight) as THREE.HemisphereLight
    expect(hemi.intensity).toBe(1.4)
    expect(hemi.groundColor.getHex()).toBe(0x445566)
    const key = white.find((l) => l.intensity === 1.6)!
    expect(key.position.toArray()).toEqual([1, 2, 1.5])
    const fill = white.find((l) => l.intensity === 0.5)!
    expect(fill.position.toArray()).toEqual([-1.5, -0.5, -1])
    expect(white).toHaveLength(2)
  })

  it('carries the tuned rim accents: red at rig-space -X, blue mirrored at +X', () => {
    expect(rims).toHaveLength(2)
    const red = rims.find((l) => l.color.getHex() === 0xff4444)!
    const blue = rims.find((l) => l.color.getHex() === 0x3355ff)!
    // Frozen at the visually tuned values (D1) — a change here changes every
    // model's pixels and must come with a RIG_VERSION bump.
    expect(red.position.toArray()).toEqual([-1.5, 0.3, -0.6])
    expect(blue.position.toArray()).toEqual([1.5, 0.3, -0.6])
    expect(red.intensity).toBe(1.4)
    expect(blue.intensity).toBe(2.5)
  })
})
