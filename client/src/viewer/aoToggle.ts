/**
 * SCAFFOLDING: ambient-occlusion comparison toggle (rim-shadows precedent).
 * The live view renders without GTAO while this is off, so the shipped AO
 * recipe and a no-AO render can be compared in place. Deliberately in-memory
 * and default ON — the shipped recipe includes AO — and only `ViewerSession`
 * consults it: thumbnails always render the shipped recipe, so the cache and
 * `RIG_VERSION` are untouched. Removed after the verdict, before archive.
 */
let enabled = true

export function aoEnabled(): boolean {
  return enabled
}

export function setAoEnabled(on: boolean): void {
  enabled = on
}
