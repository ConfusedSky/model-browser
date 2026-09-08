import { useEffect, useRef, useState } from 'react'
import {
  MAX_RESULT_COUNT,
  type FeatureReport,
  type IndexAvailability,
  type SemanticScope,
} from '../../../shared/types'
import type { JobOperation } from '../jobs/bulkJobs'
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { clampCount, POOLS, TUNING_DEFAULTS } from '../lib/searchOptions'
import { stored } from '../lib/stored'
import { indexCovers } from '../state/selectors'

/** Predates the tab host, and kept: renaming it would drop every profile's state. */
const COLLAPSE_KEY = 'model-browser:chat-collapsed'
const TAB_KEY = 'model-browser:panel-tab'

type Tab = 'chat' | 'search' | 'similar' | 'library'

/**
 * What to say about an index that cannot serve *this path*, which is not the
 * same question as what state the index is in.
 *
 * Four of the five states describe the index's own condition. `ready` does not:
 * a ready index that cannot answer here is **running**, and only out of range.
 * That case used to fall through to the `absent` sentence, so a healthy index
 * covering another collection reported itself as not running and told the user
 * to start it — advice that would do nothing (observed 2026-08-26 against a
 * live `ready` index, one directory above its `collectionRoot`).
 *
 * A `switch` over the whole union rather than a ternary chain with a fallback,
 * deliberately: the bug was a default arm quietly serving two opposite
 * conditions, so a sixth state must fail to compile rather than inherit a
 * sentence written for `absent`.
 */
function indexStateSentence(index: IndexAvailability, path: string): string {
  switch (index.state) {
    case 'warming':
      return `Meaning search is starting up${index.elapsed !== undefined ? ` (${Math.round(index.elapsed)}s)` : ''}…`
    case 'volume-gone':
      return 'Meaning search is running, but its library volume is not mounted.'
    case 'wedged':
      return 'Meaning search did not finish starting.'
    case 'ready':
      // In range and ready is `meaningRunnable`, which withholds this line
      // entirely — so reaching here means out of range, and the two ways of
      // being out of range are different facts, not one. An archive interior
      // is never indexed wherever it sits (`indexCovers` refuses `!/` outright);
      // another folder is merely outside the one collection, which the index
      // can name.
      return path.includes('!/')
        ? 'Meaning search is running, but does not cover the inside of archives.'
        : `Meaning search is running, but does not cover this folder.${
            index.collectionRoot === undefined ? '' : ` It covers ${index.collectionRoot}.`
          }`
    case 'absent':
      return 'Meaning search is not running — start the index to use it.'
  }
}

/**
 * The one thing a viewer who cannot reach the machine is told about the three
 * conditions above whose only difference is which repair they name — start the
 * service, mount the volume, restart the wedged process (`public-deployment`
 * D9, `semantic-search`'s *A viewer is not sent to fix a machine they cannot
 * reach*).
 *
 * It says the outcome and no more. Naming which of the three it is would both
 * offer a remedy that is not the viewer's and describe the operator's machine
 * to a stranger, and those are one leak, not two.
 */
export const INDEX_UNAVAILABLE = 'The index is not available.'

/** The three states whose difference is only which operator repairs them. */
function operatorRepairable(state: IndexAvailability['state']): boolean {
  return state === 'absent' || state === 'volume-gone' || state === 'wedged'
}

/**
 * The whole paragraph the panel prints about the index — the sentence and the
 * index's own words after it, together, because under a collapse they are one
 * decision and not two.
 *
 * `hostDetails` is the deployment's answer to *is the machine this server runs
 * on the viewer's concern*; `true` where the report is unknown or says yes, so
 * an in-flight report reads exactly as this panel always has (a behaviour with
 * an existing default keeps it until a known report says otherwise).
 *
 * `warming` does not collapse: a deployment's own start is a real wait and
 * "come back in a moment" is honest. Nor does a `ready` index out of range:
 * that is a fact about where the viewer is browsing, which they can act on by
 * browsing elsewhere.
 *
 * `detail` goes with the collapsed sentence rather than surviving it. It is
 * mini-classify's free text, able to name its cache directory, and printing it
 * beside a collapsed sentence would restore in a detail line exactly what the
 * collapse removed. The server withholds it under this same field, so this is
 * the second of two locks and not the only one — a client-side collapse alone
 * leaves `curl` returning what the sentence was rewritten to hide (D9).
 */
function indexAccount(index: IndexAvailability, path: string, hostDetails: boolean): string {
  if (!hostDetails && operatorRepairable(index.state)) return INDEX_UNAVAILABLE
  return `${indexStateSentence(index, path)}${index.detail === undefined ? '' : ` ${index.detail}`}`
}

/**
 * The tabs that may be *recorded*. Similar is not one of them: it exists only
 * while a similarity view does, so a profile restored onto it with no such view
 * would open on a tab that is not there. Excluding it from the store's type is
 * what makes that a rule rather than a habit — `tabStore.write('similar')` does
 * not compile.
 *
 * **Library is excluded for exactly that condition, arrived at from the other
 * direction** (`bulk-thumbnail-jobs` review M8, which overturned this tab's
 * first design): a tab the feature report can empty is a tab that can be
 * absent, and *can be absent* is the whole condition this type exists to
 * exclude. Its every occupant acts on the server's own derived state, so a
 * deployment that does not offer maintenance has no library tab at all — and a
 * profile restored onto a recorded `library` would open on nothing. The
 * `tabStore` parser below must therefore never learn the value either: a type
 * that forbids writing it is not a guarantee about what a *read* can produce.
 *
 * (The field was `thumbWrites` until `public-deployment` 3.8a moved these
 * surfaces onto `maintenance`, closing the interim `bulk-thumbnail-jobs`
 * declared in its own task 5.1. The reasoning above is unchanged by it: what
 * matters here is that a report *can* empty the tab, not which field does.)
 */
type StoredTab = Exclude<Tab, 'similar' | 'library'>

/**
 * How long a typed neighbour count waits before it becomes a question. The
 * search tuning's own debounce (`TUNING_DEBOUNCE_MS`, App) to the millisecond,
 * and deliberately so: two number fields in one panel that settled at different
 * speeds would read as one of them being broken.
 */
const SIMILAR_DEBOUNCE_MS = 300

/** What the index will accept, so the field refuses what the server would 400
 *  rather than spending a round trip to be told (`app.ts`'s `k` validator). */
const K_MIN = 1
const K_MAX = 1000

const collapseStore = stored(
  COLLAPSE_KEY,
  (raw) => raw === '1',
  (v) => (v ? '1' : '0'),
)
/** Anything that is not `search` reads as `chat` — which is already how a
 *  profile that somehow holds `similar` or `library` degrades, so old profiles
 *  need nothing.
 *
 *  `chat` is no longer a tab that always exists, and this parse is deliberately
 *  **not** the place that learns so: what it reads back is the profile's
 *  preference, and `resolveTab` is what turns a preference into a tab this
 *  deployment has (`public-deployment` D7). Teaching the parse instead would
 *  rewrite the recorded value on read, which is the one thing D7 forbids. */
const tabStore = stored<StoredTab>(
  TAB_KEY,
  (raw) => (raw === 'search' ? 'search' : 'chat'),
  (v) => v,
)

/**
 * The one fallback rule, for both of the places this panel falls back
 * (`public-deployment` D7): the tab that was wanted if this deployment has it,
 * and otherwise the first tab it does have.
 *
 * **The parse above is deliberately not rewritten to do this.** A recorded
 * value is a profile's preference, not a description of the deployment it is
 * being read on, and a profile carried between deployments must not come home
 * edited by having visited one — so a profile recording `chat` that meets a
 * deployment withholding the tab keeps `chat` recorded and simply opens on
 * search. Nothing here writes the store, and the resolved answer is never
 * written back.
 *
 * Both places needed it, which is why it is a function rather than two
 * expressions. The store's parse strands a profile on a tab the deployment
 * does not offer; the runtime move off a `library` tab that has gone away
 * landed on `'chat'`, which is the very tab a deployment may withhold. The
 * second was found only by reading this file against the tree — it arrived
 * with `bulk-thumbnail-jobs`, after this decision was first written.
 *
 * `available` is the panel's own tab order, so a fallback lands on the
 * leftmost tab there is; `search` is never withheld, so it is the leftmost
 * wherever `chat` is absent and the `?? 'search'` below is the type system's
 * indexing rule rather than a case that happens.
 */
export function resolveTab(preferred: Tab, available: readonly Tab[]): Tab {
  return available.includes(preferred) ? preferred : (available[0] ?? 'search')
}

/**
 * The right-edge panel: a tab host for the placeholder chat, the search tab,
 * and — only while there is a similarity view to be about — the Similar tab.
 * No backend behavior of its own — the chat echoes locally, and the option
 * tabs' controls cause only the requests those controls already imply.
 *
 * The panel **mirrors** the committed search; it does not own it. The search
 * input stays in the bar and the results label over the grid, because search
 * is the app's primary action and this panel is collapsible: a user who left
 * it closed must never have to open a drawer to search, or lose the ability to
 * tell what the grid is (search-options D5).
 *
 * Collapse state and the selected tab persist per profile — except the Similar
 * tab, which is never recorded (`StoredTab`). Neither belongs in the URL —
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
  onMode,
  onTuning,
  onSimilarTuning,
}: {
  query: string | null
  /**
   * The live view's similarity subject, or null when it is about anything else.
   * The Similar tab is offered from it by the same applicability idiom that
   * hides the name options under meaning: an option that cannot apply is
   * absent, not inert. A tab is that rule applied one level up — an absent tab
   * rather than an absent block.
   */
  similar: { model: string; k: number; pool?: Tuning['pool'] } | null
  /**
   * The whole-library bulk-job launcher, or `null` when there is none to offer
   * — the deployment does not offer maintenance operations, the report has not
   * landed, or the library is not ready (`bulk-thumbnail-jobs` D6, moved onto
   * that field by `public-deployment` 3.8a). The tab is absent
   * for a null, by the same absent-rather-than-inert rule the Similar tab and
   * the options inside these tabs follow.
   *
   * The panel neither derives nor launches: `count` is the runner's own
   * derivation run without launching anything (a count is a count, not a
   * reservation), and `launch` is App's one call into the runner. Reset's
   * confirmation is the **chip's**, not this panel's (D5) — the count exists
   * only after the launch has derived it.
   */
  library: {
    count: () => Promise<{ generate: number; reset: number; incomplete: boolean }>
    launch: (op: JobOperation) => void
    /**
     * Recount when this changes. App moves it when a job that wrote something
     * ends — the one moment the numbers on these buttons stopped being true and
     * only a derivation can say by how much.
     */
    recountKey: unknown
    /**
     * The running sum of the user's own framing changes (App's `handDelta`).
     * The reset button shows its derived count plus the change since that
     * count landed: an orbit moves the number at once without re-deriving the
     * library, and the next derivation absorbs the sum.
     */
    resetAdjust: number
  } | null
  /** The directory in view — meaning search only covers part of the filesystem. */
  path: string
  folderMatching: boolean
  kinds: SearchKinds
  mode: SearchMode
  /** How a meaning query is shaped — the index's own parameters. */
  tuning: Tuning
  index: IndexAvailability
  /** The index's own account of what it holds here — null outside a meaning search. */
  scope: SemanticScope | null
  /**
   * What this deployment offers, as App holds it — `null` while the read is in
   * flight or after it failed, and the two are not told apart here.
   *
   * Two things in this panel read it, and they read it by the two halves of
   * feature-report's unknown-report rule. The **chat tab is an offer**, so it
   * is withheld unless a known report declares it on: withheld while unknown,
   * so no tab renders and then vanishes a round trip later. The index-state
   * sentence is a **behaviour with an existing default**, so it keeps saying
   * what it has always said until a known report says the host is not the
   * viewer's concern (`public-deployment` D7, D9).
   */
  features: FeatureReport | null
  onFolderMatching: (on: boolean) => void
  onKinds: (kinds: SearchKinds) => void
  onMode: (mode: SearchMode) => void
  /** `defer` asks the caller to wait out a typing run before re-querying. */
  onTuning: (tuning: Tuning, opts?: { defer?: boolean }) => void
  /**
   * Re-ask the similarity view with these parameters. The whole set, never a
   * delta — `pool` omitted is "leave it to the index", which is a value to
   * assert rather than a field to forget. Called only with a finished count:
   * the debounce is this component's, below.
   */
  onSimilarTuning: (k: number, pool?: Tuning['pool']) => void
}) {
  // A tab with nothing to be about is absent, not greyed — the same rule the
  // options inside these tabs follow, and the same rule a withheld capability
  // follows, which is why the chat tab joins the list here rather than being
  // rendered disabled. Library goes last: it is the app's maintenance surface
  // (`bulk-thumbnail-jobs` D6), not one of the three tabs that describe the
  // view on screen.
  //
  // Derived before the state below rather than beside the markup, because the
  // opening tab is resolved against this list on the very first render.
  const hasChat = features?.chatTab === true
  const hasSimilar = similar !== null
  const hasLibrary = library !== null
  const tabs: Tab[] = [
    ...(hasChat ? (['chat'] as const) : []),
    'search',
    ...(hasSimilar ? (['similar'] as const) : []),
    ...(hasLibrary ? (['library'] as const) : []),
  ]
  const [collapsed, setCollapsed] = useState(() => collapseStore.read())
  /**
   * The tab on screen. Seeded from the recorded one, resolved against the tabs
   * this deployment actually has (`resolveTab`) — so a profile that recorded
   * `chat` opens on search where the tab is withheld, and its recorded value is
   * left alone.
   *
   * The report is not known on the first render, so a profile recording `chat`
   * always opens on search and moves to chat when the report says the tab is
   * offered — which is the effect below, and which the chat-panel capability
   * asks for in as many words ("until the report says the tab is offered").
   */
  const [tab, setTab] = useState<Tab>(() => resolveTab(tabStore.read(), tabs))
  const [messages, setMessages] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  /**
   * What the tuning number fields show while they are being typed in, `null`
   * when they simply show the value in force.
   *
   * A field mid-edit is not a value: cleared, `Number('')` is 0, and committing
   * that asked the index for the whole collection at score ≥ 0. So the text
   * lives here until it parses, and only a parsed value is handed up.
   */
  const [topText, setTopText] = useState<string | null>(null)
  const [scoreText, setScoreText] = useState<string | null>(null)
  // What each bound goes back to when it is switched on again. A bound sent
  // away is absent from the tuning — that is the whole encoding — so the value
  // it held has nowhere else to live, and the spec asks for it back
  // ("one bound can be sent away without the other"). Seeded from the defaults
  // and refreshed below whenever a bound is actually in force.
  const [heldTop, setHeldTop] = useState<number>(TUNING_DEFAULTS.top ?? 60)
  const [heldScore, setHeldScore] = useState<number>(TUNING_DEFAULTS.minScore ?? 0.1)
  useEffect(() => {
    if (tuning.top !== undefined) setHeldTop(tuning.top)
    if (tuning.minScore !== undefined) setHeldScore(tuning.minScore)
  }, [tuning.top, tuning.minScore])
  /**
   * The neighbour count while it is being typed in — the same draft the two
   * fields above keep, for the same reason: a field mid-edit is not a value,
   * and `Number('')` is 0, which is not a request for no neighbours.
   */
  const [countText, setCountText] = useState<string | null>(null)
  /**
   * …and the wait before a typed count becomes a question. This is the one
   * debounce that lives in a control rather than in App: the meaning tuning's
   * has a record-only reducer phase to pair with (a recorded value the URL must
   * not mint an entry for), and a similarity parameter has none — it either
   * re-asks or it has not happened yet. So there is nothing for the reducer to
   * hold, and the holding belongs where the keystrokes are.
   */
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(countTimerRef.current), [])

  function toggle(): void {
    const next = !collapsed
    setCollapsed(next)
    collapseStore.write(next)
  }

  function selectTab(next: Tab): void {
    setTab(next)
    // Selecting Similar is a move within one view, and selecting Library is a
    // move on a tab that may not be there next time — neither is a preference
    // about how this profile opens. See `StoredTab`.
    if (next !== 'similar' && next !== 'library') tabStore.write(next)
  }

  /**
   * The Similar tab follows the view it is about, in the two directions a view
   * changes under it.
   *
   * Arriving: the panel switches to it only from the search tab. Find-similar
   * is raised from a grid, so the tab the user was on is the only evidence of
   * what they were doing with this panel — search says "I am looking at how
   * this view is shaped", and the similarity parameters are the answer to that
   * question under the new view. Chat says something else entirely, and a
   * half-typed message losing its tab because a menu item was clicked
   * elsewhere is the panel taking a decision that was not offered to it.
   *
   * Leaving: a tab that is about to stop existing cannot stay selected, so it
   * falls back to search — the neighbouring options tab, and where a dismissal
   * lands the user anyway.
   *
   * Neither writes the store: a tab the app selected is not a tab the user
   * chose, and the one being selected here is the one that is never recorded.
   */
  useEffect(() => {
    if (hasSimilar) setTab((t) => (t === 'search' ? 'similar' : t))
    else setTab((t) => (t === 'similar' ? resolveTab('search', tabs) : t))
    // `tabs` is read but not depended on: this runs when the Similar tab
    // arrives or leaves, and the list it reads is the one this render built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSimilar])

  /**
   * The Library tab's half of the same rule — the leaving half only.
   *
   * Leaving: the tab can stop existing under the user (a feature report that
   * lands late and says no, a library that stops being ready), and a tab that
   * is gone cannot stay selected. It prefers `chat` — `search` is there too,
   * but this tab is nobody's search: the user was doing maintenance, and
   * dropping them into the options for a search they never asked about would be
   * the panel taking a decision it was not offered.
   *
   * **Prefers, since `public-deployment` D7 — it used to simply land there**,
   * on the reasoning that chat is "the one tab that is always there". A
   * deployment may withhold the chat tab, so that was a fallback onto a tab
   * that need not exist, and this is the second of the two places `resolveTab`
   * exists for. Where chat is withheld this lands on search after all — the
   * lesser of the two, and the only one left.
   *
   * There is deliberately **no arriving half**. Similar arrives because a
   * find-similar reshapes the very view the panel is describing; a feature
   * report resolving is not a thing the user did, and stealing a half-typed
   * chat message for it would be worse than a tab they can click.
   *
   * Writes no store, like the Similar rule: a tab the app selected is not a tab
   * the user chose, and neither of these two is ever recorded anyway.
   */
  useEffect(() => {
    if (!hasLibrary) setTab((t) => (t === 'library' ? resolveTab('chat', tabs) : t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLibrary])

  /**
   * And the third place a tab can stop existing: the report landing.
   *
   * Keyed on the report's answer alone, not on the tab list, because this is
   * the one change that re-asks what the *profile* wanted rather than moving
   * the tab in hand. A deployment offering chat is one where a profile that
   * recorded it opens on it, and the first render cannot know that yet — the
   * report is in flight, the tab is withheld like any unknown offer, and search
   * is where the panel starts. When the answer arrives the recorded preference
   * is resolved again against the list it now has.
   *
   * `similar` and `library` are exempt: neither is ever recorded, both are
   * about the view on screen rather than about this profile, and a report
   * resolving is not a thing the user did — taking a viewer off a similarity
   * view they raised would be the panel deciding something nobody asked it.
   *
   * Writes no store: this reads the recorded value and never replaces it, which
   * is what keeps a profile from being edited by the deployment it visited.
   */
  useEffect(() => {
    setTab((t) => (t === 'similar' || t === 'library' ? t : resolveTab(tabStore.read(), tabs)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChat])

  /**
   * The two counts, derived when the tab is open and again whenever the
   * launcher says they have gone stale (`recountKey` — App moves it when a job
   * that wrote something settles; a hand's own change rides `resetAdjust`). `null` is *counting*, which is what the buttons say until it
   * lands; the panel never blocks on it (D5).
   *
   * Latest-wins by token, the same shape the neighbour count's debounce uses
   * one field down: two derivations can be in flight across a recount, and the
   * slower one landing second would put a stale number under a button that
   * launches the fresh derivation.
   */
  const [counts, setCounts] = useState<
    { generate: number; reset: number; incomplete: boolean } | null | 'failed'
  >(null)
  const countTokenRef = useRef(0)
  const showLibrary = tab === 'library' && library !== null
  const countFn = library?.count
  const recountKey = library?.recountKey
  const resetAdjust = library?.resetAdjust ?? 0
  // The hand-change sum as it stood when the shown count was *asked for*: the
  // server counted then, so a change made while the answer was in flight is
  // not in it and must be added, not swallowed (the review's finding — the
  // first version read the sum at landing). A derivation absorbs the sum.
  const adjustBaseRef = useRef(0)
  useEffect(() => {
    if (!showLibrary || countFn === undefined) return
    const token = ++countTokenRef.current
    const base = resetAdjust
    setCounts(null)
    void countFn().then(
      (c) => {
        if (countTokenRef.current !== token) return
        adjustBaseRef.current = base
        setCounts(c)
      },
      () => {
        // A scope that could not be enumerated says so rather than counting
        // forever — a button with no way out is a surface, not an affordance.
        // Reselecting the tab asks again.
        if (countTokenRef.current !== token) return
        setCounts('failed')
      },
    )
    // `resetAdjust` is read at request time and deliberately not a dependency:
    // a hand change must move the number, never re-ask for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLibrary, countFn, recountKey])

  // Answers "why are my results strange?" without opening the panel (D5).
  const nonDefault = !folderMatching || kinds !== 'both'

  // Ready is necessary and not sufficient: the index covers one collection and
  // no archive interiors, so offering the mode elsewhere promises an answer the
  // server will refuse. The in-range rule is `indexCovers` and not a copy of it
  // — the find-similar command asks the same question of a model's path, and two
  // affordances over one index disagreeing about what it covers is the drift
  // that produces a menu item and a mode button contradicting each other.
  const meaningRunnable = index.state === 'ready' && indexCovers(index, path)
  // The mode control is offered when meaning could run — and whenever meaning
  // is *in force*, however it got there, because a mode you cannot see and
  // cannot leave is a trap: a link can put this app in meaning mode on a
  // machine that has no index.
  const showMode = meaningRunnable || mode === 'meaning'
  // Name-search options belong to the name corpus and nothing else. An earlier
  // version showed them whenever meaning could not run, on the grounds that a
  // submit would then be a name search — which stopped being true when such a
  // submit began deferring instead. Showing folder-matching under a mode that
  // says Meaning states a contradiction about what the next search will do.
  const nameOptionsApply = mode === 'name'
  // An absent index is not worth reporting to someone searching by name — most
  // machines will never run it. It is worth reporting to someone whose mode
  // says meaning, who is otherwise looking at a panel that explains nothing.
  const showIndexState = !meaningRunnable && (mode === 'meaning' || index.state !== 'absent')

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 transition-all ${collapsed ? 'w-10' : 'w-80'}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand side panel' : 'Collapse side panel'}
        className="flex h-10 items-center justify-center text-zinc-400 hover:text-zinc-100"
      >
        {collapsed ? (nonDefault ? '•' : '\u2039') : '\u203a'}
      </button>
      {!collapsed && (
        <>
          <div className="flex border-b border-zinc-800 text-xs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => selectTab(t)}
                className={`flex-1 px-3 py-2 capitalize ${tab === t ? 'border-b border-zinc-300 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {t}
                {t === 'search' && nonDefault && <span className="ml-1 text-amber-400">•</span>}
              </button>
            ))}
          </div>
          {tab === 'search' ? (
            <div className="flex-1 space-y-4 overflow-auto p-3 text-xs">
              <div>
                <p className="mb-2 text-zinc-500">Search</p>
                {query === null ? (
                  <p className="text-zinc-600">No search committed. These apply to the next one.</p>
                ) : (
                  <p className="break-all text-zinc-300">
                    Results for &ldquo;{query}&rdquo;
                  </p>
                )}
              </div>
              {showMode && (
                <div className="flex gap-1" role="group" aria-label="Search by">
                  {(['name', 'meaning'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => onMode(m)}
                      className={`flex-1 rounded-lg border px-2 py-1.5 capitalize ${mode === m ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {/* The index's own words about itself: which of its states it is
                  in, and what it can hold at all. Absent is not an error to
                  report — most machines will never run it (D4). The sentence
                  and the index's own words come from one call, because a
                  deployment that collapses the states withholds both together
                  (`indexAccount`). */}
              {showIndexState && (
                <p className="text-zinc-500">
                  {indexAccount(index, path, features?.hostDetails !== false)}
                </p>
              )}
              {scope !== null && (
                <p className="text-zinc-500">
                  {scope.status === 'unindexed'
                    ? 'Nothing here has been indexed yet.'
                    : scope.status === 'partial'
                      ? `${scope.indexed} of ${scope.scanned} models here are indexed.`
                      : `${scope.indexed} models indexed.`}{' '}
                  Covers {scope.covers.join(', ')}.
                </p>
              )}
              {mode === 'meaning' && meaningRunnable && (
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <p className="text-zinc-500">Tuning</p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tuning.raw}
                    aria-label="Read the phrase as written"
                    onClick={() => onTuning({ ...tuning, raw: !tuning.raw })}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${tuning.raw ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                  >
                    Phrase as written
                    <span className="float-right">{tuning.raw ? 'on' : 'templated'}</span>
                  </button>
                  <div className="flex gap-1" role="group" aria-label="Pool views by">
                    {(['mean', 'max', 'softmax'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={tuning.pool === p}
                        onClick={() => onTuning({ ...tuning, pool: p })}
                        className={`flex-1 rounded-lg border px-2 py-1.5 ${tuning.pool === p ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  {/* The two bounds compose, so each button switches its own
                      bound on or off rather than choosing between them: count
                      only, floor only, or both (design D6). The old exclusive
                      pair encoded a relationship the index no longer has, and a
                      disabled partner field was that lie drawn in pixels.

                      The invariant is that at least one bound stays in force —
                      an unbounded meaning search is the whole collection, which
                      no control here should be able to ask for — so the button
                      of a sole surviving bound is inert and says so in its title.

                      Being inert must not make it look unselected, which is the
                      trap the first version fell into: a `disabled:opacity-60`
                      washed out the one bound actually in force, so the active
                      button rendered fainter than the inactive one and the
                      focus ring left on the button just clicked read as the
                      selection instead. Hence no dimming here, and an on-state
                      carrying a filled background rather than a border alone.
                      Every other button row in this panel is a radio group where
                      exactly one is lit and position carries the meaning; this
                      is the only row of independent toggles, where which one is
                      lit is the whole message and has to survive a focus ring
                      sitting on its neighbour. */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={tuning.top !== undefined}
                      disabled={tuning.top !== undefined && tuning.minScore === undefined}
                      onClick={() => {
                        setTopText(null)
                        onTuning({
                          ...tuning,
                          top: tuning.top === undefined ? heldTop : undefined,
                        })
                      }}
                      title={
                        tuning.top !== undefined && tuning.minScore === undefined
                          ? 'The only bound in force — a search has to stop somewhere'
                          : undefined
                      }
                      className={`rounded-lg border px-2 py-1.5 disabled:cursor-default ${tuning.top !== undefined ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
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
                        const text = e.target.value
                        setTopText(text)
                        const n = Number(text)
                        // Held, not clamped: a cleared field on its way to "20"
                        // is not a request for one result.
                        if (text.trim() === '' || !Number.isFinite(n) || n < 1) return
                        // Clamped on the way out, though — a count above the
                        // index's own ceiling names a set it will not return
                        // (D5), and the field shows the clamp on blur rather
                        // than keeping a number the search cannot honour.
                        onTuning({ ...tuning, top: clampCount(n) }, { defer: true })
                      }}
                      onBlur={() => setTopText(null)}
                      className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-40"
                    />
                    <button
                      type="button"
                      aria-pressed={tuning.minScore !== undefined}
                      disabled={tuning.minScore !== undefined && tuning.top === undefined}
                      onClick={() => {
                        setScoreText(null)
                        onTuning({
                          ...tuning,
                          minScore: tuning.minScore === undefined ? heldScore : undefined,
                        })
                      }}
                      title={
                        tuning.minScore !== undefined && tuning.top === undefined
                          ? 'The only bound in force — a search has to stop somewhere'
                          : undefined
                      }
                      className={`rounded-lg border px-2 py-1.5 disabled:cursor-default ${tuning.minScore !== undefined ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
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
                        const text = e.target.value
                        setScoreText(text)
                        const n = Number(text)
                        // `Number('')` is 0, and a floor of 0 is the whole
                        // collection — the one value clearing the field must
                        // never mean.
                        if (text.trim() === '' || !Number.isFinite(n)) return
                        onTuning({ ...tuning, minScore: n }, { defer: true })
                      }}
                      onBlur={() => setScoreText(null)}
                      className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-40"
                    />
                  </div>
                  {(tuning.raw !== TUNING_DEFAULTS.raw ||
                    tuning.pool !== TUNING_DEFAULTS.pool ||
                    tuning.top !== TUNING_DEFAULTS.top ||
                    tuning.minScore !== TUNING_DEFAULTS.minScore) && (
                    <button
                      type="button"
                      onClick={() => {
                        setTopText(null)
                        setScoreText(null)
                        onTuning({ ...TUNING_DEFAULTS })
                      }}
                      className="text-zinc-500 underline hover:text-zinc-300"
                    >
                      Reset tuning
                    </button>
                  )}
                </div>
              )}
              {/* Options that cannot apply to the mode in force are absent, not
                  inert: a visible control that does nothing is worse than one
                  that is not there (D2). */}
              {nameOptionsApply && (
                <div className="space-y-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={folderMatching}
                  aria-label="Match folder names"
                  onClick={() => onFolderMatching(!folderMatching)}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${folderMatching ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                >
                  Match folder names
                  <span className="float-right">{folderMatching ? 'on' : 'off'}</span>
                </button>
                <div className="flex gap-1" role="group" aria-label="Show">
                  {(['both', 'folders', 'models'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kinds === k}
                      onClick={() => onKinds(k)}
                      className={`flex-1 rounded-lg border px-2 py-1.5 capitalize ${kinds === k ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                    >
                      {k}
                    </button>
                  ))}
                  </div>
                </div>
              )}
            </div>
          ) : /* `similar !== null` is not only narrowing: a dismissal renders
                 once before the effect above moves off this tab, and that
                 render has no subject left to describe. */
          tab === 'similar' && similar !== null ? (
            <div className="flex-1 space-y-2 overflow-auto p-3 text-xs">
              {/* What a similarity view is about, and the two parameters it
                  reads. The tab is the heading, so this block carries none of
                  its own.

                  Nothing here is sticky. The four search options are stored per
                  profile because they describe how *you* search; these describe
                  one neighbourhood, and a count that suited one model's says
                  nothing about another's. The URL carries them, so a view worth
                  keeping is kept by keeping its link, and the next find-similar
                  starts from the defaults. */}
              <p className="break-all text-zinc-300">
                Similar to &ldquo;{similar.model.slice(similar.model.lastIndexOf('/') + 1)}&rdquo;
              </p>
              <div className="flex items-center gap-2">
                <label className="text-zinc-500" htmlFor="similar-count">
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
                    const text = e.target.value
                    setCountText(text)
                    const n = Number(text)
                    // Held, not clamped — a field cleared on its way to "40" is
                    // not a request for one neighbour, and one on its way past
                    // 1000 is not a request for the whole collection.
                    if (text.trim() === '' || !Number.isFinite(n)) return
                    const k = Math.round(n)
                    if (k < K_MIN || k > K_MAX) return
                    clearTimeout(countTimerRef.current)
                    countTimerRef.current = setTimeout(
                      () => onSimilarTuning(k, similar.pool),
                      SIMILAR_DEBOUNCE_MS,
                    )
                  }}
                  onBlur={() => setCountText(null)}
                  className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100"
                />
              </div>
              {/* Pooling is a click, so it runs at once: waiting on a finished
                  value only makes sense where the value arrives a character at
                  a time. */}
              {/* Named apart from the meaning tuning's identical trio: the mode
                  is sticky, so a profile whose next search is a meaning one has
                  both reachable under a similarity view, and two controls
                  sharing an accessible name is one control as far as anything
                  reading names is concerned. */}
              <div className="flex gap-1" role="group" aria-label="Pool neighbour views by">
                {POOLS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={similar.pool === p}
                    onClick={() => {
                      // Whatever the count field was holding is superseded by
                      // this question, which carries the count in force.
                      clearTimeout(countTimerRef.current)
                      setCountText(null)
                      onSimilarTuning(similar.k, p)
                    }}
                    className={`flex-1 rounded-lg border px-2 py-1.5 ${similar.pool === p ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {/* None pressed is a state, not a gap: absence means the index's
                  own pooling, which is not any of the three — so saying which
                  one it is would be a guess about another process's
                  configuration. */}
              {similar.pool === undefined && (
                <p className="text-zinc-600">Pooled however the index is configured to.</p>
              )}
            </div>
          ) : /* `library !== null` narrows, and covers the render between a
                 launcher disappearing and the effect above moving off this
                 tab — the Similar branch's own guard, for its reason. */
          tab === 'library' && library !== null ? (
            <div className="flex-1 space-y-2 overflow-auto p-3 text-xs">
              <p className="text-zinc-500">
                Bulk thumbnail work over the whole library. Jobs run behind whatever you are
                looking at; cancel and relaunch to pause.
              </p>
              {/* Counted labels, which the context menu's entries deliberately
                  are not (D5): this surface renders asynchronously already, so
                  a number arriving a moment later reshapes nothing. */}
              {(['generate', 'reset'] as const).map((op) => {
                const n =
                  counts === null || counts === 'failed'
                    ? null
                    : op === 'generate'
                      ? counts.generate
                      : Math.max(0, counts.reset + (resetAdjust - adjustBaseRef.current))
                return (
                  <button
                    key={op}
                    type="button"
                    disabled={n === null || n === 0}
                    onClick={() => library.launch(op)}
                    className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-left text-zinc-300 hover:border-zinc-500 disabled:opacity-40 disabled:hover:border-zinc-800"
                  >
                    {counts === 'failed'
                      ? 'Count failed'
                      : n === null
                        ? 'Counting…'
                      : op === 'generate'
                        ? `Generate ${n} missing thumbnails`
                        : `Reset ${n} framings`}
                  </button>
                )
              })}
              {/* An enumeration that ran out of budget found *some* of the
                  scope, so the numbers above are true as far as they go and
                  false as a total. Saying which is the honest button (D8). */}
              {counts === 'failed' && (
                <p className="text-zinc-600">The library could not be counted — reopen the tab to try again.</p>
              )}
              {counts !== null && counts !== 'failed' && counts.incomplete && (
                <p className="text-zinc-600">The scope was cut short — counts are a floor.</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-auto px-3 pb-2">
                {messages.length === 0 ? (
                  <p className="mt-4 text-center text-xs text-zinc-600">
                    Chat about your models — coming soon.
                  </p>
                ) : (
                  messages.map((m, i) => (
                    <p key={i} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200">
                      {m}
                    </p>
                  ))
                )}
              </div>
              <form
                className="border-t border-zinc-800 p-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (draft.trim() === '') return
                  setMessages((prev) => [...prev, draft.trim()])
                  setDraft('')
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Message…"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
              </form>
            </>
          )}
        </>
      )}
    </aside>
  )
}
