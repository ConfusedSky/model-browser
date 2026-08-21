/**
 * Ambient-occlusion toggle for the live view (lighting-mode precedent). The
 * GTAO pass is bandwidth-bound and integrated GPUs feel it first — measured
 * 17 → 56 fps on an orbit drag when disabled — so the pill is a per-browser
 * performance preference, persisted like the lighting mode (localStorage is
 * per profile: an iGPU browser can keep AO off while a dGPU profile keeps it
 * on). Only `ViewerSession` consults it: thumbnails always render the shipped
 * recipe, so the cache and `RIG_VERSION` never see the preference.
 */
import { stored } from '../lib/stored'

const KEY = 'model-browser:ao-enabled'

const store = stored(
  KEY,
  (raw) => raw !== 'off',
  (on) => (on ? 'on' : 'off'),
)
let enabled: boolean = store.read()

export function aoEnabled(): boolean {
  return enabled
}

export function setAoEnabled(on: boolean): void {
  enabled = on
  store.write(on)
}
