/**
 * The search/view state, as one pure reducer (R1–R6). Three cells hold three
 * different questions: `view` is asserted, `inflight` was asked, `result` was
 * answered — and "fetching" is not a phase, it is `inflight !== null`.
 *
 * `view` is asserted at dispatch where a transition cannot fail and at landing
 * where it can, which is why the render reads `result.forView`.
 */
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  SemanticScope,
} from "../../../shared/types";
import type { SearchKinds, SearchMode, Tuning } from "../lib/searchOptions";
import {
  corpusOf,
  sameQuestion,
  sameView,
  SIMILAR_K,
  standInOf,
  type Prefs,
  type View,
} from "./view";

/** Where a transition came from — what push-vs-replace and the history marker
 *  derive from, never a shared "restoring" flag (R2). */
export type Source = "user" | "restore";

export interface Inflight {
  /** The question as ASKED. Never patched — `accepts` compares against it. */
  asked: View;
  /**
   * The question this request will ASSERT when it lands. A fetchless view
   * change patches its field here as well as in `view`, so a concurrent
   * landing cannot revert it.
   */
  view: View;
  /** The asking event — identity in state rather than in a ref (R2). */
  id: number;
  source: Source;
  /** A listing standing in for a deferred meaning query: it renders, but it
   *  does not rename the view. */
  standIn?: true;
  /** The one follow-up a stale-marked listing asks for (`listing-tree-cache`
   *  §5.2). Ordinary in every respect but one: `busy` skips it, so the cached
   *  listing stays on screen instead of a skeleton. */
  followUp?: true;
}

/** What landed; the semantic residue is optional because only a scored answer
 *  has it, and a landing replaces the result wholesale (R5). */
export interface Landed {
  entries: DirEntry[];
  truncated?: boolean;
  /** Answered from a tree not yet checked against the filesystem
   *  (`listing-tree-cache` §5.1); never `false` on the wire. */
  stale?: boolean;
  scope?: SemanticScope;
  weak?: boolean;
  capped?: boolean;
  /** How many cleared the floor before the count cut them (D9). */
  matched?: number;
  poses?: Record<string, IndexPose | null>;
  scores?: Record<string, IndexScore>;
  /** A similarity answer's subject, which the index excludes from its own
   *  neighbours. Beside `entries` and never among them, so everything that
   *  counts — the empty sentence, the omitted notice — counts `entries`. */
  anchor?: DirEntry;
}

export interface Result extends Landed {
  forView: View;
  source: Source;
  truncated: boolean;
  stale: boolean;
  /** The whole once-guard: a follow-up that comes back stale asks nothing
   *  more. On the answer, so navigating away and back earns a fresh one. */
  followUp?: true;
  /** Kept past the landing that cleared `inflight`, which a second wave has
   *  nothing left to compare against (D3). Monotonic. */
  id: number;
}

export interface Failure {
  forView: View;
  message: string;
}

/** A question held for an index that cannot answer yet. It carries its own
 *  provenance because a `wait`-window deferral has no `inflight` to keep it
 *  on, and the eventual fire is that asking resumed (R2). */
export type Phase = "idle" | { deferred: Source };

export interface SearchState {
  view: View;
  inflight: Inflight | null;
  phase: Phase;
  result: Result | null;
  failure: Failure | null;
  index: IndexAvailability | null;
  drafts: { queryText: string };
  /** Beside `result` because the server did not send them, and cleared by every
   *  landing rather than at `navigate`: the old listing is still on screen
   *  until its successor lands (D3). */
  listingPoses: Record<string, IndexPose | null> | null;
  /** Monotonic asking-event counter. */
  lastId: number;
}

export type Action =
  /** Clears the search, the filter and the link's options in one. */
  | { type: "navigate"; path: string; prefs: Prefs }
  /** Commit `drafts.queryText`. The corpus decides what that means; `mode`
   *  overrides it for this one search — a query shaped like a file name is
   *  asked of the names whatever the switch says. */
  | { type: "submit"; mode?: SearchMode }
  /** Run a phrase the app supplied (`landing-page` D4). One transition, mode
   *  and all, because "set the draft then submit" is two dispatches across a
   *  render. It carries no location: it runs at the library's top. */
  | { type: "runQuery"; text: string; mode: SearchMode }
  | { type: "toggleFlat" }
  | { type: "setMode"; mode: SearchMode }
  /** `run: false` records a value the debounce is still holding; `run: true`
   *  is the fire (or a click, which is the finished value already). */
  | { type: "setTuning"; tuning: Tuning; run: boolean }
  | { type: "setKinds"; kinds: SearchKinds }
  | { type: "setFolderMatching"; on: boolean }
  /** Typing in the search input. Emptying it is how a committed subject is left. */
  | { type: "queryText"; text: string; prefs?: Prefs }
  /** Neighbours of a model, anchored where the user stands. Routed through the
   *  corpus decision, so it defers while the index warms exactly as a phrase
   *  does (D4). */
  | { type: "similar"; model: string }
  /** The whole parameter set, never a delta: an omitted `pool` asserts the
   *  index's own default. Always asks — the debounce lives in the control, so
   *  there is no record-only phase as `setTuning` has. */
  | { type: "similarTuning"; k: number; pool?: Tuning["pool"] }
  /** Leave whatever subject is committed, phrase or model, by one rule (D9).
   *  `prefs`, as on `navigate`, puts the profile's own options back in force:
   *  a search can run under options that are not the profile's (a link's, or
   *  a file name asked of the names), and browsing on must not inherit them. */
  | { type: "clearSubject"; prefs?: Prefs }
  /** The deferred banner's offer: run the held phrase against the name corpus. */
  | { type: "deferredToName" }
  /** A history entry or a link. The caller resolves the URL into a whole View. */
  | { type: "restore"; view: View }
  | { type: "landing"; id: number; forView: View; landed: Landed }
  | { type: "failure"; id: number; forView: View; message: string }
  | { type: "index"; availability: IndexAvailability }
  /** A user opened a lightbox; a *restored* one needs no action, its view
   *  already names the model (R3/R7). */
  | { type: "modelOpen"; path: string }
  | { type: "modelClose" }
  /** A landed listing does not contain the model the URL named (R7's bridge 4). */
  | { type: "modelDrop" }
  /** `id` is the `Result.id` this wave was fired for, which drops one that
   *  answers about a view the user has left. */
  | {
      type: "listingPoses";
      id: number;
      poses: Record<string, IndexPose | null>;
    }
  /** Ask the answer on screen again because it said it was stale
   *  (`listing-tree-cache` §5.2). `id` as `listingPoses` uses it. */
  | { type: "revalidate"; id: number };

export function initialState(
  view: View,
  index: IndexAvailability | null = null,
): SearchState {
  return {
    view,
    inflight: null,
    phase: "idle",
    result: null,
    failure: null,
    index,
    drafts: {
      queryText: view.subject.kind === "query" ? view.subject.text : "",
    },
    listingPoses: null,
    lastId: 0,
  };
}

/** In flight if there is one, else asserted, so a search submitted
 *  mid-navigation follows the user (R1). A stand-in is skipped: the placeholder
 *  is not the question, the deferred search still is. */
export function liveView(state: SearchState): View {
  return state.inflight !== null && state.inflight.standIn !== true
    ? state.inflight.view
    : state.view;
}

/** Ask `view`. Asked and assert start equal; only fetchless patches part
 *  them. */
function ask(
  state: SearchState,
  view: View,
  source: Source,
  kind?: { standIn?: true; followUp?: true },
): SearchState {
  const id = state.lastId + 1;
  return {
    ...state,
    lastId: id,
    inflight: { asked: view, view, id, source, ...kind },
  };
}

/**
 * A view change that asks nothing, patched into the request in flight and the
 * answer on screen as well as `view` — never `path`/`subject`, which are a new
 * request. It **must** reach `result.forView`, the thing the render reads, or
 * the kind control goes inert and `stoodIn` claims a stand-in after every
 * lightbox open. `entries` identity survives the spread (R5).
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
  };
}

/** The deferral's exit (R6): the phase ends and the subject is cleared. Every
 *  cancel path goes through here, so no dead deferral is left to fire. */
function endDeferral(state: SearchState): SearchState {
  if (state.phase === "idle") return state;
  return {
    ...state,
    phase: "idle",
    view: { ...state.view, subject: { kind: "none" } },
  };
}

/** Enter the deferred phase for `view`: asserted at dispatch (holding a
 *  question cannot fail), with the placeholder listing asked for at once —
 *  unless the probe has not answered at all, when nothing is asked. */
function defer(
  state: SearchState,
  view: View,
  source: Source,
  probed: boolean,
): SearchState {
  // The failure goes with the question that earned it, or `busy` reads a stale
  // error as this deferral's own answer.
  const held: SearchState = {
    ...state,
    phase: { deferred: source },
    view,
    inflight: null,
    failure: null,
  };
  return probed ? ask(held, standInOf(view), source, { standIn: true }) : held;
}

/** Whether the placeholder is already on screen — derived, not remembered
 *  (R6): the result answers a different question than the view asserts. */
export function stoodIn(state: SearchState): boolean {
  return state.result !== null && !sameView(state.result.forView, state.view);
}

/** The asking event and the question as asked must BOTH match (R2): value
 *  equality alone inverts latest-wins for an identical re-submission. */
function accepts(
  state: SearchState,
  id: number,
  forView: View,
): state is SearchState & {
  inflight: Inflight;
} {
  const f = state.inflight;
  return f !== null && f.id === id && sameView(forView, f.asked);
}

/** Down to `elapsed`, which the side panel counts out loud. Each poll answer
 *  is a fresh object, so without this the whole app re-renders per probe. */
export function sameAvailability(
  a: IndexAvailability | null,
  b: IndexAvailability,
): boolean {
  return (
    a !== null &&
    a.state === b.state &&
    a.collectionRoot === b.collectionRoot &&
    a.elapsed === b.elapsed &&
    a.detail === b.detail &&
    (a.covers ?? []).length === (b.covers ?? []).length &&
    (a.covers ?? []).every((c, i) => c === (b.covers ?? [])[i])
  );
}

/** Ask the committed query of whichever corpus owns it now — the one decision,
 *  shared by submit, the mode flip, the tuning re-run and restore (R6). */
function askCommitted(
  state: SearchState,
  view: View,
  source: Source,
): SearchState {
  switch (corpusOf(view, state.index)) {
    case "defer":
      return defer(endDeferral(state), view, source, true);
    case "wait":
      return defer(endDeferral(state), view, source, false);
    default:
      return ask(endDeferral(state), view, source);
  }
}

/** `'submit'` whole and `'runQuery'`'s tail, so a chip reaches the grid, the
 *  URL and history by the typed submit's own path (`landing-page` D4). The
 *  `base` override is the only difference between the two. */
function commitDraft(
  state: SearchState,
  base: View = liveView(state),
): SearchState {
  const q = state.drafts.queryText.trim();
  // A blank or whitespace-only submit is not a search — nothing to commit.
  if (q === "") return state;
  const view: View = {
    ...base,
    subject: { kind: "query", text: q },
    model: null,
  };
  return askCommitted(state, view, "user");
}

/** Leave the committed subject (D9) — one rule for a phrase and a model, and
 *  one implementation for the dismiss control and the emptied input. */
function leaveSubject(state: SearchState, prefs?: Prefs): SearchState {
  const base = liveView(state);
  if (base.subject.kind === "none") return state;
  return ask(
    endDeferral(state),
    { ...base, ...prefs, subject: { kind: "none" }, model: null },
    "user",
  );
}

export function reducer(state: SearchState, action: Action): SearchState {
  switch (action.type) {
    case "navigate": {
      // A link's options governed the view it named, so leaving it puts the
      // profile's own back in force. All four come from the action.
      const view: View = {
        ...action.prefs,
        path: action.path,
        flat: liveView(state).flat,
        subject: { kind: "none" },
        model: null,
      };
      return ask(
        { ...endDeferral(state), drafts: { ...state.drafts, queryText: "" } },
        view,
        "user",
      );
    }

    case "submit":
      return action.mode === undefined
        ? commitDraft(state)
        : commitDraft(patch(state, { mode: action.mode }));

    case "runQuery": {
      // Draft, then mode as a fetchless patch, then the ordinary commit. The
      // patch reaches the answer on screen too, so the listing the chip was
      // clicked over stops claiming the old mode.
      const held = patch(
        { ...state, drafts: { ...state.drafts, queryText: action.text } },
        { mode: action.mode },
      );
      // At the library's **top**, wherever the visitor was standing: the gate
      // that offers these phrases is asked at `/`, so committing at the current
      // path would send the index a location it may not cover. `flat` off with
      // it, so leaving the results lands back on the banner's own view.
      const top: View = { ...liveView(held), path: "/", flat: false };
      return commitDraft(held, top);
    }

    case "similar": {
      // The anchor is what the dismissal returns to, and what tells two
      // similarity views of one model apart (`requestOf`).
      const view: View = {
        ...liveView(state),
        subject: { kind: "similar", model: action.model, k: SIMILAR_K },
        model: null,
      };
      // The draft goes with it: text left in the box relates to nothing on
      // screen, and erasing it — the natural gesture — destroys the view.
      return askCommitted(
        { ...state, drafts: { ...state.drafts, queryText: "" } },
        view,
        "user",
      );
    }

    case "similarTuning": {
      const base = liveView(state);
      // Asserting these onto a subject that reads none would put a `k` in the
      // URL of a view that cannot use it.
      if (base.subject.kind !== "similar") return state;
      // A different parameter is a different question, so it re-asks through
      // the corpus decision and defers while the index warms.
      const view: View = {
        ...base,
        subject: { ...base.subject, k: action.k, pool: action.pool },
        model: null,
      };
      return askCommitted(state, view, "user");
    }

    case "clearSubject": {
      // Back to browsing means the box stops showing a search that is no
      // longer on screen.
      const left = leaveSubject(state, action.prefs);
      return left === state
        ? state
        : { ...left, drafts: { ...left.drafts, queryText: "" } };
    }

    case "toggleFlat": {
      // Deep results are flat-shaped regardless of the toggle, so pressing it
      // is an ordinary listing request and the subject stops being committed.
      const base = liveView(state);
      const view: View = {
        ...base,
        flat: !base.flat,
        subject: { kind: "none" },
        model: null,
      };
      return ask(endDeferral(state), view, "user");
    }

    case "setMode": {
      const base = liveView(state);
      // The mode is the corpus a typed *phrase* goes to, so anything else is
      // the next search's setting and re-asking would change no question.
      if (base.subject.kind !== "query")
        return patch(state, { mode: action.mode });
      return askCommitted(
        state,
        { ...base, mode: action.mode, model: null },
        "user",
      );
    }

    case "setTuning": {
      const recorded = patch(state, { tuning: action.tuning });
      if (!action.run) return recorded;
      const base = liveView(recorded);
      // A tuning change never defers: it shapes a query the index is already
      // answering, and holding it turns a slider into a search nobody asked for.
      if (
        base.subject.kind !== "query" ||
        corpusOf(base, recorded.index) !== "meaning"
      ) {
        return recorded;
      }
      return ask(recorded, { ...base, model: null }, "user");
    }

    /** The kind option selects among entries already returned — no request. */
    case "setKinds":
      return patch(state, { kinds: action.kinds });

    case "setFolderMatching": {
      const base = liveView(state);
      // It decides what the *name corpus* returns; anywhere else it records as
      // the next search's setting.
      if (base.subject.kind !== "query")
        return patch(state, { folderMatching: action.on });
      return askCommitted(
        state,
        { ...base, folderMatching: action.on, model: null },
        "user",
      );
    }

    case "queryText": {
      const typed: SearchState = {
        ...state,
        drafts: { ...state.drafts, queryText: action.text },
      };
      if (action.text.trim() !== "") return typed;
      // Delegated, not a second copy of the rule (D9).
      return leaveSubject(typed, action.prefs);
    }

    case "deferredToName": {
      // Substituting the corpus is honest only when it was asked for. Only a
      // phrase can be: a deferred similarity view has no text to run.
      const subject = state.view.subject;
      if (state.phase === "idle" || subject.kind !== "query") return state;
      return ask(
        endDeferral(state),
        { ...state.view, subject, mode: "name", model: null },
        "user",
      );
    }

    case "restore": {
      const v = action.view;
      // Same question, so keep the answer and patch the fields `requestOf`
      // does not read — anything that mattered would have failed the compare.
      // `path`/`subject` stay out by `patch`'s rule, which is why a similarity
      // view's anchor is in its request at all.
      if (
        (state.result !== null || state.inflight !== null) &&
        sameQuestion(v, liveView(state))
      ) {
        return {
          ...patch(state, {
            model: v.model,
            kinds: v.kinds,
            flat: v.flat,
            mode: v.mode,
            folderMatching: v.folderMatching,
            tuning: v.tuning,
          }),
          // The failure belonged to some other question, and would otherwise
          // accuse a correct grid. Only this branch clears it — `patch` must
          // not, or a lightbox open wipes the failure it was opened over.
          failure: null,
        };
      }
      // The filter is not part of the view a URL names, so it is the caller's
      // to clear.
      const seeded: SearchState = {
        ...state,
        drafts: {
          ...state.drafts,
          queryText: v.subject.kind === "query" ? v.subject.text : "",
        },
      };
      return askCommitted(seeded, v, "restore");
    }

    case "landing": {
      if (!accepts(state, action.id, action.forView)) return state;
      const f = state.inflight;
      const result: Result = {
        // The patched assert-view, never the action's `forView`: a fetchless
        // change made in flight belongs to the answer it lands with.
        forView: f.view,
        source: f.source,
        id: f.id,
        entries: action.landed.entries,
        truncated: action.landed.truncated === true,
        // The wire omits these rather than sending `false`. The follow-up
        // marker comes off the REQUEST — the server cannot know which of its
        // answers is a second ask — and is what stops a third.
        stale: action.landed.stale === true,
        ...(f.followUp === true ? { followUp: true as const } : {}),
        scope: action.landed.scope,
        weak: action.landed.weak,
        capped: action.landed.capped,
        matched: action.landed.matched,
        poses: action.landed.poses,
        scores: action.landed.scores,
        anchor: action.landed.anchor,
      };
      // A stand-in renders without renaming the view: the URL still names the
      // search and the deferral still waits.
      if (f.standIn === true) {
        return {
          ...state,
          inflight: null,
          failure: null,
          result,
          listingPoses: null,
        };
      }
      // `phase` is deliberately untouched: a landing that tidied it would hide
      // a cancel path that forgot to.
      return {
        ...state,
        view: f.view,
        inflight: null,
        failure: null,
        result,
        listingPoses: null,
      };
    }

    case "failure": {
      if (!accepts(state, action.id, action.forView)) return state;
      // **A follow-up that fails says nothing** (`listing-tree-cache` §5.2):
      // nobody asked for it, and the listing it was going to correct is on
      // screen and complete. 'Refreshing…' stays up, which is truthful. Nothing
      // retries — no answer landed, so the `revalidate` effect does not re-run.
      if (state.inflight.followUp === true) return { ...state, inflight: null };
      // No revert to get wrong: nothing advanced.
      return {
        ...state,
        inflight: null,
        failure: { forView: state.inflight.view, message: action.message },
      };
    }

    case "index": {
      const known = sameAvailability(state.index, action.availability)
        ? state
        : { ...state, index: action.availability };
      if (known.phase === "idle" || known.view.subject.kind === "none")
        return known;
      const source = known.phase.deferred;
      if (action.availability.state === "ready") {
        // The asking event resumed, under the deferral's own provenance, so a
        // restored one still replaces its history entry rather than pushing.
        return ask({ ...known, phase: "idle" }, known.view, source);
      }
      // Cannot answer yet: stand in with the location's own contents, once.
      if (known.inflight !== null || stoodIn(known)) return known;
      return ask(known, standInOf(known.view), source, { standIn: true });
    }

    case "modelOpen":
      return patch(state, { model: action.path });

    case "modelClose":
      return patch(state, { model: null });

    case "modelDrop":
      return patch(state, { model: null });

    case "listingPoses": {
      // `accepts`' rule asked of the answer rather than the request, because
      // by now there is no request left (D3). Stored by reference: the sweep
      // re-runs on its identity, so a copy per action rewalks the grid.
      if (state.result === null || state.result.id !== action.id) return state;
      return { ...state, listingPoses: action.poses };
    }

    case "revalidate": {
      const r = state.result;
      // The last clause is the whole of "one follow-up per landed stale
      // answer": without it, a server that keeps answering marked is asked
      // forever.
      if (
        r === null ||
        r.id !== action.id ||
        r.stale !== true ||
        r.followUp === true
      )
        return state;
      // Never over a request the user is already waiting on: this dispatches
      // after the landing commits, when a click may have asked for elsewhere.
      if (state.inflight !== null) return state;
      // Including its stand-in-ness: re-asking a placeholder without the flag
      // lets the follow-up's landing rename the view and end the deferral.
      return ask(state, r.forView, r.source, {
        followUp: true,
        ...(stoodIn(state) ? { standIn: true as const } : {}),
      });
    }
  }
}
