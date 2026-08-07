import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '../api/client'
import { getRecents } from '../lib/recents'

interface Props {
  path: string
  error: string | null
  api: ApiClient
  onNavigate: (path: string) => void
}

export default function PathBar({ path, error, api, onNavigate }: Props) {
  const [value, setValue] = useState(path)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setValue(path)
  }, [path])

  function refreshSuggestions(input: string): void {
    if (debounce.current !== null) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      if (input === '') {
        setSuggestions(getRecents())
        return
      }
      void api
        .complete(input)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 150)
  }

  function submit(target: string): void {
    editing.current = false
    setOpen(false)
    if (target !== '') onNavigate(target.endsWith('/') && target !== '/' ? target.slice(0, -1) : target)
  }

  return (
    <div className="relative flex-1">
      <input
        value={value}
        placeholder="Type a directory path…"
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-500"
        onFocus={() => {
          editing.current = true
          setOpen(true)
          setSuggestions(value === '' ? getRecents() : [])
          if (value !== '') refreshSuggestions(value)
        }}
        onBlur={() => {
          editing.current = false
          // Delay so suggestion mousedown wins over blur.
          setTimeout(() => setOpen(false), 150)
        }}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
          refreshSuggestions(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit(value)
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {error !== null && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left font-mono text-sm text-zinc-300 hover:bg-zinc-800"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setValue(s)
                  submit(s)
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
