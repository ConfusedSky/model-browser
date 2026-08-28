/**
 * What the render reads.
 *
 * The corollary of "assert vs answer" (design R1): the grid, the filters and
 * the notices read `result.forView` — the question that was *answered* —
 * while only the URL projection and the deferred banner read `view`. Reading
 * `view` for a label is what made a deferred search have to null its own query
 * to keep the grid honest.
 *
 * The controls are the third case: they act on the question the app currently
 * stands behind, in flight or asserted (`liveView`), which is why the path bar
 * shows a directory the moment it is requested.
 */
import type { DirEntry, IndexAvailability } from '../../../shared/types'
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { liveView, type SearchState } from './reducer'
import { requestOf, type Request, type Subject, type View } from './view'

export { liveView, stoodIn } from './reducer'

/** The place the user most recently asked for, in flight or committed. Every
 *  header control keys off it: the bar shows it, ↑ ascends from it, the flat
 *  toggle re-requests it. */
export function dest(state: SearchState): string {
  return liveView(state).path
}

/**
 * Whether the app owes the user an answer. A deferral with nothing on screen
 * counts — that is the window where the availability probe has not answered
 * and *nothing at all* has been requested — while a deferral standing behind a
 * placeholder does not: the grid is showing something true.
 *
 * A failed stand-in ends the debt too, and that is not a nicety: nothing is in
 * flight, so nothing was going to clear it, and the skeleton this drives
 * replaces the grid — the error, the banner and the way out all sat behind a
 * spinner that would never stop.
 */
export function busy(state: SearchState): boolean {
  return (
    state.inflight !== null ||
    (state.phase !== 'idle' && state.result === null && state.failure === null)
  )
}

/** The values the search controls display: the question in flight if there is
 *  one, so a click reads as pressed before its answer arrives. */
export function controls(state: SearchState): {
  flat: boolean
  mode: SearchMode
  kinds: SearchKinds
  folderMatching: boolean
  tuning: Tuning
  /** What the live view is about. The subject itself rather than a phrase
   *  pulled out of it: a control that asks "is anything committed" and one that
   *  renders the committed text are different questions, and answering both
   *  from one string is what let a similarity view read as nothing committed. */
  subject: Subject
} {
  const v = liveView(state)
  return {
    flat: v.flat,
    mode: v.mode,
    kinds: v.kinds,
    folderMatching: v.folderMatching,
    tuning: v.tuning,
    subject: v.subject,
  }
}

/** The request `inflight` names, derived rather than stored (R4). The effect
 *  layer runs this; nothing else needs to know how a view becomes a call. */
export function pendingRequest(
  state: SearchState,
): (Request & { id: number; forView: View }) | null {
  const f = state.inflight
  return f === null ? null : { ...requestOf(f.view), id: f.id, forView: f.asked }
}

/**
 * The landed entries the kind option leaves. It restricts *name* search results
 * only, which is the same gate `serializeView` applies — the option is read
 * only when the subject is a query, under the mode that reads it — and it has
 * to be the same one, or the URL and the grid disagree about whether the option
 * is even in force. It was not: the option is sticky and the panel hides its control
 * outside name mode, so a `folders` left over from a name search rode into a
 * meaning view and emptied the grid ("No folders matched") over an option with
 * no control to undo it and, once the URL stopped naming it, nothing on screen
 * to explain it. Reads the *answered* view, so flipping it mid-flight cannot
 * filter a grid by a rule its results never ran under.
 */
export function byKind(state: SearchState): DirEntry[] {
  const r = state.result
  if (r === null) return []
  const { subject, kinds, mode } = r.forView
  if (subject.kind !== 'query' || mode !== 'name' || kinds === 'both') return r.entries
  return r.entries.filter((e) => (kinds === 'folders' ? e.kind !== 'model' : e.kind === 'model'))
}

/** Which kinds the omitted-entries notice counts by — 'both' wherever the
 *  option selects nothing (a plain listing, a similarity result, or a meaning
 *  search: `byKind`'s gate, which is `serializeView`'s), where counting by it
 *  produced a sentence with no parts. */
export function noticeKinds(state: SearchState): SearchKinds {
  const v = state.result?.forView
  return v !== undefined && v.subject.kind === 'query' && v.mode === 'name' ? v.kinds : 'both'
}

/**
 * Whether the index could plausibly answer about `path` — it is inside the
 * collection the index covers, and it is not inside an archive.
 *
 * The state half of the per-kind availability table (D6): the menu asks this
 * rather than deriving the rule beside the side panel's copy of it, and neither
 * probes the index per tile. Optimism is the design (D4/4.4): asking about every
 * tile in a 500-tile grid to grey out an item nobody has opened is not a trade
 * worth making, so the affordance is offered wherever it *could* work and the
 * failure is explained when it comes.
 *
 * A prefix check is the right approximation: the server still compares resolved
 * real paths — the library lives on removable media and a remount moves the
 * mount point without changing the tree — so a disagreement costs the affordance
 * rather than producing a wrong answer.
 *
 * Availability itself is `index.state`, which callers gate on separately: this
 * answers "is this path in range", not "is the index up".
 */
export function indexCovers(index: IndexAvailability | null, path: string): boolean {
  const root = index?.collectionRoot
  if (root === undefined || path.includes('!/')) return false
  return path === root || path.startsWith(`${root}/`)
}

/**
 * Everything the results label is built from, all of it from the answer.
 *
 * The subject rather than a query string: the label reads it to say what the
 * view is, and the "nothing matched" gate reads it to decide whether an empty
 * grid is an empty *answer* or an empty folder. Pulling a phrase out here made
 * both wrong at once for a similarity result — a blank label, and an empty
 * result falling through to Grid's bare "Nothing to show here."
 */
export function labelInputs(state: SearchState): {
  subject: Subject
  meaning: boolean
  weak: boolean
  capped: boolean
  truncated: boolean
  matched: number | undefined
  shown: number
  counted: boolean
} {
  const r = state.result
  return {
    subject: r?.forView.subject ?? { kind: 'none' },
    meaning: r?.scope !== undefined && r.scope !== null,
    weak: r?.weak === true,
    capped: r?.capped === true,
    truncated: r?.truncated === true,
    // A number, not a flag: the label needs the count itself, and its absence
    // is a third state (the index did not say) rather than a zero.
    matched: r?.matched,
    // What the index actually returned for this query — the other half of
    // "60 of 875". Deliberately not the kind-filtered list: `matched` counts
    // what the *index* had, so the number set against it has to be the index's
    // too, or the sentence compares two different populations.
    shown: r?.entries.length ?? 0,
    // Whether a count of the *user's* was in force for this result. `matched`
    // alone is not enough to speak: in the floor-only state the set is short
    // because the index's cap bit, which the cap notice already attributes,
    // and a second sentence there would report the same cut twice while
    // crediting it to a bound nobody set (found in the E2E pass).
    counted: r?.forView.tuning.top !== undefined,
  }
}
