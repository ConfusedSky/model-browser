import { useState } from 'react'
import type { SearchKinds } from '../lib/searchOptions'

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
  folderMatching,
  kinds,
  onFolderMatching,
  onKinds,
}: {
  query: string | null
  folderMatching: boolean
  kinds: SearchKinds
  onFolderMatching: (on: boolean) => void
  onKinds: (kinds: SearchKinds) => void
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
