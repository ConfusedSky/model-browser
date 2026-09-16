/**
 * Per browser, because the GTAO pass is bandwidth-bound and integrated GPUs
 * feel it first. Occlusion is a **dimension of the thumbnail key, not a label
 * on it** (`ao-as-recipe-dimension` D4), so the two renders cache side by side
 * and following the preference costs no `RIG_VERSION` bump.
 */
import { stored } from "../lib/stored";

const KEY = "model-browser:ao-enabled";

const store = stored(
  KEY,
  // Off by default (`ao-default-off`): absent or malformed reads as off.
  (raw) => raw === "on",
  (on) => (on ? "on" : "off"),
);
let enabled: boolean = store.read();

export function aoEnabled(): boolean {
  return enabled;
}

export function setAoEnabled(on: boolean): void {
  enabled = on;
  store.write(on);
}
