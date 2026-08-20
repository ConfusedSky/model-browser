import { useEffect, useRef } from 'react'

/**
 * The find control: summoned over a listing to narrow it by name, dismissed
 * with Escape. It exists on demand rather than as a permanent field because
 * filtering is ephemeral view state — navigation discards it, and it is absent
 * from the URL — and a box that appears when asked for says that, where a
 * permanent one implies a persistence the filter does not have.
 *
 * It also keeps the search input holding one thing. The two shared a box until
 * the filter moved here, which was coherent only while both matched the same
 * string.
 */
export default function FindBar({
  value,
  count,
  onChange,
  onClose,
}: {
  value: string
  /** Entries currently visible, so the user can see the filter working. */
  count: number
  onChange: (value: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  // Focused on open: a control the user summoned and then has to click into
  // has not finished appearing.
  useEffect(() => ref.current?.focus(), [])

  return (
    <div data-find-bar className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
      <span aria-hidden="true" className="text-xs text-zinc-500">
        ⌕
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        placeholder="Narrow these by name…"
        aria-label="Narrow these by name"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none"
      />
      <span className="shrink-0 text-xs text-zinc-500">{count} shown</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close find"
        className="shrink-0 rounded px-2 text-sm text-zinc-400 hover:text-zinc-100"
      >
        ✕
      </button>
    </div>
  )
}
