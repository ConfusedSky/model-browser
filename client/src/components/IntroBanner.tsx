/**
 * The strip a public deployment draws at the library's top (`landing-page` D3).
 * Mounted **outside the scroller**: inside `<main>` it would scroll away with
 * the grid, and the tiles would jump by its height when the listing landed.
 *
 * Sentence and chips share one wrapping row so a chip may sit on the sentence's
 * own line; the dismiss control is that row's sibling, not its last item, so it
 * cannot be carried onto a line of its own by the chips ahead of it.
 */

/** Never glued to a `${`: Tailwind's scanner reads source text, so a computed
 *  candidate never reaches the stylesheet. */
const CHIP_CLASS =
  "rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:border-zinc-500";

/** An invitation to describe something is an offer nothing can take up once
 *  the chips are withheld. */
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
  /** The chips are withheld, not disabled, when it would not. */
  meaningRunnable: boolean;
  onRun: (text: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Introduction"
      className="flex items-start gap-2 border-b border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300"
    >
      <div
        data-intro-flow
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
      >
        <span>{meaningRunnable ? SENTENCE_WITH_SEARCH : SENTENCE_PLAIN}</span>
        {meaningRunnable &&
          queries.map((q) => (
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
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss introduction"
        className="shrink-0 rounded-lg px-2 py-1 text-zinc-400 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}
