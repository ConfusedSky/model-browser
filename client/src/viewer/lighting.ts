/**
 * EXPERIMENTAL: global lighting mode (corner pill, orbit-feel-picker
 * precedent). 'axis' orients the rig to the model's spindle — top-lit
 * relative to the model's own up. 'camera' fixes the rig in camera space
 * (headlight) — the lit side follows the viewer while orbiting.
 */
import type { LightingMode } from '../../../shared/types'
import { stored } from '../lib/stored'

export const LIGHTING_MODES = ['axis', 'camera'] as const

const KEY = 'model-browser:lighting-mode'
const DEFAULT_MODE: LightingMode = 'axis'

const store = stored<LightingMode>(
  KEY,
  (raw) => (raw === 'axis' || raw === 'camera' ? raw : DEFAULT_MODE),
  (mode) => mode,
)
let current: LightingMode = store.read()

export function getLightingMode(): LightingMode {
  return current
}

export function setLightingMode(mode: LightingMode): void {
  current = mode
  store.write(mode)
}
