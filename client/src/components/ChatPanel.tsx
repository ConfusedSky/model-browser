import { useState } from 'react'

const COLLAPSE_KEY = 'model-browser:chat-collapsed'

/**
 * Placeholder chat panel — no backend behavior; submitted input is echoed
 * locally only. Collapse state persists in localStorage.
 */
export default function ChatPanel() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [messages, setMessages] = useState<string[]>([])
  const [draft, setDraft] = useState('')

  function toggle(): void {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
  }

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 transition-all ${collapsed ? 'w-10' : 'w-80'}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand chat panel' : 'Collapse chat panel'}
        className="flex h-10 items-center justify-center text-zinc-400 hover:text-zinc-100"
      >
        {collapsed ? '‹' : '›'}
      </button>
      {!collapsed && (
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
    </aside>
  )
}
