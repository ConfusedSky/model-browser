/**
 * The strip a public deployment draws at the library's top (`landing-page` D3).
 * Mounted **outside the scroller**: inside `<main>` it would scroll away with
 * the grid, and the tiles would jump by its height when the listing landed.
 *
 * Sentence, chips and hint share one wrapping flow, the sentence and hint each
 * a full line of it; the dismiss control is the flow's sibling, not its last
 * item, so it cannot be carried onto a line of its own by the chips ahead of it. That costs
 * the row two utilities that read as one: `flex-1` is what fills the width the
 * dismiss control does not take, pinning it to the right edge, and `min-w-0`
 * lets the row shrink under its longest chip rather than push past the strip.
 */

import Icon from "./Icon";

/** Never glued to a `${`: Tailwind's scanner reads source text, so a computed
 *  candidate never reaches the stylesheet. */
const CHIP_CLASS =
  "rounded-full border border-line-strong bg-surface px-3 py-1 text-[13px] text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink touch:py-2.5";

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
      className="flex items-start gap-3 border-b border-line bg-[radial-gradient(ellipse_60%_120%_at_0%_0%,rgb(242_181_68/0.08),transparent_70%)] px-4 py-4 sm:px-5"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent sm:flex"
      >
        <Icon name="sparkles" />
      </span>
      {/* Only the first few chips are drawn — three on a phone, six wider: the
          strip must not bury the grid it introduces, and the rest stay one
          "Surprise me" away. */}
      <div
        data-intro-flow
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2 [&>button:nth-of-type(n+4)]:hidden sm:[&>button:nth-of-type(n+4)]:inline-flex sm:[&>button:nth-of-type(n+7)]:hidden"
      >
        <span className="basis-full text-sm font-medium text-ink">
          {meaningRunnable ? SENTENCE_WITH_SEARCH : SENTENCE_PLAIN}
        </span>
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
        <span className="basis-full pt-1 text-xs text-ink-3">
          Drag any model to turn it · click it to open · right-click or ⋯ for
          more
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss introduction"
        title="Hide this introduction"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface hover:text-ink"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
