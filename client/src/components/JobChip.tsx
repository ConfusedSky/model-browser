import { useEffect, useState } from "react";
import type { JobState } from "../jobs/bulkJobs";

/** Every entry waits a little on a two-wide queue, so a counter that flickered
 *  "waiting" between entries would say nothing. */
export const WAITING_AFTER_MS = 1500;

/**
 * A bulk job's whole UI (`bulk-thumbnail-jobs` D2). App-level and corner-fixed,
 * so it survives the navigation away from the folder whose menu launched it.
 *
 * **Props, no store**, which is what lets the runner's cells assert counters
 * without a DOM and this component's without a runner.
 *
 * ***Dismiss is not Cancel***: it hides the chip and the job runs on, so the ×
 * never reaches `onCancel`.
 */
export default function JobChip({
  state,
  onConfirm,
  onCancel,
  onDismiss,
  viewOpen = false,
}: {
  state: JobState;
  /** Reset's consent, pressed only from `confirming` (D5). */
  onConfirm: () => void;
  onCancel: () => void;
  /** Never a cancellation. */
  onDismiss: () => void;
  /** An entry that already started waits inside its own `whenResumed()` gates,
   *  where the runner's `waiting` cannot see it — and App knows the view, where
   *  the runner does not. */
  viewOpen?: boolean;
}) {
  // `waiting` flips true on every push and false as it starts, so only a wait
  // outlasting the threshold is worth a word.
  const [stalled, setStalled] = useState(false);
  const waiting = state.phase === "running" && (state.waiting || viewOpen);
  useEffect(() => {
    if (!waiting) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), WAITING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return (
    <div
      role="status"
      aria-live="polite"
      // Above the occlusion pill, which owns the corner itself: the two would
      // otherwise overlap exactly.
      className="fixed bottom-14 left-3 z-20 flex max-w-sm items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs text-zinc-200"
    >
      <p className="min-w-0 flex-1">
        {sentence(state)}
        {stalled && " · waiting behind what you’re looking at"}
      </p>
      {state.phase === "confirming" && (
        <button type="button" onClick={onConfirm} className={ACTION_CLASS}>
          Reset
        </button>
      )}
      {/* Cancel is offered exactly while there is work to stop. A finished or
          cancelled job keeps its sentence and loses the button, rather than
          offering one that would do nothing. */}
      {(state.phase === "deriving" ||
        state.phase === "confirming" ||
        state.phase === "running") && (
        <button type="button" onClick={onCancel} className={ACTION_CLASS}>
          Cancel
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded px-1 text-zinc-500 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}

const ACTION_CLASS =
  "shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-zinc-500";

/** One helper for every phase, so the library and a folder are never described
 *  two ways: App labels the whole-library scope `'the library'` (D8), and
 *  "beneath the library" is not English. */
function scopePhrase(label: string): string {
  return label === "the library" ? "in the library" : `beneath ${label}`;
}

/** Each clause only when it has something to say: `· 0 failed` is noise. */
function tail(state: JobState): string {
  return (
    (state.failed > 0 ? ` · ${state.failed} failed` : "") +
    (state.skipped > 0 ? ` · ${state.skipped} skipped` : "") +
    (state.incomplete ? " (scope cut short)" : "")
  );
}

function sentence(state: JobState): string {
  const phrase = scopePhrase(state.scope.label);
  switch (state.phase) {
    case "deriving":
      return `Counting ${state.scope.label}…`;
    case "confirming":
      // The one number stated *before* anything is sent: what the user is
      // consenting to (D5).
      return `Reset ${state.total} framings ${phrase}?`;
    case "running":
      return `${state.operation === "generate" ? "Generating thumbnails" : "Resetting framings"} ${phrase}: ${state.done} of ${state.total}${tail(state)}`;
    case "done":
      // Replaces the count rather than joining it: "0 of 0" is a true sentence
      // that says nothing about what went wrong.
      return state.failure !== undefined
        ? state.failure
        : state.operation === "generate"
          ? // "Generated" counts writes: an entry the job found already current
            // on its own lookup was processed, not drawn, and says so.
            `Generated ${state.wrote} of ${state.total} ${phrase}${
              state.done - state.wrote > 0
                ? ` · ${state.done - state.wrote} already current`
                : ""
            }${tail(state)}`
          : `Reset ${state.done} of ${state.total} ${phrase}${tail(state)}`;
    case "cancelled":
      // No total to have got through, so it says what was interrupted.
      return state.total === 0
        ? `Cancelled before counting ${state.scope.label}`
        : `Cancelled after ${state.done} of ${state.total} ${phrase}${tail(state)}`;
  }
}
