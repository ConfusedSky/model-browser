import type { OverrideCredits } from "./types";

/**
 * The credits worth drawing, or `null` — so the state's non-null case means
 * "there is a row here", and the panel needs no second opinion at render time.
 *
 * `authorUrl` alone is deliberately not enough: it is where a name points, not
 * a name, and a link labelled with nobody credits nobody. `licenseUrl` is the
 * same: a link with no label to hang on. `modified` does count — the notice
 * that a copy is not the author's file stands on its own.
 *
 * Shared rather than the lightbox's own since `landing-page` D8: the server's
 * credits list (`listCredits`) filters by this very function, so the list and
 * the lightbox cannot disagree about which kits are credited — a loader-produced
 * `{}` is skipped by both.
 */
export function renderableCredits(
  credits: OverrideCredits | undefined,
): OverrideCredits | null {
  if (credits === undefined) return null;
  const some =
    credits.author !== undefined ||
    credits.license !== undefined ||
    credits.sourceUrl !== undefined ||
    credits.modified !== undefined;
  return some ? credits : null;
}
