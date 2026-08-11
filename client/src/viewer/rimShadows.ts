/**
 * SCAFFOLDING: rim-shadow comparison toggle (lighting-mode precedent). The
 * live view lets the red/blue rims cast shadows while this is on, so
 * key-only casting and key+rim casting can be compared side by side. The rims
 * stay lit either way. Deliberately in-memory and default off — the shipped
 * recipe casts from the key alone (D5) — and only `ViewerSession` consults
 * it: thumbnails always render the shipped recipe.
 */
let enabled = false

export function rimShadowsEnabled(): boolean {
  return enabled
}

export function setRimShadowsEnabled(on: boolean): void {
  enabled = on
}
