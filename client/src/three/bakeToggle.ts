/**
 * TEMPORARY — `file-frame-spindle` D7: the compare pill's module flag, and the
 * write guard that holds while the pill exists. Deleted by task 5.2; nothing
 * may depend on this module beyond that change.
 *
 * Unlike `viewer/aoToggle.ts` this is **not persisted**: a reload is off. The
 * flag selects the legacy Z-up bake — `parseModel`'s `bake` argument through
 * `App`'s second `MeshLru`, `frameFor`'s legacy table, `pose.ts`'s scene-space
 * mapping — so the old rendering can be compared against the new one in the
 * app while testing.
 */

/**
 * On both sides of the pill, no thumbnail write reaches any store (D7): the
 * first line of `LocalFramingClient.putThumb` returns `{ dropped: true }` while
 * this is true. A constant rather than a flag read, so the guard vanishes with
 * this file and cannot be left half-on.
 */
export const BAKE_PILL_PRESENT = true

let legacy = false

export function legacyBake(): boolean {
  return legacy
}

export function setLegacyBake(on: boolean): void {
  legacy = on
}
