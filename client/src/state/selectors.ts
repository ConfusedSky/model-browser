/** What the render reads (R1): `result.forView` for the grid, the filters and
 *  the notices; `view` for the URL and the deferred banner; `liveView` for the
 *  controls, which is why the path bar shows a directory as it is requested. */
import type { DirEntry, IndexAvailability } from "../../../shared/types";
import type { SearchKinds, SearchMode, Tuning } from "../lib/searchOptions";
import { liveView, type SearchState } from "./reducer";
import { requestOf, type Request, type Subject, type View } from "./view";

export { liveView, stoodIn } from "./reducer";

/** In flight or committed; every header control keys off it. */
export function dest(state: SearchState): string {
  return liveView(state).path;
}

/** A deferral counts only with nothing on screen, a failed stand-in ends the
 *  debt — nothing is left to clear the skeleton — and a stale listing's
 *  follow-up owes nothing, its answer being on screen already. */
export function busy(state: SearchState): boolean {
  return (
    (state.inflight !== null && state.inflight.followUp !== true) ||
    (state.phase !== "idle" && state.result === null && state.failure === null)
  );
}

/** The question in flight if there is one, so a click reads as pressed before
 *  its answer arrives. */
export function controls(state: SearchState): {
  flat: boolean;
  mode: SearchMode;
  kinds: SearchKinds;
  folderMatching: boolean;
  tuning: Tuning;
  /** The subject itself, not a phrase from it: "is anything committed" and
   *  "what text" are different questions, and a similarity view answers the
   *  first without having a string for the second. */
  subject: Subject;
} {
  const v = liveView(state);
  return {
    flat: v.flat,
    mode: v.mode,
    kinds: v.kinds,
    folderMatching: v.folderMatching,
    tuning: v.tuning,
    subject: v.subject,
  };
}

/** Derived rather than stored (R4). */
export function pendingRequest(
  state: SearchState,
): (Request & { id: number; forView: View }) | null {
  const f = state.inflight;
  return f === null
    ? null
    : { ...requestOf(f.view), id: f.id, forView: f.asked };
}

/** What the pose wave is fired for and dropped by (D3). It carries the
 *  **entries**, not a directory path, because a flat listing's models live in
 *  subfolders — by reference, so "once per landing" is a dependency. */
export function landedListing(
  state: SearchState,
): { id: number; entries: DirEntry[] } | null {
  const r = state.result;
  if (r === null) return null;
  return requestOf(r.forView).kind === "listing"
    ? { id: r.id, entries: r.entries }
    : null;
}

/** Name search results only — `serializeView`'s own gate, or the URL and the
 *  grid disagree about whether the option is in force, and a sticky `folders`
 *  empties a meaning grid with no control on screen to undo it. */
export function byKind(state: SearchState): DirEntry[] {
  const r = state.result;
  if (r === null) return [];
  const { subject, kinds, mode } = r.forView;
  if (subject.kind !== "query" || mode !== "name" || kinds === "both")
    return r.entries;
  return r.entries.filter((e) =>
    kinds === "folders" ? e.kind !== "model" : e.kind === "model",
  );
}

/** 'both' wherever the option selects nothing (`byKind`'s gate), since counting
 *  by it there yields a sentence with no parts. */
export function noticeKinds(state: SearchState): SearchKinds {
  const v = state.result?.forView;
  return v !== undefined && v.subject.kind === "query" && v.mode === "name"
    ? v.kinds
    : "both";
}

/**
 * In range and not inside an archive — not "is the index up", which callers
 * gate on separately. Optimism is the design (D4/D6): nothing probes per tile,
 * and a prefix check disagreeing with the server's resolved-path compare costs
 * the affordance rather than producing a wrong answer.
 */
export function indexCovers(
  index: IndexAvailability | null,
  path: string,
): boolean {
  const root = index?.collectionRoot;
  if (root === undefined || path.includes("!/")) return false;
  // A root of `/` would otherwise build `//`, which no path begins with.
  return (
    path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`)
  );
}

/** Ready is necessary and not sufficient, which is why both halves are one
 *  function rather than conditions each caller re-spells (`landing-page` D3). */
export function meaningRunnableAt(
  index: IndexAvailability | null,
  path: string,
): boolean {
  return index !== null && index.state === "ready" && indexCovers(index, path);
}

/** All of it from the answer. The subject rather than a query string: the
 *  "nothing matched" gate reads it to tell an empty answer from an empty
 *  folder, and a similarity result has no phrase to pull out. */
export function labelInputs(state: SearchState): {
  subject: Subject;
  meaning: boolean;
  weak: boolean;
  capped: boolean;
  truncated: boolean;
  matched: number | undefined;
  shown: number;
  capping: boolean;
} {
  const r = state.result;
  return {
    subject: r?.forView.subject ?? { kind: "none" },
    meaning: r?.scope !== undefined && r.scope !== null,
    weak: r?.weak === true,
    capped: r?.capped === true,
    truncated: r?.truncated === true,
    // Absence is a third state — the index did not say — not a zero.
    matched: r?.matched,
    // Not the kind-filtered list: `matched` counts what the *index* had, so
    // the number set against it must be the index's too.
    shown: r?.entries.length ?? 0,
    // Both bounds is the only state where "N of M above the floor" is true:
    // without the count the sentence credits the index's own cap to a bound
    // nobody set, and without the floor `matched` is everything scored.
    capping:
      r?.forView.tuning.top !== undefined &&
      r?.forView.tuning.minScore !== undefined,
  };
}
