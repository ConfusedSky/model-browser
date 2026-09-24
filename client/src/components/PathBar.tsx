import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { getRecents } from "../lib/recents";

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
  return (
    <div className="relative min-w-0 flex-1">
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
          <ol className="flex min-w-0 items-center">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={c.path} className="flex min-w-0 items-center">
                  {i > 0 && (
                    <span aria-hidden="true" className="px-0.5 text-ink-3">
                      /
                    </span>
                  )}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-current={last ? "location" : undefined}
                    onClick={() => onNavigate(c.path)}
                    title={c.path}
                    className={
                      last
                        ? "pointer-events-auto min-w-0 truncate rounded px-1.5 py-0.5 font-medium text-ink hover:bg-raised"
                        : "pointer-events-auto max-w-48 shrink truncate rounded px-1.5 py-0.5 text-ink-2 hover:bg-raised hover:text-ink"
                    }
                  >
                    {c.label}
                  </button>
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
