import { useEffect, useState } from 'react'
import type { JobState } from '../jobs/bulkJobs'

/**
 * How long a pushed entry may wait to start before the chip says it is
 * waiting. Every entry waits a little — the queue is two wide — and a
 * counter that flickered "waiting" between entries would say nothing; a job
 * genuinely behind the view waits whole seconds (`bulk-thumbnail-jobs` 5.2).
 */
export const WAITING_AFTER_MS = 1500

/**
 * A bulk job's whole UI (`bulk-thumbnail-jobs` 2.3, D2).
 *
 * App-level and fixed to the corner, so it survives navigation: the job it
 * reports on outlives the folder whose menu launched it, and a chip that lived
 * in the grid would vanish with the listing while the work carried on
 * invisibly. One chip whichever launcher started the job — a container's menu
 * entry or the library tab — because there is only ever one job.
 *
 * **Props, no store.** It reads no store and makes no request: every number on
 * screen is a field of `JobState`, and every button is one of the runner's four
 * verbs handed down. That is what lets the runner's cells assert counters
 * without a DOM and this component's assert copy without a runner. The one
 * word that is not a field is "waiting behind what you’re looking at": a wait
 * the runner reports (`JobState.waiting`) or a view App reports (`viewOpen`),
 * filtered through this component's own clock so the moment every entry waits
 * says nothing (5.2).
 *
 * *Dismiss is not Cancel* (D2): it hides the chip and the job runs on. They are
 * two buttons for a reason, and the × never reaches `onCancel`.
 */
export default function JobChip({
  state,
  onConfirm,
  onCancel,
  onDismiss,
  viewOpen = false,
}: {
  state: JobState
  /** Reset's consent (D5) — pressed only from the `confirming` phase. */
  onConfirm: () => void
  onCancel: () => void
  /** Hide the chip. Never a cancellation. */
  onDismiss: () => void
  /**
   * A lightbox or orbit overlay is open. The render queue is suspended for as
   * long as it is, and an entry that already *started* waits inside its own
   * `whenResumed()` gates where the runner's `waiting` cannot see it — the
   * one stall a user is most likely to cause. App knows the view; the runner
   * does not.
   */
  viewOpen?: boolean
}) {
  // "Waiting" is time-filtered, not read raw: `waiting` flips true on every
  // push and false as it starts, so only a wait that outlasts the threshold
  // is worth a word.
  const [stalled, setStalled] = useState(false)
  const waiting = state.phase === 'running' && (state.waiting || viewOpen)
  useEffect(() => {
    if (!waiting) {
      setStalled(false)
      return
    }
    const timer = setTimeout(() => setStalled(true), WAITING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [waiting])
  return (
    <div
      role="status"
      aria-live="polite"
      // Above the occlusion pill, which owns the corner itself (`fixed bottom-3
      // left-3` in App): the two would otherwise overlap exactly, the pill on top.
      className="fixed bottom-14 left-3 z-20 flex max-w-sm items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs text-zinc-200"
    >
      <p className="min-w-0 flex-1">
        {sentence(state)}
        {stalled && ' · waiting behind what you’re looking at'}
      </p>
      {state.phase === 'confirming' && (
        <button type="button" onClick={onConfirm} className={ACTION_CLASS}>
          Reset
        </button>
      )}
      {/* Cancel is offered exactly while there is work to stop. A finished or
          cancelled job keeps its sentence and loses the button, rather than
          offering one that would do nothing. */}
      {(state.phase === 'deriving' ||
        state.phase === 'confirming' ||
        state.phase === 'running') && (
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
  )
}

const ACTION_CLASS =
  'shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-zinc-500'

/**
 * How the scope reads inside a sentence. One helper, used by every phase, so
 * the library and a folder are never described two different ways in two
 * places — the whole-library scope is labelled `'the library'` by App (D8) and
 * "beneath the library" is not English.
 */
function scopePhrase(label: string): string {
  return label === 'the library' ? 'in the library' : `beneath ${label}`
}

/** The failed/skipped/cut tail every count-bearing phase shares. Each clause is
 *  present only when it has something to say — a `· 0 failed` is noise about
 *  nothing. */
function tail(state: JobState): string {
  return (
    (state.failed > 0 ? ` · ${state.failed} failed` : '') +
    (state.skipped > 0 ? ` · ${state.skipped} skipped` : '') +
    (state.incomplete ? ' (scope cut short)' : '')
  )
}

/** One sentence per phase, and the counters are the only numbers in any of
 *  them. */
function sentence(state: JobState): string {
  const phrase = scopePhrase(state.scope.label)
  switch (state.phase) {
    case 'deriving':
      return `Counting ${state.scope.label}…`
    case 'confirming':
      // Reset's alone, and the one number that is stated *before* anything is
      // sent: it is what the user is consenting to (D5).
      return `Reset ${state.total} framings ${phrase}?`
    case 'running':
      return `${state.operation === 'generate' ? 'Generating thumbnails' : 'Resetting framings'} ${phrase}: ${state.done} of ${state.total}${tail(state)}`
    case 'done':
      // A whole-job failure replaces the count rather than joining it: with no
      // work list, or none of it processable, "0 of 0" would be a true sentence
      // that says nothing about what went wrong.
      return state.failure !== undefined
        ? state.failure
        : state.operation === 'generate'
          ? // "Generated" counts writes: an entry the job found already current
            // on its own lookup was processed, not drawn, and says so.
            `Generated ${state.wrote} of ${state.total} ${phrase}${
              state.done - state.wrote > 0 ? ` · ${state.done - state.wrote} already current` : ''
            }${tail(state)}`
          : `Reset ${state.done} of ${state.total} ${phrase}${tail(state)}`
    case 'cancelled':
      // Cancelled during the derivation: there is no total to have got through,
      // so the sentence says what was interrupted instead of "0 of 0".
      return state.total === 0
        ? `Cancelled before counting ${state.scope.label}`
        : `Cancelled after ${state.done} of ${state.total} ${phrase}${tail(state)}`
  }
}
