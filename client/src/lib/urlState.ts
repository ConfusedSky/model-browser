import type { SearchKinds, SearchMode, Tuning } from "./searchOptions";
import { clampCount, isKinds, isPool, TUNING_DEFAULTS } from "./searchOptions";

/**
 * The URL as a record of the committed view (url-navigation D1). A preference
 * belongs here when it decides *which entries the view contains*, never how
 * they are drawn: without the search options a shared link reproduces different
 * models for the recipient than the sender saw.
 *
 * `URLSearchParams` is the only encoder — it percent-encodes the zip `!/` on its
 * own, and an `encodeURIComponent` pass on top double-encodes.
 */
export interface UrlView {
  /** Never optional (library R2, D2): the root has a spelling of its own, so
   *  "at the top" and "no path given" stop being the same absence. */
  path: string;
  flat: boolean;
  q?: string;
  /** Two optional slots rather than a union, unlike `View`: reporting both is
   *  what lets `resolveView` rule that `similar` beats a stray `q`. */
  similar?: string;
  /** Already elided at its default by `toUrlView`, which owns `SIMILAR_K` —
   *  this module cannot import it back without a cycle. */
  k?: number;
  /** One `pool` param, two readers: `parseUrl` reports it both ways and the
   *  subject decides, so the two can never both be written. */
  pool?: Tuning["pool"];
  folderMatching?: boolean;
  kinds?: SearchKinds;
  mode?: SearchMode;
  tuning?: Partial<Tuning>;
  model?: string;
}

/**
 * Deliberately more permissive than `serializeView`, which would omit some of
 * what this reads: refusing them turns tolerance into a 404 over a link that
 * names a perfectly good view. Precedence is `resolveView`'s, and a stray param
 * rides in the address bar unread.
 */
export function parseUrl(search: string = window.location.search): UrlView {
  const p = new URLSearchParams(search);
  const raw = p.get("q");
  const q = raw === null || raw === "" ? undefined : raw;
  const rawSimilar = p.get("similar");
  const similar =
    rawSimilar === null || rawSimilar === "" ? undefined : rawSimilar;
  const kinds = p.get("kinds");
  const mode = p.get("mode");
  const pool = p.get("pool");
  const top = Number(p.get("top"));
  const min = Number(p.get("min"));
  // Leniently, like every param here: a `k` the index would refuse reads as
  // absence. The bounds are the server's own (`app.ts`).
  const rawK = Number(p.get("k"));
  const k =
    p.has("k") && Number.isInteger(rawK) && rawK >= 1 && rawK <= 1000
      ? rawK
      : undefined;
  const tuning: Partial<Tuning> = {};
  if (p.get("score-raw") === "1") tuning.raw = true;
  if (isPool(pool)) tuning.pool = pool;
  // Presence *is* the assertion (D4), so there is no sentinel to clear, and a
  // record naming neither bound is `resolveTuning`'s to read. Clamped on the way
  // in, so a hand-edited count cannot spend the index's headroom (D5).
  if (Number.isFinite(top) && top > 0 && p.has("top"))
    tuning.top = clampCount(top);
  // Blank is the trap: `Number('')` is 0, and a floor of 0 is the whole
  // collection. An unparseable floor is a floor not named.
  if (Number.isFinite(min) && (p.get("min") ?? "").trim() !== "")
    tuning.minScore = min;
  // Blank is absence: `get` answers `''`, which `??` would let through.
  const rawPath = p.get("path");
  return {
    // Absence is the root (D2), not "no path": the top is the default view.
    path: rawPath === null || rawPath === "" ? "/" : rawPath,
    // The flat *toggle*, and only that (R4): inferring it from `q` would make a
    // deep-linked search whose query is cleared list the whole volume.
    flat: p.has("flat"),
    q,
    similar,
    k,
    // Reported a second way, for the subject that reads it as its own.
    pool: isPool(pool) ? pool : undefined,
    // Absence selects a default, so an unrecognised — or explicitly default —
    // value reads as absence rather than as an error.
    folderMatching: p.has("nofolders") ? false : undefined,
    kinds: isKinds(kinds) && kinds !== "both" ? kinds : undefined,
    mode: mode === "meaning" ? "meaning" : mode === "name" ? "name" : undefined,
    tuning: Object.keys(tuning).length > 0 ? tuning : undefined,
    model: p.get("model") ?? undefined,
  };
}

/**
 * Omit-empty: absent params rather than blank ones; `flat` only when on.
 *
 * The one writer of every history entry (design R3), which is why the gate
 * below lives here rather than at the call sites. The gate is one sentence:
 * **an option is written only when the view's subject actually reads it.**
 * Options describe which entries a view contains, and over a plain listing they
 * select nothing — a `?kinds=folders` on a bare directory names a distinction
 * that view does not make. Under a committed query the subject reads a phrase,
 * so the reading mode decides the rest: a name search has no tuning to spell
 * out, and a meaning search cannot restrict by kind, since the index answers
 * with models and nothing else. Under a `similar` subject none of the *phrase*
 * options are read (D4) — there is no phrase to tune or restrict — so the URL
 * names the model, the location, the flat toggle, and the two parameters that
 * subject does read: how many neighbours it asked for and how the index pooled
 * them. Those are in the URL by the same rule that keeps the others out: they
 * select which entries the view contains, and something on screen sets them.
 *
 * The panel already hides each option outside its mode; the URL says the same
 * thing, so two views that differ only in an option neither of them reads
 * serialize alike and stop minting history entries that go nowhere. That
 * property is what makes naming a similarity view by its model alone honest.
 *
 * Enforced here rather than at the call sites, since one projection of the
 * whole view cannot leak an option onto a listing where a hand-built literal
 * can drop a field.
 */
export function serializeView(view: UrlView): string {
  const p = new URLSearchParams();
  // The root is written by omission (D2).
  if (view.path !== "/") p.set("path", view.path);
  if (view.flat) p.set("flat", "1");
  // Only one subject; `similar` wins, as in `resolveView`, and every option
  // gate below is then false.
  const similar = view.similar !== undefined && view.similar !== "";
  if (similar) p.set("similar", view.similar as string);
  // The two a similarity subject *does* read. `pool` has no default to elide:
  // absent means the index's own.
  if (similar && view.k !== undefined) p.set("k", String(view.k));
  if (similar && view.pool !== undefined) p.set("pool", view.pool);
  const searching = !similar && view.q !== undefined && view.q !== "";
  if (searching) p.set("q", view.q as string);
  // Absence means name, so a mode-less committed view takes the name options.
  const naming = searching && (view.mode ?? "name") === "name";
  const meaning = searching && view.mode === "meaning";
  // Omitted at their defaults (D4), so making one explicit mints no history.
  if (naming && view.folderMatching === false) p.set("nofolders", "1");
  if (naming && (view.kinds === "folders" || view.kinds === "models"))
    p.set("kinds", view.kinds);
  // Written even at its default, unlike the options above: which *corpus*
  // answered is what the query means, and left implicit the same URL asks a
  // different question of a reader whose default differs.
  if (searching) p.set("mode", view.mode ?? "name");
  // Not named `raw`: Vite's dev server 403s any URL carrying a `raw`, `url` or
  // `inline` param, killing deep links before the app loads.
  if (meaning && view.tuning?.raw === true) p.set("score-raw", "1");
  if (
    meaning &&
    view.tuning?.pool !== undefined &&
    view.tuning.pool !== TUNING_DEFAULTS.pool
  ) {
    p.set("pool", view.tuning.pool);
  }
  // A bound in force is named, its default included, since absence says "not in
  // force" — except at rest, where naming neither says both (D4). That is what
  // keeps an ordinary link free of tuning noise and App's re-commits idempotent.
  const bounds = meaning ? view.tuning : undefined;
  const resting =
    bounds?.top === TUNING_DEFAULTS.top &&
    bounds?.minScore === TUNING_DEFAULTS.minScore;
  if (bounds !== undefined && !resting) {
    if (bounds.minScore !== undefined) p.set("min", String(bounds.minScore));
    if (bounds.top !== undefined) p.set("top", String(bounds.top));
  }
  if (view.model !== undefined && view.model !== "") p.set("model", view.model);
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** Compared by what they write: a field-wise compare would have to agree with
 *  `serializeView` about which values are absences, and an unchanged view read
 *  as different stacks a dead history entry per re-submit. */
function sameView(a: UrlView, b: UrlView): boolean {
  return serializeView(a) === serializeView(b);
}

/** 0 for an entry carrying no stamp — the boot entry before its seed. */
export function historyIndex(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : 0;
}

/**
 * Declines when the live URL already names this view, so a re-commit cannot
 * stack history entries. Every entry carries an index in its state, because the
 * browser exposes only the *current* entry's and a session mirror of the stack
 * needs to find the row an entry belongs to (retrace-placement D2).
 */
export function commitUrl(
  view: UrlView,
  opts: { replace?: boolean; state?: unknown } = {},
): { idx: number; wrote: "push" | "replace" | "none" } {
  if (sameView(parseUrl(), view)) return { idx: historyIndex(), wrote: "none" };
  const url = `${window.location.pathname}${serializeView(view)}`;
  const replace = opts.replace === true;
  const idx = replace ? historyIndex() : historyIndex() + 1;
  const marker =
    typeof opts.state === "object" && opts.state !== null ? opts.state : {};
  const state = { ...marker, idx };
  if (replace) window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
  return { idx, wrote: replace ? "replace" : "push" };
}

/** Read back when the lightbox closes: an entry we pushed has a predecessor,
 *  where a deep-linked one would leave the app on `back()`. In history state,
 *  not memory, so it survives reload and forward/back. */
export const LIGHTBOX_ENTRY = { lightbox: true };

export function isLightboxEntry(): boolean {
  return (
    (window.history.state as { lightbox?: boolean } | null)?.lightbox === true
  );
}

/**
 * `LIGHTBOX_ENTRY`'s channel and reasoning, for an **in-app** find-similar: back
 * restores the view it was raised from whole. A deep-linked landing must never
 * gain it, and cannot — only a `user` landing stamps.
 *
 * The **depth** is how many entries into one excursion this is. Every in-app
 * similar landing pushes its own entry, re-tunes included, so a single hop back
 * would land on a tuning step nobody asked to return to; dismissing goes back
 * the whole run instead. A landing from a non-similarity entry stamps 1.
 */
export const SIMILAR_ENTRY = (
  depth: number,
): { similar: true; depth: number } => ({
  similar: true,
  depth,
});

export function isSimilarEntry(): boolean {
  return (
    (window.history.state as { similar?: boolean } | null)?.similar === true
  );
}

/** 0 where the entry carries no marker — a listing, a query view, or a
 *  cold-loaded similarity link. */
export function similarDepth(): number {
  const depth = (window.history.state as { depth?: number } | null)?.depth;
  return typeof depth === "number" && depth > 0 ? depth : 0;
}
