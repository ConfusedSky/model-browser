// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store caches the mode at module load, so each test re-imports fresh.
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('lighting mode store', () => {
  it('defaults to axis', async () => {
    const { getLightingMode } = await import('../src/viewer/lighting')
    expect(getLightingMode()).toBe('axis')
  })

  it('persists through localStorage across sessions', async () => {
    const first = await import('../src/viewer/lighting')
    first.setLightingMode('camera')
    expect(first.getLightingMode()).toBe('camera')
    expect(localStorage.getItem('model-browser:lighting-mode')).toBe('camera')

    vi.resetModules() // a fresh session reads the saved mode back
    const second = await import('../src/viewer/lighting')
    expect(second.getLightingMode()).toBe('camera')
  })

  it('a garbage stored value falls back to the default', async () => {
    localStorage.setItem('model-browser:lighting-mode', 'disco')
    const { getLightingMode } = await import('../src/viewer/lighting')
    expect(getLightingMode()).toBe('axis')
  })
})
