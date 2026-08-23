import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OrbitAxis } from '../../../shared/types'
import { ORBIT_AXIS_CHOICES, type EntryCommand } from '../lib/entryActions'

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
  /**
   * The orbit-axis group (6.7), or `null` where it is not offered — a container
   * tile, or either viewer surface, which shows the live picker instead. App
   * decides that with `orbitAxisApplies`; this component only draws it.
   *
   * An **inline radio group**, not a submenu, and the reason is this component's
   * keyboard model: focus here is one index over the menu's buttons, so six more
   * buttons cost one changed count and nothing else, while a submenu would need
   * its own open state, its own clamp, focus handed across it and a second level
   * of Escape — new machinery for a menu of at most twelve short items.
   */
  axis?: { current: OrbitAxis; onChoose: (axis: OrbitAxis) => void } | null
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

export default function EntryMenu({ x, y, commands, axis = null, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [focused, setFocused] = useState(0)

  // Every focusable row, commands first, in DOM order — which is what `focused`
  // indexes and what the focus effect below reads back out of the DOM.
  const axisCount = axis === null ? 0 : ORBIT_AXIS_CHOICES.length
  const count = commands.length + axisCount
  const currentAxisRow =
    axis === null ? 0 : commands.length + ORBIT_AXIS_CHOICES.findIndex((c) => c.axis === axis.current)

  /**
   * One step of arrow navigation, with the group's one rule: **entering it lands
   * on the spindle already in force**, rather than on the first of six. The
   * group is a choice among six and a choice starts from what is currently
   * true — the same reason the picker in the lightbox opens showing the live
   * axis pressed. Every one of the six is still reached by stepping on from
   * there, in either direction.
   */
  function step(from: number, delta: number): number {
    const next = (from + delta + count) % count
    if (from < commands.length && next >= commands.length) return currentAxisRow
    return next
  }

  // Measure once mounted, then clamp: the height depends on how many commands
  // this entry offers, which is the whole reason it cannot be computed upfront.
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos(clampToViewport(x, y, r.width, r.height, window.innerWidth, window.innerHeight))
  }, [x, y, commands.length, axisCount])

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
          setFocused((i) => step(i, 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocused((i) => step(i, -1))
        } else if (e.key === 'Home') {
          e.preventDefault()
          setFocused(0)
        } else if (e.key === 'End') {
          e.preventDefault()
          setFocused(count - 1)
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
      {axis !== null && (
        // The spindle this model is stored about — a radio group, since exactly
        // one of the six is true of it and picking one is picking, not toggling.
        // The heading is a <p>, so it stays out of the button index `focused`
        // walks.
        <div role="group" aria-label="Orbit axis" className="mt-1 border-t border-zinc-700 pt-1">
          <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-zinc-500">Orbit axis</p>
          {ORBIT_AXIS_CHOICES.map((c) => (
            <button
              key={c.axis}
              type="button"
              role="menuitemradio"
              aria-checked={c.axis === axis.current}
              data-axis={c.axis}
              onClick={() => axis.onChoose(c.axis)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none"
            >
              <span className="w-3 text-sky-400" aria-hidden="true">
                {c.axis === axis.current ? '✓' : ''}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
