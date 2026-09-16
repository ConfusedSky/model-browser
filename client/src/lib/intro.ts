/**
 * The visitor introduction's state and addresses (`landing-page` D3/D7). Nothing
 * reads storage at module init: a module-level `let` would survive
 * `localStorage.clear()` and carry one test cell's dismissal into the next. No
 * `three` and no React, so the About entry can import it.
 */
import { stored } from "./stored";

/** `'1'` rather than `'true'`, so a hand-edited value degrades to "not
 *  dismissed" rather than to an error. */
export const introDismissedStore = stored<boolean>(
  "model-browser:intro-dismissed",
  (raw) => raw === "1",
  (v) => (v ? "1" : "0"),
);

export const ABOUT_URL = "/about.html";

/** `random` is a parameter so a test can assert on a named query. */
export function pickExample(
  queries: readonly string[],
  random: () => number = Math.random,
): string {
  if (queries.length === 0) return "";
  // Clamped because a test's stub may hand back 1; the `??` is
  // `noUncheckedIndexedAccess` alone.
  return (
    queries[
      Math.min(Math.floor(random() * queries.length), queries.length - 1)
    ] ?? ""
  );
}
