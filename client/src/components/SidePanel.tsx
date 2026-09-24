import { useEffect, useRef, useState } from "react";
import {
  MAX_RESULT_COUNT,
  type FeatureReport,
  type IndexAvailability,
  type SemanticScope,
} from "../../../shared/types";
import type { JobOperation } from "../jobs/bulkJobs";
import type { SearchKinds, SearchMode, Tuning } from "../lib/searchOptions";
import { clampCount, POOLS, TUNING_DEFAULTS } from "../lib/searchOptions";
import { stored } from "../lib/stored";
import { meaningRunnableAt } from "../state/selectors";
import Icon from "./Icon";

/** Renaming these drops every profile's state. */
const COLLAPSE_KEY = "model-browser:chat-collapsed";
const TAB_KEY = "model-browser:panel-tab";

type Tab = "chat" | "search" | "similar" | "library";

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wider text-ink-3";
const NUMBER_CLASS =
  "w-16 rounded-md border border-line bg-surface px-2 py-1 text-ink tabular-nums outline-none focus:border-line-strong disabled:opacity-40";

/**
 * What to say about an index that cannot serve *this path* — not the same
 * question as what state it is in: a `ready` index reaching here is running and
 * merely out of range. A `switch` over the whole union, so a sixth state fails
 * to compile rather than inheriting the sentence written for `absent`.
 */
function indexStateSentence(index: IndexAvailability, path: string): string {
  switch (index.state) {
    case "warming":
      return `Meaning search is starting up${index.elapsed !== undefined ? ` (${Math.round(index.elapsed)}s)` : ""}…`;
    case "volume-gone":
      return "Meaning search is running, but its library volume is not mounted.";
    case "wedged":
      return "Meaning search did not finish starting.";
    case "ready":
      // The two ways of being out of range are different facts: an archive
      // interior is never indexed wherever it sits, another folder is merely
      // outside the one collection the index can name.
      return path.includes("!/")
        ? "Meaning search is running, but does not cover the inside of archives."
        : `Meaning search is running, but does not cover this folder.${
            index.collectionRoot === undefined
              ? ""
              : ` It covers ${index.collectionRoot}.`
          }`;
    case "absent":
      return "Meaning search is not running — start the index to use it.";
  }
}

/** All a viewer who cannot reach the machine is told: naming which of the three
 *  repairs applies would describe the operator's machine to a stranger
 *  (`public-deployment` D9). */
export const INDEX_UNAVAILABLE = "The index is not available.";

function operatorRepairable(state: IndexAvailability["state"]): boolean {
  return state === "absent" || state === "volume-gone" || state === "wedged";
}

/**
 * The sentence and the index's own words together, because under a collapse
 * they are one decision: `detail` is free text able to name a cache directory,
 * and printing it beside a collapsed sentence restores what the collapse
 * removed. The server withholds it too — this is the second lock, not the only
 * one (D9).
 *
 * `hostDetails` is `true` while the report is unknown: a behaviour with an
 * existing default keeps it until a known report says otherwise.
 */
function indexAccount(
  index: IndexAvailability,
  path: string,
  hostDetails: boolean,
): string {
  if (!hostDetails && operatorRepairable(index.state)) return INDEX_UNAVAILABLE;
  return `${indexStateSentence(index, path)}${index.detail === undefined ? "" : ` ${index.detail}`}`;
}

/**
 * The tabs that may be *recorded* — a tab that can be absent is not one, since
 * a profile restored onto it would open on nothing. `tabStore.write('similar')`
 * failing to compile is what makes that a rule rather than a habit, and the
 * parser below must never learn either value: a type forbidding the write says
 * nothing about what a read can produce.
 */
type StoredTab = Exclude<Tab, "similar" | "library">;

/** The search tuning's own debounce to the millisecond: two number fields in
 *  one panel settling at different speeds read as one of them being broken. */
const SIMILAR_DEBOUNCE_MS = 300;

/** What the index accepts (`app.ts`'s `k` validator). */
const K_MIN = 1;
const K_MAX = 1000;

/** Collapsed until a profile opens it: the grid is what a visitor came for.
 *  App reads and writes it, since the control that opens the panel is App's. */
export const collapseStore = stored(
  COLLAPSE_KEY,
  (raw) => raw !== "0",
  (v) => (v ? "1" : "0"),
);
/** Anything that is not `search` reads as `chat`, even though `chat` is
 *  withholdable: this reads back the profile's *preference*, and teaching it
 *  the deployment would rewrite the recorded value on read (D7). */
const tabStore = stored<StoredTab>(
  TAB_KEY,
  (raw) => (raw === "search" ? "search" : "chat"),
  (v) => v,
);

/**
 * The wanted tab if this deployment has it, else the leftmost it does
 * (`public-deployment` D7). **Nothing here writes the store**: a profile
 * carried between deployments must not come home edited by having visited one.
 * `search` is never withheld, so the `?? 'search'` is an indexing rule rather
 * than a case that happens.
 */
export function resolveTab(preferred: Tab, available: readonly Tab[]): Tab {
  return available.includes(preferred) ? preferred : (available[0] ?? "search");
}

/**
 * The right-edge tab host. It **mirrors** the committed search and does not own
 * it: the input stays in the bar and the label over the grid, because this
 * panel is collapsible and a user who left it closed must never have to open a
 * drawer to search (search-options D5).
 *
 * Collapse and tab persist per profile, and neither belongs in the URL —
 * neither changes which entries a view contains.
 */
export default function SidePanel({
  query,
  similar,
  library,
  path,
  folderMatching,
  kinds,
  mode,
  tuning,
  index,
  scope,
  features,
  onFolderMatching,
  onKinds,
  onTuning,
  onSimilarTuning,
  open,
  onClose,
}: {
  query: string | null;
  /** The Similar tab is offered from it by the panel's rule throughout: what
   *  cannot apply is absent, not inert. */
  similar: { model: string; k: number; pool?: Tuning["pool"] } | null;
  /** The whole-library bulk-job launcher, `null` where there is none to offer
   *  (`bulk-thumbnail-jobs` D6). The panel neither derives nor launches, and
   *  reset's confirmation is the chip's, not this panel's (D5). */
  library: {
    count: () => Promise<{
      generate: number;
      reset: number;
      incomplete: boolean;
    }>;
    launch: (op: JobOperation) => void;
    /** App moves it when a job that wrote something ends. */
    recountKey: unknown;
    /** The user's own framing changes, so an orbit moves the reset count at
     *  once without re-deriving the library. */
    resetAdjust: number;
  } | null;
  /** Meaning search covers only part of the filesystem. */
  path: string;
  folderMatching: boolean;
  kinds: SearchKinds;
  mode: SearchMode;
  tuning: Tuning;
  index: IndexAvailability;
  /** The index's account of what it holds here; null outside a meaning search. */
  scope: SemanticScope | null;
  /**
   * `null` while the read is in flight or after it failed, and the two are not
   * told apart. The two readers here split on feature-report's unknown-report
   * rule: the chat tab is an **offer**, so it stays withheld while unknown; the
   * index sentence is a **behaviour with a default**, so it keeps saying what
   * it said until a known report says otherwise (D7, D9).
   */
  features: FeatureReport | null;
  onFolderMatching: (on: boolean) => void;
  onKinds: (kinds: SearchKinds) => void;
  /** `defer` asks the caller to wait out a typing run before re-querying. */
  onTuning: (tuning: Tuning, opts?: { defer?: boolean }) => void;
  /** The whole set, never a delta; called only with a finished count, since the
   *  debounce is this component's. */
  onSimilarTuning: (k: number, pool?: Tuning["pool"]) => void;
  /** Mounted while closed, so the tab and the Similar/Library lifecycles
   *  below carry on across a close. */
  open: boolean;
  onClose: () => void;
}) {
  // Derived before the state below, because the opening tab resolves against
  // this list on the first render. Library goes last: it is maintenance, not
  // one of the tabs describing the view on screen.
  const hasChat = features?.chatTab === true;
  const hasSimilar = similar !== null;
  const hasLibrary = library !== null;
  const tabs: Tab[] = [
    ...(hasChat ? (["chat"] as const) : []),
    "search",
    ...(hasSimilar ? (["similar"] as const) : []),
    ...(hasLibrary ? (["library"] as const) : []),
  ];
  /** The report is unknown on the first render, so a profile recording `chat`
   *  always opens on search and moves once the report says the tab is
   *  offered — the effect below. */
  const [tab, setTab] = useState<Tab>(() => resolveTab(tabStore.read(), tabs));
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  /** A field mid-edit is not a value: `Number('')` is 0, and committing that
   *  asks the index for the whole collection at score ≥ 0. */
  const [topText, setTopText] = useState<string | null>(null);
  const [scoreText, setScoreText] = useState<string | null>(null);
  // What each bound goes back to when switched on again: a bound sent away is
  // absent from the tuning, so the value it held has nowhere else to live.
  const [heldTop, setHeldTop] = useState<number>(TUNING_DEFAULTS.top ?? 60);
  const [heldScore, setHeldScore] = useState<number>(
    TUNING_DEFAULTS.minScore ?? 0.1,
  );
  useEffect(() => {
    if (tuning.top !== undefined) setHeldTop(tuning.top);
    if (tuning.minScore !== undefined) setHeldScore(tuning.minScore);
  }, [tuning.top, tuning.minScore]);
  const [countText, setCountText] = useState<string | null>(null);
  /** The one debounce that lives in a control rather than in App: a similarity
   *  parameter has no record-only reducer phase to pair with, so there is
   *  nothing for the reducer to hold. */
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(countTimerRef.current), []);

  function selectTab(next: Tab): void {
    setTab(next);
    // Neither is a preference about how this profile opens (`StoredTab`).
    if (next !== "similar" && next !== "library") tabStore.write(next);
  }

  /**
   * The Similar tab follows the view it is about. It arrives **only from
   * search**: a half-typed chat message losing its tab because a menu item was
   * clicked elsewhere is the panel deciding something nobody asked it. Leaving,
   * it falls back to search, where a dismissal lands the user anyway.
   */
  useEffect(() => {
    if (hasSimilar) setTab((t) => (t === "search" ? "similar" : t));
    else setTab((t) => (t === "similar" ? resolveTab("search", tabs) : t));
    // `tabs` is read but not depended on: this runs when the Similar tab
    // arrives or leaves, and the list it reads is the one this render built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSimilar]);

  /**
   * The same rule for Library, **leaving only**: a report resolving is not a
   * thing the user did, so nothing arrives here. It *prefers* chat — this tab
   * is nobody's search — but chat is itself withholdable, which is the second
   * place `resolveTab` exists for.
   */
  useEffect(() => {
    if (!hasLibrary)
      setTab((t) => (t === "library" ? resolveTab("chat", tabs) : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLibrary]);

  /** The report landing re-asks what the *profile* wanted, rather than moving
   *  the tab in hand — which is why it keys on the report alone and exempts the
   *  two tabs that are about the view rather than the profile. */
  useEffect(() => {
    setTab((t) =>
      t === "similar" || t === "library"
        ? t
        : resolveTab(tabStore.read(), tabs),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChat]);

  /** `null` is *counting*, and the panel never blocks on it (D5). Latest-wins
   *  by token: two derivations can be in flight across a recount, and the
   *  slower one landing second puts a stale number under the button. */
  const [counts, setCounts] = useState<
    { generate: number; reset: number; incomplete: boolean } | null | "failed"
  >(null);
  const countTokenRef = useRef(0);
  const showLibrary = tab === "library" && library !== null;
  const countFn = library?.count;
  const recountKey = library?.recountKey;
  const resetAdjust = library?.resetAdjust ?? 0;
  // The sum as it stood when the count was *asked for*, not when it landed: a
  // change made while the answer was in flight is not in the server's number.
  const adjustBaseRef = useRef(0);
  useEffect(() => {
    if (!showLibrary || countFn === undefined) return;
    const token = ++countTokenRef.current;
    const base = resetAdjust;
    setCounts(null);
    void countFn().then(
      (c) => {
        if (countTokenRef.current !== token) return;
        adjustBaseRef.current = base;
        setCounts(c);
      },
      () => {
        // Rather than counting forever; reselecting the tab asks again.
        if (countTokenRef.current !== token) return;
        setCounts("failed");
      },
    );
    // Not a dependency: a hand change must move the number, never re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLibrary, countFn, recountKey]);

  // Answers "why are my results strange?" without opening the panel (D5).
  const nonDefault = !folderMatching || kinds !== "both";

  // Ready is necessary and not sufficient: the index covers one collection and
  // no archive interiors. The shared rule, not a copy — two affordances over
  // one index must not disagree about what it covers.
  const meaningRunnable = meaningRunnableAt(index, path);
  // A submit under an unservable meaning mode defers rather than falling back
  // to names, so showing these there states a contradiction.
  const nameOptionsApply = mode === "name";
  // An absent index is not worth reporting to someone searching by name; it is
  // to someone whose mode says meaning.
  const showIndexState =
    !meaningRunnable && (mode === "meaning" || index.state !== "absent");

  /**
   * Generate carries a second condition over the tab's own `maintenance` gate:
   * with `thumbWrites` refused, it is a loop that renders and discards, so the
   * button is absent rather than inert (`public-deployment` D4).
   *
   * **The same condition `entryActions`' `generateBeneath.applies` carries** —
   * one offer on two surfaces, asserted together in `bulkJobSurfaces.test.tsx`.
   */
  const libraryOps: readonly JobOperation[] =
    features?.thumbWrites === true ? ["generate", "reset"] : ["reset"];

  const segmentClass = (on: boolean): string =>
    on
      ? "flex-1 rounded-md bg-raised px-2 py-1 font-medium capitalize text-ink ring-1 ring-line-strong"
      : "flex-1 rounded-md px-2 py-1 capitalize text-ink-3 hover:text-ink-2";
  const boundClass = (on: boolean): string =>
    on
      ? "rounded-md bg-accent-soft px-2 py-1 font-medium text-accent disabled:cursor-default"
      : "rounded-md px-2 py-1 text-ink-3 ring-1 ring-line hover:text-ink-2";

  if (!open) return null;
  return (
    <>
      {/* On a phone the panel is a sheet over the grid, and a tap outside
          it puts it away. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-lightbox bg-black/50 sm:hidden"
      />
      <aside
        aria-label="Side panel"
        className="fixed inset-x-0 bottom-0 z-lightbox flex max-h-[78dvh] flex-col rounded-t-2xl border-t border-line-strong bg-canvas shadow-2xl sm:static sm:z-auto sm:h-full sm:max-h-none sm:w-80 sm:shrink-0 sm:rounded-none sm:border-t-0 sm:border-l sm:border-line sm:shadow-none"
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-2">
          <div
            role="tablist"
            className="flex min-w-0 flex-1 items-center gap-0.5 text-[13px]"
          >
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => selectTab(t)}
                className={
                  tab === t
                    ? "relative rounded-md bg-surface px-2.5 py-1 font-medium capitalize text-ink"
                    : "relative rounded-md px-2.5 py-1 capitalize text-ink-3 hover:text-ink-2"
                }
              >
                {t}
                {t === "search" && nonDefault && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-0.5 size-1.5 rounded-full bg-accent"
                  />
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse side panel"
            title="Hide the side panel"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface hover:text-ink"
          >
            <Icon name="chevronRight" />
          </button>
        </div>
        {tab === "search" ? (
          <div className="flex-1 space-y-5 overflow-auto p-4 text-xs">
            <section className="space-y-1.5">
              <h2 className={SECTION_LABEL}>Current search</h2>
              {query === null ? (
                <p className="text-ink-3">
                  None yet. These options apply to the next one.
                </p>
              ) : (
                <p className="break-all text-[13px] text-ink">
                  Results for &ldquo;{query}&rdquo;
                </p>
              )}
              {/* Sentence and detail from one call, because a deployment that
                    collapses the states withholds both together. */}
              {showIndexState && (
                <p className="text-ink-3">
                  {indexAccount(index, path, features?.hostDetails !== false)}
                </p>
              )}
              {scope !== null && (
                <p className="text-ink-3">
                  {scope.status === "unindexed"
                    ? "Nothing here has been indexed yet."
                    : scope.status === "partial"
                      ? `${scope.indexed} of ${scope.scanned} models here are indexed.`
                      : `${scope.indexed} models indexed.`}{" "}
                  Covers {scope.covers.join(", ")}.
                </p>
              )}
            </section>
            {mode === "meaning" && meaningRunnable && (
              <section className="space-y-3 border-t border-line pt-4">
                <h2 className={SECTION_LABEL}>Meaning tuning</h2>
                <button
                  type="button"
                  role="switch"
                  aria-checked={tuning.raw}
                  aria-label="Read the phrase as written"
                  onClick={() => onTuning({ ...tuning, raw: !tuning.raw })}
                  className="flex w-full items-center justify-between gap-3 text-left text-ink-2 hover:text-ink"
                >
                  <span>
                    Phrase as written
                    <span className="block text-ink-3">
                      {tuning.raw
                        ? "Sent to the index verbatim"
                        : "Wrapped in a template first"}
                    </span>
                  </span>
                  <Switch on={tuning.raw} />
                </button>
                <div className="space-y-1.5">
                  <p className="text-ink-3">Pool views by</p>
                  <div
                    className="flex rounded-lg bg-sunken p-0.5"
                    role="group"
                    aria-label="Pool views by"
                  >
                    {(["mean", "max", "softmax"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={tuning.pool === p}
                        onClick={() => onTuning({ ...tuning, pool: p })}
                        className={segmentClass(tuning.pool === p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {/* The bounds compose, so each button toggles its own: count
                      only, floor only, or both (D6). At least one must stay in
                      force — unbounded is the whole collection — so a sole
                      survivor's button is inert and says so in its title.

                      Inert must not read as unselected: dimming washes out the
                      bound actually in force, and this is the panel's only row
                      of independent toggles, where which one is lit is the
                      whole message. Hence the filled on-state. */}
                <div className="space-y-1.5">
                  <p className="text-ink-3">Limit results to</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={tuning.top !== undefined}
                      disabled={
                        tuning.top !== undefined &&
                        tuning.minScore === undefined
                      }
                      onClick={() => {
                        setTopText(null);
                        onTuning({
                          ...tuning,
                          top: tuning.top === undefined ? heldTop : undefined,
                        });
                      }}
                      title={
                        tuning.top !== undefined &&
                        tuning.minScore === undefined
                          ? "The only bound in force — a search has to stop somewhere"
                          : undefined
                      }
                      className={boundClass(tuning.top !== undefined)}
                    >
                      top
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={MAX_RESULT_COUNT}
                      aria-label="Number of results"
                      value={topText ?? String(tuning.top ?? heldTop)}
                      disabled={tuning.top === undefined}
                      onChange={(e) => {
                        const text = e.target.value;
                        setTopText(text);
                        const n = Number(text);
                        // A cleared field on its way to "20" is not a request
                        // for one result.
                        if (text.trim() === "" || !Number.isFinite(n) || n < 1)
                          return;
                        // Clamped on the way out: a count above the index's
                        // ceiling names a set it will not return (D5).
                        onTuning(
                          { ...tuning, top: clampCount(n) },
                          { defer: true },
                        );
                      }}
                      onBlur={() => setTopText(null)}
                      className={NUMBER_CLASS}
                    />
                    <button
                      type="button"
                      aria-pressed={tuning.minScore !== undefined}
                      disabled={
                        tuning.minScore !== undefined &&
                        tuning.top === undefined
                      }
                      onClick={() => {
                        setScoreText(null);
                        onTuning({
                          ...tuning,
                          minScore:
                            tuning.minScore === undefined
                              ? heldScore
                              : undefined,
                        });
                      }}
                      title={
                        tuning.minScore !== undefined &&
                        tuning.top === undefined
                          ? "The only bound in force — a search has to stop somewhere"
                          : undefined
                      }
                      className={boundClass(tuning.minScore !== undefined)}
                    >
                      score ≥
                    </button>
                    <input
                      type="number"
                      step={0.01}
                      aria-label="Minimum score"
                      value={scoreText ?? String(tuning.minScore ?? heldScore)}
                      disabled={tuning.minScore === undefined}
                      onChange={(e) => {
                        const text = e.target.value;
                        setScoreText(text);
                        const n = Number(text);
                        // A floor of 0 is the whole collection — the one thing
                        // clearing the field must never mean.
                        if (text.trim() === "" || !Number.isFinite(n)) return;
                        onTuning({ ...tuning, minScore: n }, { defer: true });
                      }}
                      onBlur={() => setScoreText(null)}
                      className={NUMBER_CLASS}
                    />
                  </div>
                </div>
                {(tuning.raw !== TUNING_DEFAULTS.raw ||
                  tuning.pool !== TUNING_DEFAULTS.pool ||
                  tuning.top !== TUNING_DEFAULTS.top ||
                  tuning.minScore !== TUNING_DEFAULTS.minScore) && (
                  <button
                    type="button"
                    onClick={() => {
                      setTopText(null);
                      setScoreText(null);
                      onTuning({ ...TUNING_DEFAULTS });
                    }}
                    className="text-ink-3 underline underline-offset-2 hover:text-ink"
                  >
                    Reset tuning
                  </button>
                )}
              </section>
            )}
            {/* Absent, not inert, for the mode that cannot use them (D2). */}
            {nameOptionsApply && (
              <section className="space-y-3 border-t border-line pt-4">
                <h2 className={SECTION_LABEL}>Name search</h2>
                <button
                  type="button"
                  role="switch"
                  aria-checked={folderMatching}
                  aria-label="Match folder names"
                  onClick={() => onFolderMatching(!folderMatching)}
                  className="flex w-full items-center justify-between gap-3 text-left text-ink-2 hover:text-ink"
                >
                  <span>
                    Match folder names
                    <span className="block text-ink-3">
                      {folderMatching
                        ? "A folder's name counts for what is inside it"
                        : "Only file names are matched"}
                    </span>
                  </span>
                  <Switch on={folderMatching} />
                </button>
                <div className="space-y-1.5">
                  <p className="text-ink-3">Show</p>
                  <div
                    className="flex rounded-lg bg-sunken p-0.5"
                    role="group"
                    aria-label="Show"
                  >
                    {(["both", "folders", "models"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={kinds === k}
                        onClick={() => onKinds(k)}
                        className={segmentClass(kinds === k)}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        ) : /* Not only narrowing: a dismissal renders once before the effect
                 above moves off this tab. */
        tab === "similar" && similar !== null ? (
          <div className="flex-1 space-y-4 overflow-auto p-4 text-xs">
            {/* Nothing here is sticky: the search options describe how *you*
                  search, these describe one neighbourhood. The URL carries
                  them, so the next find-similar starts from the defaults. */}
            <section className="space-y-1.5">
              <h2 className={SECTION_LABEL}>Similar to</h2>
              <p className="break-all text-[13px] text-ink">
                &ldquo;
                {similar.model.slice(similar.model.lastIndexOf("/") + 1)}
                &rdquo;
              </p>
            </section>
            <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
              <label className="text-ink-2" htmlFor="similar-count">
                How many
              </label>
              <input
                id="similar-count"
                type="number"
                min={K_MIN}
                max={K_MAX}
                aria-label="Number of neighbours"
                value={countText ?? String(similar.k)}
                onChange={(e) => {
                  const text = e.target.value;
                  setCountText(text);
                  const n = Number(text);
                  // Held, not clamped: a field on its way to "40" is not a
                  // request for one neighbour.
                  if (text.trim() === "" || !Number.isFinite(n)) return;
                  const k = Math.round(n);
                  if (k < K_MIN || k > K_MAX) return;
                  clearTimeout(countTimerRef.current);
                  countTimerRef.current = setTimeout(
                    () => onSimilarTuning(k, similar.pool),
                    SIMILAR_DEBOUNCE_MS,
                  );
                }}
                onBlur={() => setCountText(null)}
                className={NUMBER_CLASS}
              />
            </div>
            {/* A click runs at once — debouncing is for values that arrive a
                  character at a time. Named apart from the meaning tuning's
                  identical trio, which is reachable under a similarity view at
                  the same time: two controls sharing a name are one control to
                  anything reading names. */}
            <div className="space-y-1.5">
              <p className="text-ink-3">Pool views by</p>
              <div
                className="flex rounded-lg bg-sunken p-0.5"
                role="group"
                aria-label="Pool neighbour views by"
              >
                {POOLS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={similar.pool === p}
                    onClick={() => {
                      // This question carries the count in force, superseding
                      // whatever the field was holding.
                      clearTimeout(countTimerRef.current);
                      setCountText(null);
                      onSimilarTuning(similar.k, p);
                    }}
                    className={segmentClass(similar.pool === p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {/* None pressed is a state: absence is the index's own pooling,
                    and naming it would guess at another process's config. */}
              {similar.pool === undefined && (
                <p className="text-ink-3">
                  Pooled however the index is configured to.
                </p>
              )}
            </div>
          </div>
        ) : /* The Similar branch's guard, for its reason. */
        tab === "library" && library !== null ? (
          <div className="flex-1 space-y-3 overflow-auto p-4 text-xs">
            <h2 className={SECTION_LABEL}>Thumbnails</h2>
            <p className="text-ink-3">
              Bulk thumbnail work over the whole library. Jobs run behind
              whatever you are looking at; cancel and relaunch to pause.
            </p>
            {/* Counted labels, which the menu's entries deliberately are not
                  (D5): this surface already renders asynchronously. */}
            {libraryOps.map((op) => {
              const n =
                counts === null || counts === "failed"
                  ? null
                  : op === "generate"
                    ? counts.generate
                    : Math.max(
                        0,
                        counts.reset + (resetAdjust - adjustBaseRef.current),
                      );
              return (
                <button
                  key={op}
                  type="button"
                  disabled={n === null || n === 0}
                  onClick={() => library.launch(op)}
                  className="w-full rounded-lg border border-line-strong px-3 py-2 text-left text-[13px] text-ink hover:bg-surface disabled:border-line disabled:text-ink-3 disabled:hover:bg-transparent"
                >
                  {counts === "failed"
                    ? "Count failed"
                    : n === null
                      ? "Counting…"
                      : op === "generate"
                        ? `Generate ${n} missing thumbnails`
                        : `Reset ${n} framings`}
                </button>
              );
            })}
            {/* An enumeration cut short found *some* of the scope, so the
                  numbers are true as far as they go and false as a total (D8). */}
            {counts === "failed" && (
              <p className="text-ink-3">
                The library could not be counted — reopen the tab to try again.
              </p>
            )}
            {counts !== null && counts !== "failed" && counts.incomplete && (
              <p className="text-ink-3">
                The scope was cut short — counts are a floor.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-2 overflow-auto px-3 pb-2">
              {messages.length === 0 ? (
                <p className="mt-6 text-center text-xs text-ink-3">
                  Chat about your models — coming soon.
                </p>
              ) : (
                messages.map((m, i) => (
                  <p
                    key={i}
                    className="rounded-lg bg-surface px-3 py-2 text-sm text-ink"
                  >
                    {m}
                  </p>
                ))
              )}
            </div>
            <form
              className="border-t border-line p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() === "") return;
                setMessages((prev) => [...prev, draft.trim()]);
                setDraft("");
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message…"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
              />
            </form>
          </>
        )}
      </aside>
    </>
  );
}

/** A switch's knob, drawn inside the button that carries `role="switch"`. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        on
          ? "flex h-4.5 w-8 shrink-0 items-center justify-end rounded-full bg-accent p-0.5"
          : "flex h-4.5 w-8 shrink-0 items-center justify-start rounded-full bg-white/15 p-0.5"
      }
    >
      <span
        className={
          on
            ? "size-3.5 rounded-full bg-accent-ink"
            : "size-3.5 rounded-full bg-ink-2"
        }
      />
    </span>
  );
}
