/**
 * The one validated positive-integer environment knob, shared by every bound
 * this server reads from the environment.
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * **Why a module of its own rather than three copies of six lines.** There were
 * three: `listing.ts`'s walk budgets and caps, `snapshot.ts`'s store cap, and
 * `cache.ts`'s thumbnail-pixel cap. They were written to the same rule and drifted
 * from it — a review found the floor-after-positivity bug, it was corrected in two
 * of the three, and the third went on shipping it (`listing-tree-cache` round-2
 * finding 9). That is the argument for extracting now rather than in a later
 * simplify pass: the duplication has already cost one missed fix, and a fourth
 * knob would have inherited whichever copy its author happened to read.
 *
 * The rule, in one place:
 *
 * - **Absent or blank falls back.** An unset knob is not a request for zero.
 * - **The floor runs BEFORE the positivity test, never after.** `0.5` is finite
 *   and greater than zero, and flooring it afterwards yields `0` — a budget that
 *   exhausts every walk instantly, or a cap that evicts the whole store on every
 *   sweep. A fractional knob is malformed, and malformed falls back.
 * - **Never silently unbounded.** `Number('64MB')` is `NaN`; a `NaN` bound makes
 *   `total <= cap` false forever and `budget <= 0` false forever, so a malformed
 *   knob would do the exact opposite of what it spells. Non-finite falls back.
 */

/**
 * A positive integer from `process.env[name]`, or `fallback` for anything that
 * is not one — absent, blank, non-numeric, non-finite, fractional, zero or
 * negative.
 */
export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  // Floored first, on purpose — see the rule above.
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : fallback
}
