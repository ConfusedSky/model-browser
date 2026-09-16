/**
 * The resolved form of what `lib/urlState.ts` parses — every option present, no
 * absences to interpret. The URL is its projection (R3), so nothing ephemeral
 * belongs here for the same reason it does not belong in a URL.
 */
import type { SearchKinds, SearchMode, Tuning } from "../lib/searchOptions";
import { serializeView, type UrlView } from "../lib/urlState";

/** Three kinds, one slot (D4): a second field would make "text and model both
 *  set" representable and give every transition another thing to clear — which
 *  is why the similar arm carries its own parameters too. */
export type Subject =
  | { kind: "none" }
  | { kind: "query"; text: string }
  | {
      kind: "similar";
      model: string;
      k: number;
      /** Absent means the index's own default, never sent: a value here is a
       *  choice somebody made on screen. */
      pool?: Tuning["pool"];
    };

export interface View {
  path: string;
  /** The *toggle*, not the shape a request runs in (R4): a search runs
   *  flat-shaped whatever this says, so it survives the search and governs the
   *  listing left behind. */
  flat: boolean;
  subject: Subject;
  mode: SearchMode;
  kinds: SearchKinds;
  folderMatching: boolean;
  tuning: Tuning;
  /** What the URL names, never what is mounted — the viewer's own truth (R7). */
  model: string | null;
}

/** On an action, never read from the `searchOptions` module inside the reducer:
 *  module state is impure under StrictMode (R2). */
export interface Prefs {
  mode: SearchMode;
  kinds: SearchKinds;
  folderMatching: boolean;
  tuning: Tuning;
}

export function toUrlView(view: View): UrlView {
  return {
    // `serializeView` owns which paths are written by omission (D2); eliding
    // here too is the same rule in two places.
    path: view.path,
    flat: view.flat,
    q: view.subject.kind === "query" ? view.subject.text : undefined,
    similar: view.subject.kind === "similar" ? view.subject.model : undefined,
    // Elided here rather than in `serializeView`, which cannot import
    // `SIMILAR_K` back without a cycle. Absence is the default at both ends, so
    // a link naming no count and one naming the default are the same view.
    k:
      view.subject.kind === "similar" && view.subject.k !== SIMILAR_K
        ? view.subject.k
        : undefined,
    pool: view.subject.kind === "similar" ? view.subject.pool : undefined,
    folderMatching: view.folderMatching,
    kinds: view.kinds,
    mode: view.mode,
    tuning: view.tuning,
    model: view.model ?? undefined,
  };
}

/** The ONE View comparison (R1): same view exactly when same URL. Never
 *  reference equality, since every transition mints a fresh object, and never
 *  field-wise, which is a hand-maintained list. */
export function sameView(a: View, b: View): boolean {
  return serializeView(toUrlView(a)) === serializeView(toUrlView(b));
}

/** Which model is open says nothing about which entries a view contains, so an
 *  entry differing only there must not re-ask for a listing (R7). */
export function sameListing(a: View, b: View): boolean {
  return sameView({ ...a, model: null }, { ...b, model: null });
}

/** What an unset `k` resolves to. Above the index's own default, which leaves
 *  most of a row empty, and under the text-query bound, because neighbour
 *  quality falls off faster than text-match quality. */
export const SIMILAR_K = 16;

/**
 * A closed list, which is why `sameQuestion` may enumerate it. The request
 * *shape* is derived, not stored (R4).
 *
 * A similarity request's `path` reaches no server (D4): it is carried so that
 * two such views of one model at different folders do not compare equal, take
 * `restore`'s patch branch and — `patch` refusing `path` — leave the path bar
 * naming the folder the user just left.
 */
export type Request =
  | {
      kind: "listing";
      path: string;
      flat: boolean;
      q: string | null;
      folderMatching: boolean;
    }
  | { kind: "meaning"; path: string; text: string; tuning: Tuning }
  | {
      kind: "similar";
      path: string;
      model: string;
      k: number;
      /** Sent only when the subject names one; absent leaves the index's own. */
      pool?: Tuning["pool"];
    };

export function requestOf(view: View): Request {
  const subject = view.subject;
  if (subject.kind === "similar") {
    return {
      kind: "similar",
      path: view.path,
      model: subject.model,
      k: subject.k,
      pool: subject.pool,
    };
  }
  if (subject.kind === "query" && view.mode === "meaning") {
    return {
      kind: "meaning",
      path: view.path,
      text: subject.text,
      tuning: view.tuning,
    };
  }
  return {
    kind: "listing",
    path: view.path,
    flat: subject.kind === "query" ? true : view.flat,
    q: subject.kind === "query" ? subject.text : null,
    folderMatching: view.folderMatching,
  };
}

/** Equality of `requestOf`, not of `sameView`: a view carries options no
 *  request sees, so two entries can name different URLs and still be one
 *  question — in which case the difference is a patch, not a re-ask. */
export function sameQuestion(a: View, b: View): boolean {
  const x = requestOf(a);
  const y = requestOf(b);
  if (x.kind === "similar") {
    // `path` here and nowhere else — every other kind already compares it
    // below. `k` and `pool` because a different parameter is a different
    // question, and a Back across one must not take `restore`'s patch branch.
    return (
      y.kind === "similar" &&
      x.path === y.path &&
      x.model === y.model &&
      x.k === y.k &&
      x.pool === y.pool
    );
  }
  if (x.kind === "meaning") {
    return (
      y.kind === "meaning" &&
      x.path === y.path &&
      x.text === y.text &&
      x.tuning.raw === y.tuning.raw &&
      x.tuning.pool === y.tuning.pool &&
      x.tuning.minScore === y.tuning.minScore &&
      // Both bounds, unconditionally: the count caps what the floor let through
      // (`floor-and-count-compose`), so it is part of the question whenever it
      // is in force. Exempting it would let a Back across a count change take
      // `restore`'s patch branch and keep the previous count's answer on screen
      // under a URL naming the new one.
      x.tuning.top === y.tuning.top
    );
  }
  return (
    y.kind === "listing" &&
    x.path === y.path &&
    x.flat === y.flat &&
    x.q === y.q &&
    x.folderMatching === y.folderMatching
  );
}

/**
 * One function, shared by submit, the mode flip and restore (R6), so there is
 * nowhere for a second opinion to live. `defer` stands in with the location's
 * contents; `wait` — the probe has not answered at all — fetches nothing, since
 * a meaning link's `flat` would walk the volume for tiles about to be replaced.
 */
export type Corpus =
  | "listing"
  | "name"
  | "meaning"
  | "similar"
  | "defer"
  | "wait";

export function corpusOf(view: View, index: { state: string } | null): Corpus {
  const subject = view.subject;
  if (subject.kind === "none") return "listing";
  if (subject.kind === "similar") {
    if (index === null) return "wait";
    return index.state === "ready" ? "similar" : "defer";
  }
  if (view.mode !== "meaning") return "name";
  if (index === null) return "wait";
  return index.state === "ready" ? "meaning" : "defer";
}

/** Nested, always: the URL's `flat` belongs to the search being deferred, and
 *  flattening a volume to fill time is the opposite of standing in (R6). */
export function standInOf(view: View): View {
  return { ...view, subject: { kind: "none" }, flat: false };
}
