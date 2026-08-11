import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { makeScene } from '../src/three/renderer'

describe('light rig contents', () => {
  const { rig } = makeScene()
  const directionals = rig.children.filter(
    (l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight,
  )
  const white = directionals.filter((l) => l.color.getHex() === 0xffffff)
  const rims = directionals.filter((l) => l.color.getHex() !== 0xffffff)

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

  it('carries a red rim at rig-space -X and a blue rim mirrored at +X', () => {
    expect(rims).toHaveLength(2)
    const red = rims.find((l) => {
      const { r, g, b } = l.color
      return r > g && r > b
    })!
    const blue = rims.find((l) => {
      const { r, g, b } = l.color
      return b > r && b > g
    })!
    expect(red.position.x).toBeLessThan(0)
    expect(blue.position.x).toBeGreaterThan(0)
    // Mirrored placement, behind the subject, equal accent intensities.
    expect(red.position.x).toBe(-blue.position.x)
    expect(red.position.y).toBe(blue.position.y)
    expect(red.position.z).toBe(blue.position.z)
    expect(red.position.z).toBeLessThan(0)
    expect(red.intensity).toBe(blue.intensity)
    expect(red.intensity).toBeLessThan(1) // an accent, not a floodlight
  })
})
