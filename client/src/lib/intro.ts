/**
 * The visitor introduction's small state and its fixed addresses
 * (`landing-page` D3/D7): whether this browser has dismissed the banner, where
 * the three links go, and how the surprise action picks a query.
 *
 * Nothing here reads storage at module init, unlike `lib/searchOptions.ts`:
 * `App` reads the flag with `useState(() => introDismissedStore.read())` — the
 * `SidePanel` `collapsed` pattern — so `localStorage.clear()` between test
 * cells actually resets it (D7). A module-level `let` would survive the clear
 * and hand each cell the previous one's dismissal.
 *
 * No `three` and no React: the About entry may import this without dragging a
 * renderer into its bundle.
 */
import { stored } from "./stored";

/**
 * Per browser, never shared: dismissal is a reader's choice about their own
 * screen, and the key sits under the `model-browser:` prefix every preference
 * uses. Written as `'1'` rather than `'true'` so a hand-edited value degrades
 * to "not dismissed" instead of to an error.
 */
export const introDismissedStore = stored<boolean>(
  "model-browser:intro-dismissed",
  (raw) => raw === "1",
  (v) => (v ? "1" : "0"),
);

/**
 * The About document, which is a second entry of the built client and not a
 * view of the app (D2) — so it is named with its extension, exactly as the
 * static handler serves it.
 */
export const ABOUT_URL = "/about.html";
/** The About page's credits section, which the banner's third link leads to. */
export const CREDITS_URL = "/about.html#credits";
/** Where the code is. Off-site, so its anchor opens in a new tab. */
export const SOURCE_URL = "https://github.com/ConfusedSky/model-browser";

/**
 * One of the example queries, uniformly. `random` is a parameter so a test can
 * assert on a named query rather than on "one of six" — `App` passes
 * `Math.random` and nothing else ever should.
 *
 * An empty list has nothing to pick, and the caller is the banner, which is
 * drawn only where the list is non-empty; the guard is here anyway so the
 * function is total.
 */
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
