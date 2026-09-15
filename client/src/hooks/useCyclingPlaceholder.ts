/**
 * The search input's cycling example (`landing-page` D6): one of `items` while
 * `active`, a different one every `periodMs`, and `null` the moment any of the
 * conditions the caller gates on fails.
 *
 * `null` rather than an empty string, so the call site reads
 * `example ?? 'Search names and folders…'` — the ordinary placeholder is the
 * input's own text and this hook has no business restating it.
 *
 * The *placeholder* and not the accessible name: a visible placeholder that
 * changes is not announced by a screen reader, which is the accessible outcome
 * wanted — the input's `aria-label` never moves, and it is what the test
 * harness selects by.
 */
import { useEffect, useState } from 'react'

/** A walking pace: long enough to read a phrase, short enough that a second one
 *  arrives while the visitor is still looking at the box. */
export const PLACEHOLDER_PERIOD_MS = 4000

export function useCyclingPlaceholder(
  items: readonly string[],
  active: boolean,
  periodMs: number = PLACEHOLDER_PERIOD_MS,
): string | null {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    // Cleared on inactivity, not merely ignored: an interval ticking behind a
    // placeholder nobody can see is a re-render per period for nothing.
    if (!active || items.length === 0) return
    const id = setInterval(() => setIndex((i) => i + 1), periodMs)
    return () => clearInterval(id)
  }, [active, items.length, periodMs])
  if (!active || items.length === 0) return null
  // Modulo at read time rather than at write: the counter is monotonic, so a
  // list that changed length mid-cycle still lands on a real item. The `??` is
  // `noUncheckedIndexedAccess` alone — the guard above rules the miss out.
  return items[index % items.length] ?? null
}
