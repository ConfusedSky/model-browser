import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OrbitAxis } from '../../../shared/types'
import {
  AXIS_CAPTION_CLASS,
  AXIS_DIVIDER_CLASS,
  AXIS_GROUP_CLASS,
  AXIS_LETTERS,
  FLIP_TITLE,
  axisLetter,
  axisPillClass,
  axisWithLetter,
  flipPillClass,
  isAxisNegated,
  negatedAxis,
  type EntryCommand,
} from '../lib/entryActions'

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
   * An **inline group**, not a submenu, and the reason is this component's
   * keyboard model: focus here is one index over the menu's buttons, so a few
   * more buttons cost one changed count and nothing else, while a submenu would
   * need its own open state, its own clamp, focus handed across it and a second
   * level of Escape — new machinery for a menu of at most ten short items.
   *
   * Drawn at the **top**, as a compact pill row rather than full-width rows
   * *(user feedback 2026-08-22, 6.8)*: rows of a twelve-row menu were the axis,
   * which read as the menu's subject rather than as one property of the model.
   *
   * And drawn as **`axis  X Y Z | flip`** — the lightbox picker's own four
   * buttons *(second look at 6.8, same feedback thread)*, not six pills spelling
   * the spindles out. The picker taught the user that a spindle is a letter and
   * a sign, and its rules come with the shape: a letter keeps the sign in force
   * (`−Z` then `X` is `−X`), `flip` negates. `entryActions` holds both the rules
   * and the class strings so the two surfaces cannot drift apart.
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
 * The axis pills carry their own focus mark, which the picker in the lightbox
 * has no need of: there, focus is wherever the pointer left it, while here the
 * arrow keys move it and it has to be visible doing so.
 */
const FOCUS_RING = 'focus:outline-none focus:ring-1 focus:ring-sky-500'

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
  // Four of them when the group is offered: three letters and `flip`.
  const axisCount = axis === null ? 0 : AXIS_LETTERS.length + 1
  const count = axisCount + commands.length
  // Entering the group lands on the **letter** in force — the analogue of the
  // old land-on-the-marked-spindle rule now that the sign is a fourth button.
  const currentAxisRow =
    axis === null ? 0 : Math.max(0, AXIS_LETTERS.indexOf(axisLetter(axis.current)))

  // The menu opens on its first *command*, not on the pill row above it: the
  // commands are what the menu is for, and the group is one property of the
  // model shown alongside them. `axisCount` is that index, and 0 when there is
  // no group.
  const [focused, setFocused] = useState(axisCount)

  /**
   * One step of arrow navigation, with the group's one rule: **entering it lands
   * on the letter already in force**, rather than on `X`. A choice starts from
   * what is currently true — the same reason the picker in the lightbox opens
   * showing the live axis filled. The other letters and `flip` are still reached
   * by stepping on from there, in either direction.
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
        // The spindle this model is stored about, as the lightbox picker states
        // it: three letters and a sign. The "axis" caption is a <span>, so it
        // stays out of the button index `focused` walks, exactly as the old
        // heading did.
        //
        // Roles are split rather than uniform, because the two halves are two
        // different questions: the letters are a choice among three
        // (`menuitemradio`, exactly one checked), and `flip` is a state that is
        // on or off (`menuitemcheckbox`). The split costs the keyboard model
        // nothing — `step` counts buttons and never reads a role — so there was
        // no reason to flatten a real distinction to save it.
        <div role="group" aria-label="Orbit axis" className={`mx-2 mb-1 ${AXIS_GROUP_CLASS}`}>
          <span className={AXIS_CAPTION_CLASS}>axis</span>
          {AXIS_LETTERS.map((letter) => {
            const active = axisLetter(axis.current) === letter
            return (
              <button
                key={letter}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                data-axis={letter}
                // The sign in force rides along: picking `X` under `−Z` means
                // `−X`. Re-picking the active letter therefore reproduces the
                // spindle in force, which `setOrbitAxis` already declines.
                onClick={() => axis.onChoose(axisWithLetter(axis.current, letter))}
                className={`${axisPillClass(active)} ${FOCUS_RING}`}
              >
                {letter.toUpperCase()}
              </button>
            )
          })}
          <span className={AXIS_DIVIDER_CLASS} />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={isAxisNegated(axis.current)}
            data-axis="flip"
            title={FLIP_TITLE}
            onClick={() => axis.onChoose(negatedAxis(axis.current))}
            className={`${flipPillClass(isAxisNegated(axis.current))} ${FOCUS_RING}`}
          >
            flip
          </button>
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
