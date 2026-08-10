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
