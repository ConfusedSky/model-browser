const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 0 → "0 B", 1023 → "1023 B", 1536 → "1.5 KB"; whole numbers from 10 of a unit up. */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  // 1023.5+ would *display* as "1024" — promote those to the next unit too.
  while (value >= 1023.5 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const text =
    unit === 0 ? String(value) : value >= 9.95 ? String(Math.round(value)) : value.toFixed(1)
  return `${text} ${UNITS[unit]}`
}

/** mtime (ms) → localized medium-date + short-time string. */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The index's pooled cosine, to three places — `0.107`.
 *
 * Fixed places rather than significant figures, and three rather than two, for
 * a measured reason (confidence-scores-on-tiles D4): text-query cosines cluster
 * near 0.1 and adjacent results differ in the third place, so at two places a
 * run of genuinely distinguishable results all print `0.11` — asserting a tie
 * that does not exist, which is worse than printing nothing. A trailing zero is
 * information here and is kept.
 *
 * A value just below zero rounds to the string `-0.000`, which reads as broken
 * rather than as small. Normalised to `0.000`: the sign carries no information
 * at that magnitude, and a minus that survives every displayed digit is a
 * rendering artefact, not a measurement.
 *
 * *Measured, not guarded against speculatively.* Swept against the running
 * index at `top: 97` with the score floor cleared — the state that puts the
 * distribution's tail on screen — three of four phrases produced at least one:
 * `dragon` one cosine and one z, `a bust of a woman` two cosines, `a knight
 * with a sword` one z, `spaceship` none. The worst was a cosine of -5.0e-06: a
 * minus sign qualifying a value five orders of magnitude below the last digit
 * shown. That is on a 97-model collection; the real library is ~30x larger and
 * both windows get proportionally more chances. Do not delete this branch as
 * paranoia.
 */
export function formatCosine(score: number): string {
  const text = score.toFixed(3)
  return text === '-0.000' ? '0.000' : text
}

/**
 * The index's robust z, to two places — `3.14`.
 *
 * Two rather than three: z's one meaningful landmark is the index's own
 * `WEAK_Z = 2.0` and its useful range is roughly single digits, so a third
 * decimal would imply a precision the median/MAD estimate behind it does not
 * have. Negative values are ordinary — a result below the collection's median
 * has one — and are printed as they come.
 *
 * The same `-0.00` normalisation as the cosine, and likelier to be hit here:
 * z is measured *from* the collection's median, so it is centred on zero by
 * construction and values a hair below it are ordinary rather than extreme.
 * The sweep above bears that out per phrase — though the single worst value
 * was a cosine, z's window is the one more phrases landed in.
 */
export function formatZ(z: number): string {
  const text = z.toFixed(2)
  return text === '-0.00' ? '0.00' : text
}
