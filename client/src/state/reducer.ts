/**
 * The search/view state, as one pure reducer (design R1–R6).
 *
 * The shape says what each cell is *for*, so no transition has to remember a
 * list of fields to reset, compare, restore or serialize — the lists are where
 * every one of the ten findings lived:
 *
 * - `view`     the question the app currently asserts. The URL projects it.
 * - `inflight` the question last *asked*, with the id that identifies the
 *              asking event and where it came from. Optimism lives here and
 *              nowhere else, so a failure is "clear it" rather than a revert.
 * - `phase`    `deferred` is a question — a meaning phrase or a model's
 *              neighbours — held for an index that cannot answer yet.
 *              "fetching" is not a phase — it is `inflight !== null`,
 *              and a deferral can have a stand-in fetch in flight.
 * - `result`   the question that was *answered*, carrying its own residue. It
 *              is replaced wholesale, never spread (R5).
 * - `failure`  the same, for the answer that did not come.
 * - `index`    availability as state, so the corpus decision cannot read a
 *              stale closure.
 * - `drafts`   only text the reducer itself reads.
 *
 * `view` is asserted at dispatch for transitions that cannot fail (setKinds,
 * the deferred submit, model open/close) and at landing for those that can
 * (any fetch). That one sentence is why the grid, filters and notices read
 * `result.forView` while only the URL projection and the deferred banner read
 * `view` — and why a stand-in listing under a deferred meaning search is a
 * legitimate steady state rather than a disagreement.
 */
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  SemanticScope,
} from '../../../shared/types'
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import {
  corpusOf,
  sameQuestion,
  sameView,
  SIMILAR_K,
  standInOf,
  type Prefs,
  type View,
} from './view'

/** Where a transition came from. It rides the action, lands on the result, and
 *  is what push-vs-replace, the lightbox history marker and localStorage writes
 *  derive from — never a shared "restoring" flag (R2). */
export type Source = 'user' | 'restore'

export interface Inflight {
  /**
   * The question as ASKED. Never patched: acceptance compares a response's
   * `forView` against this, so a fetchless change mid-flight cannot make the
   * answer to this very question look like an answer to a different one.
   */
  asked: View
  /**
   * The question this request will ASSERT when it lands. A fetchless view
   * change patches its field here as well as in `view`, so a concurrent
   * landing cannot revert it.
   */
  view: View
  /** The asking event. `requestRef` moved into state (R2). */
  id: number
  source: Source
  /** A listing standing in for a deferred meaning query: it renders, but it
   *  does not rename the view. */
  standIn?: true
}

/** What landed. The semantic residue is optional because only a meaning answer has it. */
export interface Landed {
  entries: DirEntry[]
  truncated?: boolean
  scope?: SemanticScope
  weak?: boolean
  capped?: boolean
  /** How many cleared the floor before the count cut them, where the index
   *  reports it (D9). Absent from a plain listing and from an older index. */
  matched?: number
  poses?: Record<string, IndexPose>
  /**
   * What the index scored each tile at, keyed by path as `poses` is. Optional
   * for the same reason the rest of this residue is: only a scored answer has
   * it, and a landing replaces the whole result (R5), so a plain listing simply
   * arrives without one rather than having to clear the last one.
   */
  scores?: Record<string, IndexScore>
  /**
   * A similarity answer's subject: the model its neighbours were computed from,
   * which the index excludes from them by design. Beside `entries` rather than
   * among them, and it stays that way all the way to the render — the grid
   * shows it first, and everything that *counts* (the empty-result sentence,
   * the omitted notice) counts `entries` alone.
   *
   * No reducer logic of its own: a `landing` replaces the whole result (R5), so
   * an answer that carries no anchor simply has none.
   */
  anchor?: DirEntry
}

export interface Result extends Landed {
  /** The question this answers — what the grid, the filters and the notices read. */
  forView: View
  source: Source
  truncated: boolean
}

export interface Failure {
  forView: View
  message: string
}

/**
 * `idle`, or a question the index cannot answer yet — holding
 * its own provenance, because that is the only place left to keep it. Every
 * other question carries its source on `inflight`, but a deferral in the `wait`
 * window has asked for nothing at all, and when the index finally answers, the
 * fire is that original asking resumed: a restored one must replace the entry
 * the link already sits on, not push a second one over it (R2).
 */
export type Phase = 'idle' | { deferred: Source }

export interface SearchState {
  view: View
  inflight: Inflight | null
  phase: Phase
  result: Result | null
  failure: Failure | null
  index: IndexAvailability | null
  drafts: { queryText: string }
  /** Monotonic asking-event counter. */
  lastId: number
}

export type Action =
  /** Enter a directory: the request that clears the search, the filter and the
   *  link's options in one — all four re-seeded from this profile's own. */
  | { type: 'navigate'; path: string; prefs: Prefs }
  /** Commit `drafts.queryText`. The corpus decides what that means. */
  | { type: 'submit' }
  | { type: 'toggleFlat' }
  | { type: 'setMode'; mode: SearchMode }
  /** `run: false` records a value the debounce is still holding; `run: true`
   *  is the fire (or a click, which is the finished value already). */
  | { type: 'setTuning'; tuning: Tuning; run: boolean }
  | { type: 'setKinds'; kinds: SearchKinds }
  | { type: 'setFolderMatching'; on: boolean }
  /** Typing in the search input. Emptying it is how a committed subject is left. */
  | { type: 'queryText'; text: string }
  /** Show the neighbours of a model: a similarity subject over the location the
   *  user is standing in. The corpus decides what that means, exactly as it does
   *  for a phrase — including deferring it while the index warms (D4). */
  | { type: 'similar'; model: string }
  /**
   * Re-shape the similarity view on screen: how many neighbours, and how the
   * index pools a model's per-view scores. The whole parameter set, never a
   * delta — an omitted `pool` is the index's own default, which is a value the
   * action can assert rather than a field it forgot.
   *
   * No record-only phase, unlike `setTuning`: a parameter here is one number
   * and one three-way choice, and the debounce that keeps a typed number from
   * becoming four questions lives in the control that types it. So this
   * transition always asks — there is nothing to record.
   */
  | { type: 'similarTuning'; k: number; pool?: Tuning['pool'] }
  /** Leave whatever subject is committed — a phrase or a model — and re-ask the
   *  location's ordinary listing (D9). One transition for both kinds, which is
   *  what makes "the same dismissal" one implementation rather than two that
   *  resemble each other. */
  | { type: 'clearSubject' }
  /** The deferred banner's offer: run the held phrase against the name corpus. */
  | { type: 'deferredToName' }
  /** A history entry or a link. The caller resolves the URL into a whole View. */
  | { type: 'restore'; view: View }
  | { type: 'landing'; id: number; forView: View; landed: Landed }
  | { type: 'failure'; id: number; forView: View; message: string }
  | { type: 'index'; availability: IndexAvailability }
  /** A user opened a lightbox. A *restored* one needs no action: its view came
   *  with the model already named, which is what tells the projection the
   *  entry is the browser's rather than one to mint (R3/R7). */
  | { type: 'modelOpen'; path: string }
  | { type: 'modelClose' }
  /** A landed listing does not contain the model the URL named (R7's bridge 4). */
  | { type: 'modelDrop' }

export function initialState(view: View, index: IndexAvailability | null = null): SearchState {
  return {
    view,
    inflight: null,
    phase: 'idle',
    result: null,
    failure: null,
    index,
    drafts: { queryText: view.subject.kind === 'query' ? view.subject.text : '' },
    lastId: 0,
  }
}

/**
 * The question the app currently stands behind: the one in flight if there is
 * one, else the one it asserts. This is what a control acts on — `dest` is
 * this rule read for `path` (R1), and every other option follows it for the
 * same reason: a search submitted mid-navigation follows the user.
 *
 * A stand-in is skipped, because it is not the question: while a meaning query
 * is deferred, the request in flight is the placeholder listing and the
 * question is still the deferred search.
 */
export function liveView(state: SearchState): View {
  return state.inflight !== null && state.inflight.standIn !== true
    ? state.inflight.view
    : state.view
}

/** Ask `view`, from `source`. The asked view and the assert view start equal;
 *  only fetchless patches part them. */
function ask(state: SearchState, view: View, source: Source, standIn?: true): SearchState {
  const id = state.lastId + 1
  return { ...state, lastId: id, inflight: { asked: view, view, id, source, standIn } }
}

/**
 * A view change that asks nothing: asserted at dispatch, and patched into the
 * request in flight too so its landing cannot revert it. Never `path`/`subject`
 * — those change what was asked, which is a new request by definition.
 *
 * It reaches the *answer* as well, for the same reason the landing takes the
 * patched view rather than the asked one: a fetchless change belongs to the
 * answer it stands beside. The render reads `result.forView` (R1's corollary),
 * so a patch that stopped at `view` left the kind control inert — the URL said
 * `kinds=models` while the grid went on showing the folders — and left
 * `stoodIn` claiming a stand-in after every lightbox open. Only `forView` is
 * replaced: R5's wholesale rule is about `entries` identity, which useThumbnails
 * resets on, and this spread preserves it.
 */
function patch(state: SearchState, fields: Partial<View>): SearchState {
  return {
    ...state,
    view: { ...state.view, ...fields },
    inflight:
      state.inflight === null
        ? null
        : { ...state.inflight, view: { ...state.inflight.view, ...fields } },
    result:
      state.result === null
        ? null
        : { ...state.result, forView: { ...state.result.forView, ...fields } },
  }
}

/**
 * The deferral's exit (R6): the phase ends and the held question stops being
 * asserted — it clears the *subject*, whichever kind it is, so the banner goes
 * and the URL stops naming a search, or a model's neighbours, that nobody is
 * waiting for. Every cancel path — navigating, emptying the input, searching by
 * name, dismissing — goes through here, which is why there is no path that
 * leaves a dead deferral behind to fire later.
 */
function endDeferral(state: SearchState): SearchState {
  if (state.phase === 'idle') return state
  return { ...state, phase: 'idle', view: { ...state.view, subject: { kind: 'none' } } }
}

/** Enter the deferred phase for `view`: asserted at dispatch (holding a
 *  question cannot fail), with the placeholder listing asked for at once —
 *  unless the probe has not answered at all, when nothing is asked. */
function defer(state: SearchState, view: View, source: Source, probed: boolean): SearchState {
  // The failure goes with the question that earned it: a deferral is a fresh
  // question, and leaving the old message standing would make `busy` read a
  // stale error as this deferral's own answer.
  const held: SearchState = {
    ...state,
    phase: { deferred: source },
    view,
    inflight: null,
    failure: null,
  }
  return probed ? ask(held, standInOf(view), source, true) : held
}

/** Whether the placeholder is already on screen — derived, not remembered
 *  (R6): the result answers a different question than the view asserts. */
export function stoodIn(state: SearchState): boolean {
  return state.result !== null && !sameView(state.result.forView, state.view)
}

/** Whether a response belongs to the question in flight: the asking event and
 *  the question as asked must BOTH match (R2). Value equality alone would
 *  invert latest-wins for an identical re-submission — the stale answer would
 *  be taken, clearing `inflight`, and the fresh one rejected. */
function accepts(state: SearchState, id: number, forView: View): state is SearchState & {
  inflight: Inflight
} {
  const f = state.inflight
  return f !== null && f.id === id && sameView(forView, f.asked)
}

/**
 * Whether two availability reads say the same thing, down to `elapsed` — the
 * side panel counts the wait out loud. The warming poll asks every 2s and each
 * answer is a fresh object; without this the state changes identity on a probe
 * that changed nothing, and the whole app re-renders for it.
 */
export function sameAvailability(a: IndexAvailability | null, b: IndexAvailability): boolean {
  return (
    a !== null &&
    a.state === b.state &&
    a.collectionRoot === b.collectionRoot &&
    a.elapsed === b.elapsed &&
    a.detail === b.detail &&
    (a.covers ?? []).length === (b.covers ?? []).length &&
    (a.covers ?? []).every((c, i) => c === (b.covers ?? [])[i])
  )
}

/** Ask the committed query of whichever corpus owns it now — the one decision,
 *  shared by submit, the mode flip, the tuning re-run and restore (R6). */
function askCommitted(state: SearchState, view: View, source: Source): SearchState {
  switch (corpusOf(view, state.index)) {
    case 'defer':
      return defer(endDeferral(state), view, source, true)
    case 'wait':
      return defer(endDeferral(state), view, source, false)
    default:
      return ask(endDeferral(state), view, source)
  }
}

/**
 * Leave the committed subject (D9): it becomes `none`, any deferral ends on the
 * way through, and the location's ordinary listing is re-asked — asserted at
 * landing like any other fetch.
 *
 * ONE rule for both kinds of subject, and one implementation for both ways of
 * invoking it: the dismiss control dispatches `clearSubject`, and emptying the
 * search input delegates here rather than keeping a copy of the rule. Before
 * the subject existed those were necessarily different code, because the only
 * exit was emptying an input a similarity view has nothing in.
 */
function leaveSubject(state: SearchState): SearchState {
  const base = liveView(state)
  if (base.subject.kind === 'none') return state
  return ask(endDeferral(state), { ...base, subject: { kind: 'none' }, model: null }, 'user')
}

export function reducer(state: SearchState, action: Action): SearchState {
  switch (action.type) {
    case 'navigate': {
      // Navigation is itself the request that clears the search state — and
      // the options with it: a link's options governed the view it named, so
      // once the user leaves it their own preferences are in force again. All
      // four, from the action: restoring two of them is how a link's mode and
      // tuning outlived the view they belonged to.
      const view: View = {
        ...action.prefs,
        path: action.path,
        flat: liveView(state).flat,
        subject: { kind: 'none' },
        model: null,
      }
      return ask(
        { ...endDeferral(state), drafts: { ...state.drafts, queryText: '' } },
        view,
        'user',
      )
    }

    case 'submit': {
      const q = state.drafts.queryText.trim()
      // A blank or whitespace-only submit is not a search — nothing to commit.
      if (q === '') return state
      const view: View = { ...liveView(state), subject: { kind: 'query', text: q }, model: null }
      return askCommitted(state, view, 'user')
    }

    case 'similar': {
      // A model's neighbours, anchored at the location the user is standing in
      // — the anchor is what the dismissal returns to, and what tells two
      // similarity views of one model apart (`requestOf`). Routed through the
      // one corpus decision, so it defers and waits exactly as meaning does,
      // and the deferral holds its own provenance.
      // The parameters start at their defaults: `SIMILAR_K` neighbours, and no
      // pool at all — absence being the index's own, which is what an
      // untouched view asks for.
      const view: View = {
        ...liveView(state),
        subject: { kind: 'similar', model: action.model, k: SIMILAR_K },
        model: null,
      }
      // The draft goes with it, as it does on a `navigate`. Text left in the
      // input under a similarity view is a trap: it relates to nothing on
      // screen, and erasing it — the natural gesture for a stale box — runs the
      // shared leave-subject rule and destroys the view. Cleared here, the input
      // says what is true (nothing textual is committed), and typing then
      // erasing still dismisses by that one rule, so the delegation keeps a
      // user-visible instance rather than becoming unreachable.
      return askCommitted(
        { ...state, drafts: { ...state.drafts, queryText: '' } },
        view,
        'user',
      )
    }

    case 'similarTuning': {
      const base = liveView(state)
      // Only a similarity view has these to change. Under any other subject
      // the control is not on screen, and asserting a parameter set onto a
      // subject that reads none would put a `k` in the URL of a view that
      // cannot use it — the mode's own mistake, in a different slot.
      if (base.subject.kind !== 'similar') return state
      // A different parameter is a different question, so this re-asks by the
      // one corpus decision — deferring while the index warms exactly as a
      // fresh find-similar would, rather than firing at an index that cannot
      // answer.
      const view: View = {
        ...base,
        subject: { ...base.subject, k: action.k, pool: action.pool },
        model: null,
      }
      return askCommitted(state, view, 'user')
    }

    case 'clearSubject':
      return leaveSubject(state)

    case 'toggleFlat': {
      // Deep results are flat-shaped regardless of the toggle, so pressing it
      // is an ordinary listing request and the subject stops being committed.
      const base = liveView(state)
      const view: View = { ...base, flat: !base.flat, subject: { kind: 'none' }, model: null }
      return ask(endDeferral(state), view, 'user')
    }

    case 'setMode': {
      const base = liveView(state)
      // The mode is the corpus a typed *phrase* goes to, so it re-asks only
      // when a phrase is what the view is about. With nothing committed it is
      // the next search's; under a similarity subject it is the next search's
      // too — that view neither reads the mode nor names it in its URL, so
      // re-asking would spend a request on a question that did not change.
      if (base.subject.kind !== 'query') return patch(state, { mode: action.mode })
      return askCommitted(state, { ...base, mode: action.mode, model: null }, 'user')
    }

    case 'setTuning': {
      const recorded = patch(state, { tuning: action.tuning })
      if (!action.run) return recorded
      const base = liveView(recorded)
      // Only a runnable meaning query re-runs. A tuning change never defers:
      // it shapes a query the index is already answering, and holding it would
      // turn a slider into a search nobody asked for.
      if (base.subject.kind !== 'query' || corpusOf(base, recorded.index) !== 'meaning') {
        return recorded
      }
      return ask(recorded, { ...base, model: null }, 'user')
    }

    /** The kind option selects among entries already returned — no request. */
    case 'setKinds':
      return patch(state, { kinds: action.kinds })

    case 'setFolderMatching': {
      const base = liveView(state)
      // It decides which entries the *name corpus* returns, so a committed
      // query re-runs. A similarity view neither sends it nor names it, so it
      // records like a plain listing's does — the next search's setting.
      if (base.subject.kind !== 'query') return patch(state, { folderMatching: action.on })
      return askCommitted(state, { ...base, folderMatching: action.on, model: null }, 'user')
    }

    case 'queryText': {
      const typed: SearchState = { ...state, drafts: { ...state.drafts, queryText: action.text } }
      if (action.text.trim() !== '') return typed
      // Emptying the input is how a committed subject is left — delegated to
      // the one rule (D9) rather than kept as a second copy of it, so the
      // dismiss control and this path cannot drift apart.
      return leaveSubject(typed)
    }

    case 'deferredToName': {
      // Offered rather than done for the user: substituting the corpus is only
      // honest when it was asked for, and the banner's button is the asking.
      // Only a phrase can be offered — a deferred similarity view has no text
      // to run against the name corpus, so its banner's only offer is the
      // dismiss.
      const subject = state.view.subject
      if (state.phase === 'idle' || subject.kind !== 'query') return state
      return ask(endDeferral(state), { ...state.view, subject, mode: 'name', model: null }, 'user')
    }

    case 'restore': {
      const v = action.view
      // A history entry that asks the same question is not a different
      // listing: patch its request-irrelevant fields and keep the answer we
      // already have, or the one already on its way. Every field below is one
      // `requestOf` does not read — a difference that mattered would have
      // changed the request and failed the compare — and patching them is what
      // keeps the asserted view in lockstep with the URL the browser restored.
      // `patch` forwards them to `result.forView` too, which is what re-filters
      // the grid without asking anything. (`path`/`subject` stay out by patch's
      // own rule; under `sameQuestion` they cannot differ in a way the request
      // sees — which for a similarity view is why its anchor is in the request
      // at all, since patching `path` is exactly what this branch cannot do.)
      if ((state.result !== null || state.inflight !== null) && sameQuestion(v, liveView(state))) {
        return {
          ...patch(state, {
            model: v.model,
            kinds: v.kinds,
            flat: v.flat,
            mode: v.mode,
            folderMatching: v.folderMatching,
            tuning: v.tuning,
          }),
          // The failure belonged to some other question — this branch runs only
          // when the answer already on screen, or already on its way, is this
          // view's own. Leaving it standing left a dead message in the path bar
          // for the rest of the session: land /a, follow a link that fails, come
          // back, and the grid is right while the error still accuses it. Only
          // this branch clears it; `patch` must not, or a lightbox open would
          // wipe the report of the failure it was opened in spite of.
          failure: null,
        }
      }
      // The input shows the restored query — and nothing, for a subject that is
      // not one. The filter is not part of the view a URL names, so it is the
      // caller's to clear.
      const seeded: SearchState = {
        ...state,
        drafts: {
          ...state.drafts,
          queryText: v.subject.kind === 'query' ? v.subject.text : '',
        },
      }
      return askCommitted(seeded, v, 'restore')
    }

    case 'landing': {
      if (!accepts(state, action.id, action.forView)) return state
      const f = state.inflight
      const result: Result = {
        // The patched assert-view, never the action's `forView`: a fetchless
        // change made while this request was in flight belongs to the answer
        // it lands with.
        forView: f.view,
        source: f.source,
        entries: action.landed.entries,
        truncated: action.landed.truncated === true,
        scope: action.landed.scope,
        weak: action.landed.weak,
        capped: action.landed.capped,
        matched: action.landed.matched,
        poses: action.landed.poses,
        scores: action.landed.scores,
        anchor: action.landed.anchor,
      }
      // A stand-in renders without renaming the view: the URL still names the
      // meaning search, the deferral still waits, and the grid shows the
      // location's own contents meanwhile.
      if (f.standIn === true) return { ...state, inflight: null, failure: null, result }
      // `phase` is deliberately untouched: leaving a deferral is the job of the
      // transition that asked something else, and a landing that quietly tidied
      // the phase would hide a cancel path that forgot to.
      return { ...state, view: f.view, inflight: null, failure: null, result }
    }

    case 'failure': {
      if (!accepts(state, action.id, action.forView)) return state
      // Keep the view, clear the optimism, say what went wrong. There is no
      // revert to get wrong: nothing advanced.
      return {
        ...state,
        inflight: null,
        failure: { forView: state.inflight.view, message: action.message },
      }
    }

    case 'index': {
      const known = sameAvailability(state.index, action.availability)
        ? state
        : { ...state, index: action.availability }
      if (known.phase === 'idle' || known.view.subject.kind === 'none') return known
      const source = known.phase.deferred
      if (action.availability.state === 'ready') {
        // The link finally doing what it named. It runs for the view that
        // deferred it and only that one — every other path out of the phase
        // cancels it, so there is no stale deferral left to fire. Under the
        // deferral's own provenance: this is the asking event resumed, so a
        // restored one still replaces rather than pushing.
        return ask({ ...known, phase: 'idle' }, known.view, source)
      }
      // Cannot answer yet: stand in with the location's own contents, once.
      if (known.inflight !== null || stoodIn(known)) return known
      return ask(known, standInOf(known.view), source, true)
    }

    case 'modelOpen':
      return patch(state, { model: action.path })

    case 'modelClose':
      return patch(state, { model: null })

    case 'modelDrop':
      return patch(state, { model: null })
  }
}
