/**
 * The one validated positive-integer env knob, shared by every bound this server
 * reads. Two traps it closes: flooring *after* the positivity test turns `0.5`
 * into a bound of zero, and a `NaN` bound compares false forever — unbounded.
 */
export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
