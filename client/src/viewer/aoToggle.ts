/**
 * Ambient-occlusion toggle — the corner pill's one remaining preference. The
 * GTAO pass is bandwidth-bound and integrated GPUs feel it first — measured
 * 17 → 56 fps on an orbit drag when disabled — so it is a per-browser
 * performance preference (localStorage is per profile: an iGPU browser can
 * keep AO off while a dGPU profile keeps it on).
 *
 * Every path that draws a model consults it: `ViewerSession.render` per frame,
 * and each site that renders or files a thumbnail once per render
 * (`ao-as-recipe-dimension` D4). Occlusion is a dimension of the thumbnail
 * key, not a label on it — the two renders are cached side by side, so
 * following the preference still costs no `RIG_VERSION` bump and no sweep.
 */
import { stored } from '../lib/stored'

const KEY = 'model-browser:ao-enabled'

const store = stored(
  KEY,
  // Off by default (`ao-default-off`, 2026-08-31): absent — a fresh profile,
  // every demo visitor — and anything malformed read as off; a stored 'on' or
  // 'off' keeps meaning what the user chose. Cheap only since
  // `ao-as-recipe-dimension`: thumbnails follow the preference, so the old
  // handoff-jump objection to a static off default no longer applies.
  (raw) => raw === 'on',
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
