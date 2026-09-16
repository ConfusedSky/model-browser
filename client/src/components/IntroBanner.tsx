/**
 * The slim strip a public deployment draws over the grid at the library's top
 * (`landing-page` D3): one sentence saying what this is, the example queries as
 * clickable chips, the surprise action and a dismiss affordance.
 *
 * It carried About, Credits and Source until 2026-09-15, and carries none of
 * them now (Masa). About is in the header, where it outlives the dismissal;
 * Credits and Source are the About page's own, and a strip whose job is to say
 * what this is and offer a first query was spending three of its items sending
 * the reader away from the grid it introduces.
 *
 * It is mounted between `<header>` and the row that holds `<main>` and the side
 * panel, so it spans both and — the part that matters — sits *outside* the
 * scroller. Inside `<main>` it would scroll away with the grid and would have
 * to be rendered in the skeleton branch as well, or the tiles would jump by its
 * height when the listing landed.
 *
 * Everything it needs arrives as props; it holds no state and reads no storage.
 * Whether it is drawn at all, whether the chips are offered, and what a click
 * does are all `App`'s decisions — this draws them.
 */

/** Every class string is a whole literal, never glued to a `${` — Tailwind's
 *  scanner reads source text, so a computed candidate never reaches the
 *  stylesheet and the browser falls back to the property's default (CLAUDE.md,
 *  2026-09-03). */
const CHIP_CLASS =
  "rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:border-zinc-500";

/**
 * What the sentence may promise. With the index unable to answer here the chips
 * are withheld, and a sentence inviting a description would then be an offer
 * nothing on screen can take up — so the invitation goes with them.
 */
const SENTENCE_WITH_SEARCH =
  "Browse a library of 3D-printable miniatures, or describe what you are looking for:";
const SENTENCE_PLAIN = "Browse a library of 3D-printable miniatures.";

export default function IntroBanner({
  queries,
  meaningRunnable,
  onRun,
  onSurprise,
  onDismiss,
}: {
  queries: readonly string[];
  /** Whether a meaning search would run here — the chips and the surprise
   *  action are withheld, not disabled, when it would not. */
  meaningRunnable: boolean;
  onRun: (text: string) => void;
  onSurprise: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Introduction"
      className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300"
    >
      <span>{meaningRunnable ? SENTENCE_WITH_SEARCH : SENTENCE_PLAIN}</span>
      {meaningRunnable && (
        <div className="flex flex-wrap items-center gap-2">
          {queries.map((q) => (
            <button
              key={q}
              type="button"
              data-example-query={q}
              onClick={() => onRun(q)}
              className={CHIP_CLASS}
            >
              {q}
            </button>
          ))}
          <button type="button" onClick={onSurprise} className={CHIP_CLASS}>
            Surprise me
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss introduction"
        className="ml-auto rounded-lg px-2 py-1 text-zinc-400 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}
