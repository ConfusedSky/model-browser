/**
 * A preference kept in `localStorage`, per browser profile.
 *
 * Neither half may throw. Reads happen at module init, where an exception would
 * take the app down before it rendered, and writes happen in event handlers on
 * browsers (and test environments) where storage can be absent or refused — so
 * a read falls back to `parse(null)`, the same answer an unset key gives, and a
 * failed write leaves the value in memory only.
 *
 * `parse` is handed the raw string or `null` and is the single place a stored
 * value is validated: a malformed one reads as the default rather than
 * propagating, since a key edited by hand should degrade to the ordinary
 * setting.
 */
export interface Stored<T> {
  read(): T
  write(value: T): void
}

export function stored<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): Stored<T> {
  return {
    read() {
      try {
        return parse(localStorage.getItem(key))
      } catch {
        return parse(null)
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, serialize(value))
      } catch {
        // no localStorage (tests) — in-memory only
      }
    },
  }
}
