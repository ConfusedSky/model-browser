import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { getRecents } from "../lib/recents";
import Icon from "./Icon";

interface Props {
  path: string;
  api: ApiClient;
  onNavigate: (path: string) => void;
}

/** The input and its suggestions, and nothing taller: a transient line drawn
 *  here grows this flex item past the controls beside it, so the header owns
 *  that row instead. */
export default function PathBar({ path, api, onNavigate }: Props) {
  const [value, setValue] = useState(path);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  /** Breadcrumbs stand in for the text until the input is focused. */
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * How far the crumbs are folded, found by measuring rather than counting:
   * whole names first, then the middle folded to "…", then the parent too.
   * Reset whenever the path or the room changes, and stepped up once per
   * render while the row still overflows.
   */
  const [fold, setFold] = useState(0);
  const olRef = useRef<HTMLOListElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setFold(0), [path]);
  useLayoutEffect(() => {
    const ol = olRef.current;
    if (ol === null || fold >= MAX_FOLD) return;
    if (fold < 2) {
      if (ol.scrollWidth > ol.clientWidth + 1) setFold(fold + 1);
      return;
    }
    // At the second fold the current name may give way, but only down to a
    // readable width — or its own, if shorter; squeezed past that, the top
    // folds too.
    const label = ol.querySelector<HTMLElement>("[data-crumb-current]");
    if (
      label !== null &&
      label.clientWidth + 1 < Math.min(READABLE_PX, label.scrollWidth)
    )
      setFold(fold + 1);
  });
  useEffect(() => {
    const row = rowRef.current;
    if (row === null || typeof ResizeObserver === "undefined") return;
    let width = row.clientWidth;
    const ro = new ResizeObserver(() => {
      if (row.clientWidth === width) return;
      width = row.clientWidth;
      setFold(0);
    });
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Held for the debounce's reason: a timer this component starts, it cancels. */
  const blurDismiss = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setValue(path);
  }, [path]);

  // The bar lives as long as the app, so what unmounts it inside a debounce
  // window is a teardown — an HMR swap, a test releasing its root. Left to
  // fire, the callback runs against an `api` whose owner is gone: the `.catch`
  // below guards a *rejected* promise, not a call that returns nothing, which
  // throws `.then` of undefined right here where nothing catches it.
  useEffect(
    () => () => {
      if (debounce.current !== null) clearTimeout(debounce.current);
      if (blurDismiss.current !== null) clearTimeout(blurDismiss.current);
    },
    [],
  );

  function refreshSuggestions(input: string): void {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (input === "") {
        setSuggestions(getRecents());
        return;
      }
      void api
        .complete(input)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 150);
  }

  function submit(target: string): void {
    editing.current = false;
    setOpen(false);
    if (target !== "")
      onNavigate(
        target.endsWith("/") && target !== "/" ? target.slice(0, -1) : target,
      );
  }

  const crumbs = crumbsOf(path);
  const shown = foldCrumbs(crumbs, fold);
  return (
    <div ref={rowRef} className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={value}
        placeholder="Type a directory path…"
        spellCheck={false}
        className={
          focused
            ? "h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[13px] text-ink outline-none"
            : "h-8 w-full cursor-text rounded-md border border-transparent bg-transparent px-2.5 font-mono text-[13px] text-transparent outline-none hover:bg-surface"
        }
        onFocus={() => {
          editing.current = true;
          setFocused(true);
          setOpen(true);
          setSuggestions(getRecents().filter((r) => r !== path));
        }}
        onBlur={() => {
          editing.current = false;
          setFocused(false);
          if (blurDismiss.current !== null) clearTimeout(blurDismiss.current);
          blurDismiss.current = setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          refreshSuggestions(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(value);
          if (e.key === "Escape") {
            setOpen(false);
            setValue(path);
            inputRef.current?.blur();
          }
        }}
      />
      {/* Over the input rather than instead of it: the gaps between crumbs
          fall through to the input, so clicking past the last one edits the
          path as text. */}
      {!focused && (
        <nav
          aria-label="Location"
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-1 text-[13px]"
        >
          <ol ref={olRef} className="flex min-w-0 items-center overflow-hidden">
            {shown.map((c, i) => {
              const last = i === shown.length - 1;
              return (
                <li
                  key={c === null ? "gap" : c.path}
                  // Whole crumbs while folding can still make room; from the
                  // second fold the current name gives way to the room left.
                  className={
                    last && fold >= 2
                      ? "flex min-w-0 shrink items-center"
                      : "flex shrink-0 items-center"
                  }
                >
                  {i > 0 && (
                    <span aria-hidden="true" className="px-0.5 text-ink-3">
                      /
                    </span>
                  )}
                  {c === null ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      title="Type a path"
                      onClick={() => inputRef.current?.focus()}
                      className="pointer-events-auto flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-ink-3 hover:bg-raised hover:text-ink touch:h-11 touch:min-w-11"
                    >
                      …
                    </button>
                  ) : (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-current={last ? "location" : undefined}
                      aria-label={c.path === "/" ? "Library" : undefined}
                      onClick={() => onNavigate(c.path)}
                      title={c.path}
                      className={
                        last
                          ? "pointer-events-auto flex h-7 min-w-7 items-center justify-center gap-1.5 rounded px-1.5 font-medium text-ink hover:bg-raised touch:h-11 touch:min-w-11"
                          : "pointer-events-auto flex h-7 min-w-7 items-center justify-center gap-1.5 rounded px-1.5 text-ink-2 hover:bg-raised hover:text-ink touch:h-11 touch:min-w-11"
                      }
                    >
                      {c.path === "/" && (
                        <Icon name="home" className="size-3.5" />
                      )}
                      <span
                        data-crumb-current={last ? "" : undefined}
                        className={
                          c.path === "/"
                            ? "hidden truncate sm:inline"
                            : "truncate"
                        }
                      >
                        {c.label}
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full min-w-72 overflow-auto rounded-lg border border-line-strong bg-raised p-1 shadow-2xl shadow-black/50">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-[13px] text-ink-2 hover:bg-white/5 hover:text-ink"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(s);
                  submit(s);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The path as navigable steps, the library top first. A zip is a step of its
 * own: `a.zip!` names the archive, which is entered at `a.zip`.
 */
export function crumbsOf(path: string): { label: string; path: string }[] {
  const out = [{ label: "Library", path: "/" }];
  let raw = "";
  for (const part of path.split("/")) {
    if (part === "") continue;
    raw += `/${part}`;
    const zip = part.endsWith("!");
    out.push({
      label: zip ? part.slice(0, -1) : part,
      path: zip ? raw.slice(0, -1) : raw,
    });
  }
  return out;
}

const MAX_FOLD = 3;
/** How narrow the current folder's name may be squeezed before the top folds
 *  away to give it room. */
const READABLE_PX = 160;

/** The crumbs at a fold level: 0 all of them, 1 the top, "…" and the last two,
 *  2 the top, "…" and the current folder, 3 "…" and the current folder (the
 *  brand already leads to the top). A path too short to fold stays whole. */
export function foldCrumbs(
  crumbs: { label: string; path: string }[],
  fold: number,
): ({ label: string; path: string } | null)[] {
  if (fold >= 3 && crumbs.length > 1) return [null, crumbs.at(-1)!];
  const keep = fold === 1 ? 2 : fold >= 2 ? 1 : crumbs.length;
  if (crumbs.length <= keep + 1) return crumbs;
  return [crumbs[0]!, null, ...crumbs.slice(-keep)];
}
