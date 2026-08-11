/**
 * EXPERIMENTAL: global lighting mode (corner pill, orbit-feel-picker
 * precedent). 'axis' orients the rig to the model's spindle — top-lit
 * relative to the model's own up. 'camera' fixes the rig in camera space
 * (headlight) — the lit side follows the viewer while orbiting.
 */
import type { LightingMode } from '../../../shared/types'

export const LIGHTING_MODES = ['axis', 'camera'] as const

const KEY = 'model-browser:lighting-mode'
const DEFAULT_MODE: LightingMode = 'axis'

let current: LightingMode = (() => {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'axis' || saved === 'camera' ? saved : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
})()

export function getLightingMode(): LightingMode {
  return current
}

export function setLightingMode(mode: LightingMode): void {
  current = mode
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // no localStorage (tests) — in-memory only
  }
}
