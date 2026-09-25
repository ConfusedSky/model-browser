import { useEffect, useRef } from "react";
import Icon from "./Icon";

/**
 * Summoned rather than permanent, because filtering is ephemeral view state —
 * navigation discards it and no URL names it — and a permanent box implies a
 * persistence the filter does not have.
 */
export default function FindBar({
  value,
  count,
  focusSignal,
  onChange,
  onClose,
  onDown,
}: {
  value: string;
  /** `null` while a listing is in flight, when the count would describe the
   *  listing being replaced rather than the one arriving. */
  count: number | null;
  focusSignal: number;
  onChange: (value: string) => void;
  onClose: () => void;
  /** ↓ leaves the box for the narrowed grid, as it does from search. */
  onDown?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // Also when asked for while already open: a control you summon and then have
  // to click into has not finished appearing.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [focusSignal]);

  return (
    <div
      data-find-bar
      className="mx-4 mt-3 flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3"
    >
      <Icon name="filter" className="size-3.5 text-ink-3" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "ArrowDown" && onDown !== undefined) {
            e.preventDefault();
            onDown();
          }
        }}
        placeholder="Narrow these by name…"
        aria-label="Narrow these by name"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
      />
      {count !== null && (
        <span className="shrink-0 text-xs tabular-nums text-ink-3">
          {count} shown
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close find"
        title="Close (Esc)"
        className="flex size-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-white/5 hover:text-ink touch:size-11"
      >
        <Icon name="x" className="size-3.5" />
      </button>
    </div>
  );
}
