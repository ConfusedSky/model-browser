import { useState } from 'react'
import type { IndexAvailability, SemanticScope } from '../../../shared/types'
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { TUNING_DEFAULTS } from '../lib/searchOptions'

const COLLAPSE_KEY = 'model-browser:chat-collapsed'
const TAB_KEY = 'model-browser:panel-tab'

type Tab = 'chat' | 'search'

/**
 * The right-edge panel: a tab host for the placeholder chat and the search
 * tab. No backend behavior of its own — the chat echoes locally, and the
 * search tab's controls cause only the requests those controls already imply.
 *
 * The panel **mirrors** the committed search; it does not own it. The search
 * input stays in the bar and the results label over the grid, because search
 * is the app's primary action and this panel is collapsible: a user who left
 * it closed must never have to open a drawer to search, or lose the ability to
 * tell what the grid is (search-options D5).
 *
 * Collapse state and the selected tab persist per profile. Neither belongs in
 * the URL — neither changes which entries a view contains.
 */
export default function SidePanel({
  query,
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
}: {
  query: string | null
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
  onTuning: (tuning: Tuning) => void
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [tab, setTab] = useState<Tab>(() =>
    localStorage.getItem(TAB_KEY) === 'search' ? 'search' : 'chat',
  )
  const [messages, setMessages] = useState<string[]>([])
  const [draft, setDraft] = useState('')

  function toggle(): void {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
  }

  function selectTab(next: Tab): void {
    setTab(next)
    localStorage.setItem(TAB_KEY, next)
  }

  // Answers "why are my results strange?" without opening the panel (D5).
  const nonDefault = !folderMatching || kinds !== 'both'

  // Ready is necessary and not sufficient: the index covers one collection and
  // no archive interiors, so offering the mode elsewhere promises an answer the
  // server will refuse. A prefix check is the right approximation here — the
  // server still compares resolved paths, and a disagreement costs the
  // affordance rather than producing a wrong answer.
  const inRange =
    index.collectionRoot !== undefined &&
    !path.includes('!/') &&
    (path === index.collectionRoot || path.startsWith(`${index.collectionRoot}/`))
  const meaningRunnable = index.state === 'ready' && inRange
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
            {(['chat', 'search'] as const).map((t) => (
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
                      onClick={() => onTuning({ ...tuning, minScore: undefined })}
                      className={`rounded-lg border px-2 py-1.5 ${tuning.minScore === undefined ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                    >
                      top
                    </button>
                    <input
                      type="number"
                      min={1}
                      aria-label="Number of results"
                      value={tuning.top}
                      disabled={tuning.minScore !== undefined}
                      onChange={(e) =>
                        onTuning({ ...tuning, top: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-40"
                    />
                    <button
                      type="button"
                      aria-pressed={tuning.minScore !== undefined}
                      onClick={() =>
                        onTuning({ ...tuning, minScore: tuning.minScore ?? 0.2 })
                      }
                      className={`rounded-lg border px-2 py-1.5 ${tuning.minScore !== undefined ? 'border-zinc-500 text-zinc-100' : 'border-zinc-800 text-zinc-500'}`}
                    >
                      score ≥
                    </button>
                    <input
                      type="number"
                      step={0.01}
                      aria-label="Minimum score"
                      value={tuning.minScore ?? ''}
                      disabled={tuning.minScore === undefined}
                      onChange={(e) => onTuning({ ...tuning, minScore: Number(e.target.value) })}
                      className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-40"
                    />
                  </div>
                  {(tuning.raw !== TUNING_DEFAULTS.raw ||
                    tuning.pool !== TUNING_DEFAULTS.pool ||
                    tuning.top !== TUNING_DEFAULTS.top ||
                    tuning.minScore !== undefined) && (
                    <button
                      type="button"
                      onClick={() => onTuning({ ...TUNING_DEFAULTS })}
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
