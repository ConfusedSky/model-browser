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
 *
 * A stale listing's follow-up (`listing-tree-cache` §5.2) is the one request
 * that owes the user nothing: the answer it corrects is already on screen and
 * stays there while it runs. Counting it would hand the skeleton the whole
 * length of the server's revalidation pass — ~5.6s cold — and blank exactly the
 * cached listing that feature exists to keep visible. The "refreshing"
 * affordance in the results header says it is happening instead.
 */
export function busy(state: SearchState): boolean {
  return (
    (state.inflight !== null && state.inflight.followUp !== true) ||
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
 * The listing that is *answered* and on screen, if the answer is one: the
 * asking event it landed under and the entries it put there.
 *
 * What the pose wave is fired for and dropped by (pose-for-every-model D3).
 * `null` for a meaning or similarity answer, whose hits carried their own poses
 * — asking again would spend a request to be told what the landing already
 * said. Derived from `requestOf`, like `pendingRequest` above, so "is this a
 * plain listing" is the same question here as it is at the fetch layer rather
 * than a second reading of the view's fields.
 *
 * All three listing shapes count, because `requestOf` calls all three a
 * `listing`: a plain directory, a *flat* one, and a name search. The wave was
 * written for the first and quietly did nothing for the other two while it
 * asked about a directory — a flat listing's models live in subfolders and a
 * name search's are drawn from a whole subtree, so a directory's direct
 * children are the wrong set both times. It carries the entries instead, and
 * they are all one case again.
 *
 * `entries` is the landing's own array by reference, never a copy or a
 * filtered view: it is what makes "once per landing" expressible as a
 * dependency. `patch` spreads `result` but carries `entries` through, so
 * opening a lightbox does not re-fire the wave.
 *
 * A *stand-in* listing counts: it is a real listing on screen, and its tiles
 * want their orientations while the deferred search waits.
 */
export function landedListing(state: SearchState): { id: number; entries: DirEntry[] } | null {
  const r = state.result
  if (r === null) return null
  return requestOf(r.forView).kind === 'listing' ? { id: r.id, entries: r.entries } : null
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
  // The root is `/` whenever the index is rooted at the library top — the
  // common case — and `${'/'}/` is `//`, which no path begins with.
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
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
  capping: boolean
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
    // How many tiles this view actually has — the other half of "60 of 875".
    // Deliberately not the kind-filtered list: `matched` counts what the
    // *index* had, so the number set against it has to be the index's too, or
    // the sentence compares two different populations. Not quite "what the
    // index returned" either: a hit whose file no longer stats is dropped
    // building the entries, so this can sit a little under the count in force.
    // The sentence stays true — it says how many are shown, not what cut them.
    shown: r?.entries.length ?? 0,
    // Whether **both** bounds were in force for this result, which is the only
    // state where "N of M above the floor" is a true sentence. Each half was
    // learned the hard way and from opposite directions:
    //
    // - without the count, the set is short because the index's *cap* bit, and
    //   a second sentence reports that cut twice while crediting it to a bound
    //   nobody set (found in the E2E pass);
    // - without the floor, `matched` is not a floor set at all — the index
    //   reports it on every response, and floorless it is everything scored
    //   (measured: `{top: 10}` with no floor answers `matched` 2165 of a 2165
    //   model collection), so the sentence would name a floor nobody set and
    //   call the whole collection its result.
    //
    // The requirement scopes the clause the same way: *where a count caps a
    // floor-bounded set*.
    capping: r?.forView.tuning.top !== undefined && r?.forView.tuning.minScore !== undefined,
  }
}
