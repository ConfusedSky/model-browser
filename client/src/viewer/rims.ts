/**
 * SCAFFOLDING: rim-accent comparison toggle (lighting-mode precedent). The
 * live view hides the red/blue rims while this is off, so the two lighting
 * variants can be compared side by side. Deliberately in-memory and default
 * on — it is a comparison instrument, not a preference — and only
 * `ViewerSession` consults it: thumbnails always render the full rig recipe.
 */
let enabled = true

export function rimsEnabled(): boolean {
  return enabled
}

export function setRimsEnabled(on: boolean): void {
  enabled = on
}
