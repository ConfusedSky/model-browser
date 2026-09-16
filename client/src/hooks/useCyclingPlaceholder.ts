/**
 * The search input's cycling example (`landing-page` D6); `null` rather than an
 * empty string, so the ordinary placeholder stays the input's own text. The
 * *placeholder* and not the accessible name, which never moves.
 */
import { useEffect, useState } from "react";

/** Long enough to read a phrase, short enough for a second while looking. */
export const PLACEHOLDER_PERIOD_MS = 4000;

export function useCyclingPlaceholder(
  items: readonly string[],
  active: boolean,
  periodMs: number = PLACEHOLDER_PERIOD_MS,
): string | null {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    // Cleared, not ignored: an unseen interval is a re-render per period.
    if (!active || items.length === 0) return;
    const id = setInterval(() => setIndex((i) => i + 1), periodMs);
    return () => clearInterval(id);
  }, [active, items.length, periodMs]);
  if (!active || items.length === 0) return null;
  // Modulo at read time: the counter is monotonic, so a list that changed
  // length mid-cycle still lands on a real item.
  return items[index % items.length] ?? null;
}
