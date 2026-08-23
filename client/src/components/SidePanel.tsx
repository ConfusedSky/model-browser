import { useEffect, useRef, useState } from 'react'
import type { IndexAvailability, SemanticScope } from '../../../shared/types'
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { POOLS, TUNING_DEFAULTS } from '../lib/searchOptions'
import { stored } from '../lib/stored'
import { indexCovers } from '../state/selectors'

/** Predates the tab host, and kept: renaming it would drop every profile's state. */
const COLLAPSE_KEY = 'model-browser:chat-collapsed'
const TAB_KEY = 'model-browser:panel-tab'

type Tab = 'chat' | 'search' | 'similar'

/**
 * The tabs that may be *recorded*. Similar is not one of them: it exists only
 * while a similarity view does, so a profile restored onto it with no such view
 * would open on a tab that is not there. Excluding it from the store's type is
 * what makes that a rule rather than a habit — `tabStore.write('similar')` does
 * not compile.
 */
type StoredTab = Exclude<Tab, 'similar'>

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
 *  profile that somehow holds `similar` degrades, so old profiles need nothing. */
const tabStore = stored<StoredTab>(
  TAB_KEY,
  (raw) => (raw === 'search' ? 'search' : 'chat'),
  (v) => v,
)

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
  path,
  folderMatching,
  kinds,
  mode,
  tuning,
  index,
  scope,
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
  const [collapsed, setCollapsed] = useState(() => collapseStore.read())
  const [tab, setTab] = useState<Tab>(() => tabStore.read())
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
    // Selecting Similar is a move within one view, not a preference about how
    // this profile opens — see `StoredTab`.
    if (next !== 'similar') tabStore.write(next)
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
  const hasSimilar = similar !== null
  useEffect(() => {
    if (hasSimilar) setTab((t) => (t === 'search' ? 'similar' : t))
    else setTab((t) => (t === 'similar' ? 'search' : t))
  }, [hasSimilar])

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
  // A tab with nothing to be about is absent, not greyed — the same rule the
  // options inside these tabs follow.
  const tabs: Tab[] = hasSimilar ? ['chat', 'search', 'similar'] : ['chat', 'search']

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
                  report — most machines will never run it (D4). */}
              {showIndexState && (
                <p className="text-zinc-500">
                  {index.state === 'warming'
                    ? `Meaning search is starting up${index.elapsed !== undefined ? ` (${Math.round(index.elapsed)}s)` : ''}…`
                    : index.state === 'volume-gone'
                      ? 'Meaning search is running, but its library volume is not mounted.'
                      : index.state === 'wedged'
                        ? 'Meaning search did not finish starting.'
                        : 'Meaning search is not running — start the index to use it.'}
                  {index.detail !== undefined && ` ${index.detail}`}
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
                  {/* A count and a floor are one choice: the index ignores the
                      count when a floor is set, so showing both as live would
                      state a relationship that does not exist (D1). */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={tuning.minScore === undefined}
                      onClick={() => {
                        setTopText(null)
                        setScoreText(null)
                        onTuning({ ...tuning, minScore: undefined })
                      }}
                      className={`rounded-lg border px-2 py-1.5 ${tuning.minScore === undefined ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                    >
                      top
                    </button>
                    <input
                      type="number"
                      min={1}
                      aria-label="Number of results"
                      value={topText ?? String(tuning.top)}
                      disabled={tuning.minScore !== undefined}
                      onChange={(e) => {
                        const text = e.target.value
                        setTopText(text)
                        const n = Number(text)
                        // Held, not clamped: a cleared field on its way to "20"
                        // is not a request for one result.
                        if (text.trim() === '' || !Number.isFinite(n) || n < 1) return
                        onTuning({ ...tuning, top: Math.round(n) }, { defer: true })
                      }}
                      onBlur={() => setTopText(null)}
                      className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-40"
                    />
                    <button
                      type="button"
                      aria-pressed={tuning.minScore !== undefined}
                      onClick={() => {
                        setTopText(null)
                        setScoreText(null)
                        onTuning({ ...tuning, minScore: tuning.minScore ?? 0.2 })
                      }}
                      className={`rounded-lg border px-2 py-1.5 ${tuning.minScore !== undefined ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                    >
                      score ≥
                    </button>
                    <input
                      type="number"
                      step={0.01}
                      aria-label="Minimum score"
                      value={scoreText ?? (tuning.minScore === undefined ? '' : String(tuning.minScore))}
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
                    tuning.minScore !== undefined) && (
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
