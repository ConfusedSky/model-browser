/**
 * How a credits row is drawn, for the two places that draw one: the lightbox's
 * panel and the About page's list.
 *
 * Here rather than in `ViewerLayer` because that module value-imports the
 * renderer (`getRenderer`, `ViewerSession`, `MeshLru`), so anything importing
 * from it drags three.js along — and the About document is a second Vite entry
 * that must not carry a WebGL bundle to render a list of names
 * (`landing-page` D8). Nothing here touches the DOM or React; the rule that
 * decides *whether* a kit has credits at all is `shared/credits.ts`, shared with
 * the server.
 */

/**
 * How a stored URL is drawn: its host, with `www.` dropped.
 *
 * The panel is `--lb-panel` (18rem) wide and a corpus source URL runs ~45
 * characters (`https://www.thingiverse.com/thing:3750572`), which spelled out
 * wraps to three lines and becomes the loudest thing in a column of one-line
 * rows. The whole URL rides the link's `title`, and the `href` is of course the
 * stored string itself — this is what the reader sees, not where they go.
 *
 * A stored URL is corpus data and need not parse. Anything `new URL` refuses is
 * drawn verbatim rather than dropped: a string the reader can still read beats a
 * row that silently is not there, and attribution is the one thing here that
 * must not go quiet on a malformed field.
 */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The panel's only links, and the app's first: `_blank` because the lightbox is
 * a live session over a loaded mesh, and following a credit in place would tear
 * the whole app down to visit a model page. `rel="noreferrer"` implies
 * `noopener`, so one word covers both.
 *
 * `break-words`, never `break-all` (2026-09-15, Masa). `break-all` is
 * `word-break: break-all`, which breaks at *any* character, so the About page
 * drew "Creative Commons licence" as "Creative Commons licen / ce" whenever the
 * phrase met the end of a line — measured in Chromium at a 1280 px viewport,
 * the seam falling between `licen` and `ce` with the anchor's computed
 * `word-break` reading `break-all`. The rule was written for the lightbox's
 * 18rem column and is over-broad even there: `break-words`
 * (`overflow-wrap: break-word`) breaks a word only where it cannot fit on a
 * line of its own, which is the case the panel actually has — a long unbroken
 * author name — while leaving ordinary prose to wrap at its spaces.
 *
 * happy-dom applies no Tailwind CSS, so no unit test can see this: the check is
 * a computed `word-break` in a real browser, or the seam probe that produced
 * the measurement above (CLAUDE.md, the Tailwind note).
 */
export const CREDIT_LINK_CLASS = "break-words text-sky-400 hover:underline";
