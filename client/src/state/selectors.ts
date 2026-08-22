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
 */
export function busy(state: SearchState): boolean {
  return state.inflight !== null || (state.phase === 'deferred' && state.result === null)
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

/** The landed entries the kind option leaves. It restricts search results
 *  only — a plain listing is left alone — and it reads the *answered* view, so
 *  flipping it mid-flight cannot filter a grid by a rule its results never ran
 *  under. */
export function byKind(state: SearchState): DirEntry[] {
  const r = state.result
  if (r === null) return []
  const { q, kinds } = r.forView
  if (q === null || kinds === 'both') return r.entries
  return r.entries.filter((e) => (kinds === 'folders' ? e.kind !== 'model' : e.kind === 'model'))
}

/** Which kinds the omitted-entries notice counts by — 'both' over a plain
 *  listing, where the option selects nothing and counting by it produced a
 *  sentence with no parts. */
export function noticeKinds(state: SearchState): SearchKinds {
  const v = state.result?.forView
  return v !== undefined && v.q !== null ? v.kinds : 'both'
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
