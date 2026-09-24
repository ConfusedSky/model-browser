import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";
import type { AppRef, OrbitAxis } from "../../../shared/types";
import {
  AXIS_CAPTION_CLASS,
  AXIS_DIVIDER_CLASS,
  AXIS_GROUP_CLASS,
  AXIS_LETTERS,
  FLIP_TITLE,
  OPEN_IN_CAPTION,
  OPEN_IN_CAPTION_CLASS,
  OPEN_IN_GROUP_CLASS,
  OPEN_IN_PILL_CLASS,
  axisLetter,
  axisPillClass,
  axisWithLetter,
  flipPillClass,
  isAxisNegated,
  negatedAxis,
  MAINTENANCE_COMMANDS,
  type CommandId,
  type EntryCommand,
} from "../lib/entryActions";

/**
 * A context menu raised on a grid tile: position, dismissal and keyboard, and
 * nothing else. Which command applies to which entry is `entryActions`' table
 * (D6), never re-decided here.
 */
interface Props {
  x: number;
  y: number;
  commands: EntryCommand[];
  /**
   * The orbit-axis group, `null` where it is not offered — App decides. An
   * inline pill row rather than a submenu, which would need its own open state,
   * clamp, focus handoff and Escape level, where this costs one changed button
   * count.
   *
   * The lightbox picker's own four buttons, so its rules come with the shape: a
   * letter keeps the sign in force, `flip` negates. `entryActions` holds the
   * rules and the class strings, so the two surfaces cannot drift.
   */
  axis?: { current: OrbitAxis; onChoose: (axis: OrbitAxis) => void } | null;
  /** The applications for this model's type (open-in-slicer L3), default
   *  first. `null` and not `[]`: what does not apply is absent, not present and
   *  inert. A second inline group, drawn to match `axis`. */
  openIn?: { apps: AppRef[]; onChoose: (appId: string) => void } | null;
  onChoose: (command: EntryCommand) => void;
  onClose: () => void;
}

/** Margin between the menu and the window edge. */
const EDGE = 6;

/** **The source of truth** for a menu item's look; the lightbox panel imports
 *  it rather than carrying a copy. A string and not a component, since the two
 *  surfaces differ in what they hand their `onClick`. */
export const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none";

/** Each command's glyph, drawn wherever the command is — menu and panel. */
export const COMMAND_ICON: Record<CommandId, IconName> = {
  open: "maximize",
  reveal: "folder",
  copyPath: "copy",
  findSimilar: "sparkles",
  generateBeneath: "grid",
  resetBeneath: "rotate",
  reRenderThumbnail: "refresh",
  resetFraming: "rotate",
  openWith: "externalLink",
};

/** The arrow keys move focus here, so it has to be visible doing so — which
 *  the lightbox picker, where the pointer leaves it, does not need. */
const FOCUS_RING = "focus:outline-none focus:ring-1 focus:ring-accent";

/**
 * Keep the whole menu on screen (R2). Clamped rather than flipped: flipping
 * moves the first item away from where the user is looking, and this menu is
 * short enough that sliding always fits. Pure because a happy-dom rect is all
 * zeros, so the clamp is unit-tested on its own.
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
  };
}

export default function EntryMenu({
  x,
  y,
  commands,
  axis = null,
  openIn = null,
  onChoose,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Pill rows first, in DOM order — what `focused` indexes and what the focus
  // effect reads back out of the DOM. The open-in row is as long as the
  // registry says, which is why the seam below is computed.
  const axisCount = axis === null ? 0 : AXIS_LETTERS.length + 1;
  const openInCount = openIn === null ? 0 : openIn.apps.length;
  const pillCount = axisCount + openInCount;
  const count = pillCount + commands.length;
  const currentAxisRow =
    axis === null
      ? 0
      : Math.max(0, AXIS_LETTERS.indexOf(axisLetter(axis.current)));

  // On the first *command*: the commands are what the menu is for, the groups
  // are properties of the model shown alongside them.
  const [focused, setFocused] = useState(pillCount);

  /**
   * One arrow step. **A group is entered where a choice sensibly starts** — the
   * axis group at the letter in force, the open-in group at the registry's
   * default. The rules catch crossings only, which is why each tests where the
   * step came *from* as well as where it lands.
   */
  function step(from: number, delta: number): number {
    const next = (from + delta + count) % count;
    if (from >= axisCount && next < axisCount) return currentAxisRow;
    if (
      (from < axisCount || from >= pillCount) &&
      next >= axisCount &&
      next < pillCount
    ) {
      return axisCount;
    }
    return next;
  }

  // Measure then clamp: the height depends on how many commands this entry
  // offers. Focus is re-seeded against the set just measured — `focused` is a
  // DOM index, and a menu re-raised on another entry can offer fewer buttons.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setFocused(pillCount);
    const r = el.getBoundingClientRect();
    setPos(
      clampToViewport(
        x,
        y,
        r.width,
        r.height,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [x, y, commands.length, axisCount, openInCount, pillCount]);

  // The menu owns the keyboard the moment it is raised, which is what makes
  // its Escape the one that fires.
  useEffect(() => {
    const el =
      ref.current?.querySelectorAll<HTMLButtonElement>("button")[focused];
    el?.focus();
  }, [focused]);

  // At the window, so they work wherever focus is. App's find control stands
  // down on Escape while a menu is raised.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    }
    function onDown(e: Event): void {
      if (e.target instanceof Node && ref.current?.contains(e.target) === true)
        return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    // A secondary press elsewhere raises the next menu.
    window.addEventListener("contextmenu", onDown, true);
    window.addEventListener("wheel", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("wheel", onDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Entry actions"
      style={{ left: pos.left, top: pos.top }}
      // Capped as well as floored: the open-in row is as wide as the registry's
      // application names, and an uncapped menu grows past a narrow window
      // rather than wrapping inside it. `EDGE` twice over, so the cap agrees
      // with where `clampToViewport` will put it.
      className="fixed z-menu min-w-52 max-w-[calc(100vw-12px)] rounded-xl border border-line-strong bg-raised p-1 text-[13px] text-ink shadow-2xl shadow-black/60"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocused((i) => step(i, 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocused((i) => step(i, -1));
        } else if (e.key === "Home") {
          e.preventDefault();
          setFocused(0);
        } else if (e.key === "End") {
          e.preventDefault();
          setFocused(count - 1);
        }
      }}
    >
      {axis !== null && (
        // The caption is a `<span>`, so it stays out of the button index
        // `focused` walks. Split roles because the halves are different
        // questions, which costs the keyboard model nothing: `step` counts
        // buttons and never reads a role.
        <div
          role="group"
          aria-label="Orbit axis"
          className={`mb-1 ${AXIS_GROUP_CLASS}`}
        >
          <span className={AXIS_CAPTION_CLASS}>axis</span>
          {AXIS_LETTERS.map((letter) => {
            const active = axisLetter(axis.current) === letter;
            return (
              <button
                key={letter}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                data-axis={letter}
                // The sign rides along: picking `X` under `−Z` means `−X`.
                onClick={() =>
                  axis.onChoose(axisWithLetter(axis.current, letter))
                }
                className={`${axisPillClass(active)} ${FOCUS_RING}`}
              >
                {letter.toUpperCase()}
              </button>
            );
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
      {openIn !== null && (
        // `menuitem`, not `menuitemradio`: choosing one launches it rather
        // than marking the model as being that thing. No `data-command`
        // either — a surface reading the command rows must not find these.
        <div
          role="group"
          aria-label="Open in"
          className={`mb-1 ${OPEN_IN_GROUP_CLASS}`}
        >
          <span className={OPEN_IN_CAPTION_CLASS}>{OPEN_IN_CAPTION}</span>
          {openIn.apps.map((app) => (
            <button
              key={app.id}
              type="button"
              role="menuitem"
              data-app-id={app.id}
              title={app.name}
              onClick={() => openIn.onChoose(app.id)}
              className={`${OPEN_IN_PILL_CLASS} ${FOCUS_RING}`}
            >
              {app.name}
            </button>
          ))}
        </div>
      )}
      {commands.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 &&
            MAINTENANCE_COMMANDS.has(c.id) &&
            !MAINTENANCE_COMMANDS.has(commands[i - 1]!.id) && (
              <div role="separator" className="mx-1 my-1 h-px bg-line" />
            )}
          <button
            type="button"
            role="menuitem"
            data-command={c.id}
            // Click, not pointerdown, which the dismissal above listens for.
            onClick={() => onChoose(c)}
            className={MENU_ITEM_CLASS}
          >
            <Icon name={COMMAND_ICON[c.id]} className="size-3.5 text-ink-3" />
            {c.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
