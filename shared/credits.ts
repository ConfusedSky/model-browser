import type { OverrideCredits } from "./types";

/**
 * The credits worth drawing, or `null`. A bare `authorUrl` or `licenseUrl` does
 * not count — a link with no label to hang on credits nobody — while `modified`
 * does, standing on its own. Shared so the server's credits list and the
 * lightbox cannot disagree about which kits are credited (`landing-page` D8).
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
