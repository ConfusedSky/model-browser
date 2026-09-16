/**
 * The slim strip a public deployment draws over the grid at the library's top
 * (`landing-page` D3): one sentence, the example queries as chips and a
 * dismiss affordance. No links and no surprise action — those are the header's,
 * and the credits and the source are the About page's.
 *
 * Mounted outside the scroller, between `<header>` and the row holding `<main>`
 * and the side panel: inside `<main>` it would scroll away with the grid, and
 * the tiles would jump by its height when the listing landed.
 *
 * Everything arrives as props; it holds no state and reads no storage.
 */

/** Whole class strings, never glued to a `${`: Tailwind's scanner reads source
 *  text, so a computed candidate never reaches the stylesheet. */
const CHIP_CLASS =
  "rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:border-zinc-500";

/** With the chips withheld, an invitation to describe something is an offer
 *  nothing on screen can take up — so it goes with them. */
const SENTENCE_WITH_SEARCH =
  "Browse a library of 3D-printable miniatures, or describe what you are looking for:";
const SENTENCE_PLAIN = "Browse a library of 3D-printable miniatures.";

export default function IntroBanner({
  queries,
  meaningRunnable,
  onRun,
  onDismiss,
}: {
  queries: readonly string[];
  /** Whether a meaning search would run here — the chips are withheld, not
   *  disabled, when it would not. */
  meaningRunnable: boolean;
  onRun: (text: string) => void;
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
