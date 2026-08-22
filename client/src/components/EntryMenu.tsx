import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EntryCommand } from '../lib/entryActions'

/**
 * A context menu raised on a grid tile.
 *
 * It renders whatever `commands` it is handed — which command applies to which
 * entry is `entryActions`' table (D6), asked once by App, never re-decided
 * here. This component owns position, dismissal and keyboard, and nothing else.
 *
 * It is not a viewer: mounting it suspends no render queue and starts no
 * thumbnail work. The suspension is keyed off `viewer` (App), which a menu
 * never sets.
 */
interface Props {
  x: number
  y: number
  commands: EntryCommand[]
  onChoose: (command: EntryCommand) => void
  onClose: () => void
}

/** Margin between the menu and the window edge. */
const EDGE = 6

/**
 * Keep the whole menu on screen (R2's "all of its items are visible"). Pure and
 * exported because a jsdom/happy-dom rect is all zeros: the clamp is unit-tested
 * on its own, and the component is tested for applying what it returns.
 *
 * Clamped rather than flipped: a menu that flips above the pointer when it is
 * near the bottom moves its first item away from where the user is looking, and
 * this one is short enough that sliding it up always fits.
 */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, vw - w - EDGE)),
    top: Math.max(EDGE, Math.min(y, vh - h - EDGE)),
  }
}

export default function EntryMenu({ x, y, commands, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [focused, setFocused] = useState(0)

  // Measure once mounted, then clamp: the height depends on how many commands
  // this entry offers, which is the whole reason it cannot be computed upfront.
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos(clampToViewport(x, y, r.width, r.height, window.innerWidth, window.innerHeight))
  }, [x, y, commands.length])

  // Focus follows the arrow keys, so the menu owns the keyboard the moment it
  // is raised — which is also what makes its Escape the one that fires.
  useEffect(() => {
    const el = ref.current?.querySelectorAll<HTMLButtonElement>('button')[focused]
    el?.focus()
  }, [focused])

  // Escape and outside interaction, at the window, so they work wherever focus
  // happens to be. App's find control also closes on Escape; it stands down
  // while a menu is raised (App holds a ref for exactly this, the way it
  // already stands down for a mounted viewer).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    function onDown(e: Event): void {
      if (e.target instanceof Node && ref.current?.contains(e.target) === true) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    // A secondary press elsewhere raises the next menu; this one must not
    // survive it.
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('wheel', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('wheel', onDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Entry actions"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 text-sm text-zinc-200 shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocused((i) => (i + 1) % commands.length)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocused((i) => (i - 1 + commands.length) % commands.length)
        } else if (e.key === 'Home') {
          e.preventDefault()
          setFocused(0)
        } else if (e.key === 'End') {
          e.preventDefault()
          setFocused(commands.length - 1)
        }
      }}
    >
      {commands.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitem"
          data-command={c.id}
          // Click, not pointerdown: the window-level pointerdown above closes
          // the menu on anything outside it, and a press that both chose an
          // item and dismissed the menu would race itself.
          onClick={() => onChoose(c)}
          className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none"
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
