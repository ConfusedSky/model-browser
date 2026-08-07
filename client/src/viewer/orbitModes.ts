/**
 * EXPERIMENTAL: orbit-feel picker (corner UI). The Z-up geometry fix settled
 * the core question; what remains is the turntable spindle axis. One variant
 * per world axis — same clamped-turntable math, camera up locked to the
 * spindle:
 *
 * - turntable:    spindle = world Y — the model's natural up (default)
 * - turntable-x:  spindle = world X — cartwheels the model left-right
 * - turntable-z:  spindle = world Z — rolls the model toward/away from you
 *
 * The flip toggle negates the active spindle (+axis → -axis), covering all
 * six spindles with four controls.
 */
export const ORBIT_MODES = ['turntable', 'turntable-x', 'turntable-z'] as const
export type OrbitMode = (typeof ORBIT_MODES)[number]

const KEY = 'model-browser:orbit-mode'
const FLIP_KEY = 'model-browser:orbit-flip'
const DEFAULT_MODE: OrbitMode = 'turntable'

let current: OrbitMode = (() => {
  try {
    const saved = localStorage.getItem(KEY)
    return ORBIT_MODES.includes(saved as OrbitMode) ? (saved as OrbitMode) : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
})()

export function getOrbitMode(): OrbitMode {
  return current
}

export function setOrbitMode(mode: OrbitMode): void {
  current = mode
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // no localStorage (tests) — in-memory only
  }
}

let flipped: boolean = (() => {
  try {
    return localStorage.getItem(FLIP_KEY) === '1'
  } catch {
    return false
  }
})()

export function getOrbitFlip(): boolean {
  return flipped
}

export function setOrbitFlip(value: boolean): void {
  flipped = value
  try {
    localStorage.setItem(FLIP_KEY, value ? '1' : '0')
  } catch {
    // no localStorage (tests) — in-memory only
  }
}
