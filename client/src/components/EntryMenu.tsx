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
   * tile, or the **lightbox**, which shows the live picker instead. App decides
   * that with `orbitAxisApplies`; this component only draws it.
   *
   * An **inline radio group**, not a submenu, and the reason is this component's
   * keyboard model: focus here is one index over the menu's buttons, so six more
   * buttons cost one changed count and nothing else, while a submenu would need
   * its own open state, its own clamp, focus handed across it and a second level
   * of Escape — new machinery for a menu of at most twelve short items.
   *
   * Drawn at the **top**, as a compact pill row rather than six full-width rows
   * *(user feedback 2026-08-22, 6.8)*: six rows of a twelve-row menu were the
   * axis, which read as the menu's subject rather than as one property of the
   * model. A row of pills is also the vocabulary the user already learned from
   * the lightbox's own picker (`ViewerLayer.tsx`, the `left-3 top-3` row), so
   * `−Z` is recognised rather than translated.
   */
  axis?: { current: OrbitAxis; onChoose: (axis: OrbitAxis) => void } | null
  onChoose: (command: EntryCommand) => void
  onClose: () => void
}

/** Margin between the menu and the window edge. */
const EDGE = 6

/**
 * One menu item's look: a full-width, square-cornered row that fills on hover
 * and on focus.
 *
 * Exported because the lightbox's info panel draws its action row with it
 * *(user feedback 2026-08-22, 6.8: the panel's pills should be the menu's
 * items)*. **This module is the source of truth** — the panel imports the
 * string rather than carrying a second copy that would drift from it. A shared
 * string and not a shared component: the two surfaces differ in what they hand
 * their `onClick`, and wrapping a `className` in a component to share it buys
 * an indirection and nothing else.
 */
export const MENU_ITEM_CLASS =
  'block w-full px-3 py-1.5 text-left hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none'

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

  // Every focusable button, **axis pills first**, in DOM order — which is what
  // `focused` indexes and what the focus effect below reads back out of the DOM.
  const axisCount = axis === null ? 0 : ORBIT_AXIS_CHOICES.length
  const count = axisCount + commands.length
  const currentAxisRow =
    axis === null ? 0 : Math.max(0, ORBIT_AXIS_CHOICES.findIndex((c) => c.axis === axis.current))

  // The menu opens on its first *command*, not on the pill row above it: the
  // commands are what the menu is for, and the group is one property of the
  // model shown alongside them. `axisCount` is that index, and 0 when there is
  // no group.
  const [focused, setFocused] = useState(axisCount)

  /**
   * One step of arrow navigation, with the group's one rule: **entering it lands
   * on the spindle already in force**, rather than on the first of six. The
   * group is a choice among six and a choice starts from what is currently
   * true — the same reason the picker in the lightbox opens showing the live
   * axis pressed. Every one of the six is still reached by stepping on from
   * there, in either direction.
   *
   * The group being above the commands rather than below them moves which
   * crossing this rule catches — Up off the first command, and the wrap off the
   * last — and changes nothing else.
   */
  function step(from: number, delta: number): number {
    const next = (from + delta + count) % count
    if (from >= axisCount && next < axisCount) return currentAxisRow
    return next
  }

  // Measure once mounted, then clamp: the height depends on how many commands
  // this entry offers, which is the whole reason it cannot be computed upfront.
  //
  // Focus is re-seeded here too, against the item set just measured: `focused`
  // is a DOM index, and a menu re-raised on a different entry can offer fewer
  // buttons than the last one did — leaving the index past the end, pointing at
  // no button at all.
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    setFocused(axisCount)
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
      {axis !== null && (
        // The spindle this model is stored about — a radio group, since exactly
        // one of the six is true of it and picking one is picking, not toggling.
        // The "axis" caption is a <span>, so it stays out of the button index
        // `focused` walks, exactly as the old heading did.
        //
        // Drawn as the lightbox picker's own pill row (6.8): the marked spindle
        // is the *filled* pill there and it is the filled pill here, so the mark
        // is one visual idea across the two surfaces rather than a tick on one
        // and a fill on the other. `aria-checked` carries it either way.
        <div
          role="group"
          aria-label="Orbit axis"
          className="mb-1 flex items-center gap-0.5 border-b border-zinc-700 px-2 pb-1.5 text-xs"
        >
          <span className="pr-1 text-zinc-500">axis</span>
          {ORBIT_AXIS_CHOICES.map((c) => (
            <button
              key={c.axis}
              type="button"
              role="menuitemradio"
              aria-checked={c.axis === axis.current}
              data-axis={c.axis}
              onClick={() => axis.onChoose(c.axis)}
              className={`rounded-full px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                c.axis === axis.current
                  ? 'bg-sky-700 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
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
          className={MENU_ITEM_CLASS}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
