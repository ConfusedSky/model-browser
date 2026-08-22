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
import type { DirEntry } from '../../../shared/types'
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { liveView, type SearchState } from './reducer'
import { requestOf, type Request, type View } from './view'

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
  query: string | null
} {
  const v = liveView(state)
  return {
    flat: v.flat,
    mode: v.mode,
    kinds: v.kinds,
    folderMatching: v.folderMatching,
    tuning: v.tuning,
    query: v.q,
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
 * only, which is the same two-dimensional gate `serializeView` applies — a
 * committed query, under the mode that reads the option — and it has to be the
 * same one, or the URL and the grid disagree about whether the option is even
 * in force. It was not: the option is sticky and the panel hides its control
 * outside name mode, so a `folders` left over from a name search rode into a
 * meaning view and emptied the grid ("No folders matched") over an option with
 * no control to undo it and, once the URL stopped naming it, nothing on screen
 * to explain it. Reads the *answered* view, so flipping it mid-flight cannot
 * filter a grid by a rule its results never ran under.
 */
export function byKind(state: SearchState): DirEntry[] {
  const r = state.result
  if (r === null) return []
  const { q, kinds, mode } = r.forView
  if (q === null || mode !== 'name' || kinds === 'both') return r.entries
  return r.entries.filter((e) => (kinds === 'folders' ? e.kind !== 'model' : e.kind === 'model'))
}

/** Which kinds the omitted-entries notice counts by — 'both' wherever the
 *  option selects nothing (a plain listing, or a meaning search: `byKind`'s
 *  gate, which is `serializeView`'s), where counting by it produced a sentence
 *  with no parts. */
export function noticeKinds(state: SearchState): SearchKinds {
  const v = state.result?.forView
  return v !== undefined && v.q !== null && v.mode === 'name' ? v.kinds : 'both'
}

/** Everything the results label is built from, all of it from the answer. */
export function labelInputs(state: SearchState): {
  query: string | null
  meaning: boolean
  weak: boolean
  capped: boolean
  truncated: boolean
} {
  const r = state.result
  return {
    query: r?.forView.q ?? null,
    meaning: r?.scope !== undefined && r.scope !== null,
    weak: r?.weak === true,
    capped: r?.capped === true,
    truncated: r?.truncated === true,
  }
}
