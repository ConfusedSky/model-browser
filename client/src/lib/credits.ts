/**
 * Not in `ViewerLayer`, which value-imports the renderer: the About page is a
 * second Vite entry and must not carry a WebGL bundle to list names
 * (`landing-page` D8). Whether a kit has credits is `shared/credits.ts`.
 */

/** The host alone, since a spelled-out URL is the loudest thing in a column of
 *  one-line rows. What `new URL` refuses is drawn verbatim: attribution must
 *  not go quiet on a malformed field. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** `_blank` because following a credit in place would tear down a live session.
 *  `break-words`, never `break-all`, which splits ordinary words mid-word. */
export const CREDIT_LINK_CLASS =
  "break-words text-accent underline-offset-2 hover:underline";
