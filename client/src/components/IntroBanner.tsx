/**
 * The strip a public deployment draws at the library's top (`landing-page` D3).
 * Mounted **outside the scroller**: inside `<main>` it would scroll away with
 * the grid, and the tiles would jump by its height when the listing landed.
 *
 * Sentence, chips and hint stack in one column; the dismiss control is that
 * column's sibling, not its last item, so it stays at the strip's end however
 * the chips wrap. That costs
 * the column two utilities that read as one: `flex-1` is what fills the width
 * the dismiss control does not take, pinning it to the right edge, and
 * `min-w-0` lets the chips' row scroll rather than push past the strip.
 */

import Icon from "./Icon";

/** Never glued to a `${`: Tailwind's scanner reads source text, so a computed
 *  candidate never reaches the stylesheet. */
const CHIP_CLASS =
  "shrink-0 rounded-full border border-line-strong bg-surface px-3 py-1 text-[13px] whitespace-nowrap text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink touch:py-2.5";

/** Read once: a device does not change what its pointer is mid-session. */
const COARSE_POINTER =
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches === true;

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
      className="relative flex items-start gap-3 border-b border-line bg-[radial-gradient(ellipse_60%_120%_at_0%_0%,rgb(242_181_68/0.08),transparent_70%)] px-4 py-4 sm:px-5"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent sm:flex"
      >
        <Icon name="sparkles" />
      </span>
      <div data-intro-flow className="min-w-0 flex-1 space-y-2.5">
        <p className="pr-10 text-sm font-medium text-ink sm:pr-0">
          {meaningRunnable ? SENTENCE_WITH_SEARCH : SENTENCE_PLAIN}
        </p>
        {/* One swipeable row on a phone, so the strip never buries the grid
            it introduces; every chip, wrapped, wider. */}
        {meaningRunnable && (
          <div
            data-intro-chips
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          >
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
        <p className="text-xs text-ink-3">
          {COARSE_POINTER
            ? "Drag a model to turn it · tap it to open · ⋯ for more"
            : "Drag any model to turn it · click it to open · right-click or ⋯ for more"}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss introduction"
        title="Hide this introduction"
        // On a phone it sits in the corner over the strip rather than in a
        // column beside it, so the chips' row can run the full width.
        className="absolute top-2.5 right-2 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface hover:text-ink touch:size-11 sm:static"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
