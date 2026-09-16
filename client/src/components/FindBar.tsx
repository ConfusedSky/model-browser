import { useEffect, useRef } from "react";

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
}: {
  value: string;
  /** `null` while a listing is in flight, when the count would describe the
   *  listing being replaced rather than the one arriving. */
  count: number | null;
  focusSignal: number;
  onChange: (value: string) => void;
  onClose: () => void;
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
      className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2"
    >
      <span aria-hidden="true" className="text-xs text-zinc-500">
        ⌕
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Narrow these by name…"
        aria-label="Narrow these by name"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none"
      />
      {count !== null && (
        <span className="shrink-0 text-xs text-zinc-500">{count} shown</span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close find"
        className="shrink-0 rounded px-2 text-sm text-zinc-400 hover:text-zinc-100"
      >
        ✕
      </button>
    </div>
  );
}
