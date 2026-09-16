/**
 * The visitor introduction's small state and its fixed addresses
 * (`landing-page` D3/D7): whether this browser has dismissed the banner, where
 * the About link goes, and how the surprise action picks a query. The credits
 * and the source are the About page's own addresses, not this module's.
 *
 * Nothing here reads storage at module init: a module-level `let` would
 * survive `localStorage.clear()` and hand each test cell the previous one's
 * dismissal (D7).
 *
 * No `three` and no React: the About entry may import this without dragging a
 * renderer into its bundle.
 */
import { stored } from "./stored";

/** Per browser, never shared. `'1'` rather than `'true'` so a hand-edited
 *  value degrades to "not dismissed" instead of to an error. */
export const introDismissedStore = stored<boolean>(
  "model-browser:intro-dismissed",
  (raw) => raw === "1",
  (v) => (v ? "1" : "0"),
);

/** A second entry of the built client, not a view of the app (D2) — named
 *  with its extension, as the static handler serves it. */
export const ABOUT_URL = "/about.html";

/** One of the example queries, uniformly. `random` is a parameter so a test
 *  can assert on a named query; `App` passes `Math.random`. */
export function pickExample(
  queries: readonly string[],
  random: () => number = Math.random,
): string {
  if (queries.length === 0) return "";
  // Clamped, because `random()` is documented as `[0, 1)` but a stub in a test
  // may hand back 1 — and the `??` is `noUncheckedIndexedAccess` alone.
  return (
    queries[
      Math.min(Math.floor(random() * queries.length), queries.length - 1)
    ] ?? ""
  );
}
