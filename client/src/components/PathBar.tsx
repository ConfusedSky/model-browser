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

  return (
    <div className="relative flex-1">
      <input
        value={value}
        placeholder="Type a directory path…"
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-500"
        onFocus={() => {
          editing.current = true;
          setOpen(true);
          // The input holds the current path, so without this recents would be
          // unreachable. Editing switches to completions.
          setSuggestions(getRecents().filter((r) => r !== path));
        }}
        onBlur={() => {
          editing.current = false;
          // So a suggestion's mousedown wins over blur. Kept so the unmount
          // above can cancel it, and so a refocus leaves one timer, not two.
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
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left font-mono text-sm text-zinc-300 hover:bg-zinc-800"
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
